import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type {
  ExamSource,
  PracticeExamContent,
  PracticeExamFile,
  QuizAttemptDetail,
  QuizAttemptSummary,
} from '../../src/types';
import {
  listSources,
  insertSource,
  findSourceByPath,
  getSource,
  deleteSource,
  getPracticeStats,
  insertPracticeAttempt,
  listPracticeAttempts,
  getPracticeAttempt,
} from '../database/repositories/practice';
import { isPracticeFile, titleFromFileName } from './courseScanner';
import { naturalSort } from './naturalSort';
import { parsePracticeExamHtml } from './practiceExamParser';
import { ValidationError } from './validate';

function setsEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.every((v, i) => v === sb[i]);
}

function resolveSourceTarget(targetPath: string, kind: 'file' | 'dir'): string {
  const resolved = path.resolve(targetPath);
  if (!fs.existsSync(resolved)) throw new ValidationError('Path not found.');
  const stat = fs.statSync(resolved);
  if (kind === 'file' && !stat.isFile()) throw new ValidationError('Expected a file.');
  if (kind === 'dir' && !stat.isDirectory()) throw new ValidationError('Expected a folder.');
  if (kind === 'file' && !isPracticeFile(resolved)) {
    throw new ValidationError('Only HTML practice-test files (.html) can be registered.');
  }
  return resolved;
}

/** Registers a folder or file as an exam source (idempotent by path). */
export function registerSource(db: Database.Database, targetPath: string, kind: 'file' | 'dir'): ExamSource {
  const resolved = resolveSourceTarget(targetPath, kind);
  return findSourceByPath(db, resolved) ?? insertSource(db, { path: resolved, kind });
}

export function unregisterSource(db: Database.Database, sourceId: number): void {
  if (!getSource(db, sourceId)) throw new ValidationError('Exam source not found.');
  deleteSource(db, sourceId);
}

function filesOfSource(source: ExamSource): string[] {
  if (source.kind === 'file') return [source.path];
  const files: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && isPracticeFile(entry.name)) files.push(full);
    }
  };
  walk(source.path);
  return naturalSort(files, (f) => f);
}

/** The file must live under a registered source — the renderer never sees raw paths. */
function requireRegisteredFile(db: Database.Database, filePath: string): string {
  const resolved = path.resolve(filePath);
  for (const source of listSources(db)) {
    if (source.kind === 'file' && resolved === source.path) return resolved;
    if (source.kind === 'dir' && (resolved === source.path || resolved.startsWith(source.path + path.sep))) {
      return resolved;
    }
  }
  throw new ValidationError('File is not in a registered exam folder.');
}

/** Scans all sources and summarizes every practice test found. */
export function scanLibrary(db: Database.Database): PracticeExamFile[] {
  const out: PracticeExamFile[] = [];
  const seen = new Set<string>();
  for (const source of listSources(db)) {
    for (const file of filesOfSource(source)) {
      // Overlapping sources (e.g. a file inside a registered folder) list
      // each test only once.
      if (seen.has(file)) continue;
      seen.add(file);
      const stats = getPracticeStats(db, file);
      try {
        const content = fs.readFileSync(file, 'utf8');
        const parsed = parsePracticeExamHtml(content);
        if (!parsed || parsed.questions.length === 0) {
          out.push({
            filePath: file,
            title: titleFromFileName(file),
            questionCount: 0,
            multiCount: 0,
            skipped: parsed?.skipped ?? 0,
            error: 'No usable questions found in this file.',
            ...stats,
          });
          continue;
        }
        out.push({
          filePath: file,
          title: parsed.title || titleFromFileName(file),
          questionCount: parsed.questions.length,
          multiCount: parsed.questions.filter((q) => q.correctIndices.length > 1).length,
          skipped: parsed.skipped,
          ...stats,
        });
      } catch {
        out.push({
          filePath: file,
          title: titleFromFileName(file),
          questionCount: 0,
          multiCount: 0,
          skipped: 0,
          error: 'Could not read this file.',
          ...stats,
        });
      }
    }
  }
  return naturalSort(out, (f) => f.title);
}

/** Parses one exam fully for the runners. */
export function loadExamFile(db: Database.Database, filePath: string): PracticeExamContent {
  const resolved = requireRegisteredFile(db, filePath);
  let content: string;
  try {
    content = fs.readFileSync(resolved, 'utf8');
  } catch {
    throw new ValidationError('Could not read this file. It may have been moved or deleted.');
  }
  const parsed = parsePracticeExamHtml(content);
  if (!parsed || parsed.questions.length === 0) {
    throw new ValidationError('Could not understand this practice file.');
  }
  return {
    title: parsed.title || titleFromFileName(resolved),
    description:
      `${parsed.questions.length} questions` +
      (parsed.skipped > 0 ? ` (${parsed.skipped} skipped)` : '') +
      ` · ${path.basename(resolved)}`,
    questions: parsed.questions.map((q) => ({
      question: q.question,
      options: q.options,
      correctIndices: q.correctIndices,
      explanation: q.explanation,
      topic: q.topic,
    })),
  };
}

export interface PracticeAnswerInput {
  /**
   * Index of the question in the file's own order. Required whenever the
   * runner shuffles questions, because scoring is positional: without it a
   * shuffled run scored every answer against the wrong question.
   */
  questionIndex?: unknown;
  selected: unknown;
  seconds?: unknown;
}

export function submitExamAttempt(
  db: Database.Database,
  filePath: string,
  answers: unknown,
  flagged?: unknown,
): QuizAttemptDetail {
  const exam = loadExamFile(db, filePath);
  if (!Array.isArray(answers) || answers.length !== exam.questions.length) {
    throw new ValidationError('Answer count does not match the exam.');
  }

  // Place each answer against the question it was actually given for.
  // `questionIndex` is authoritative when present; array position is the
  // fallback for callers that submit in file order.
  const slots = new Array<{ selected: number[]; seconds: number } | undefined>(exam.questions.length);
  (answers as PracticeAnswerInput[]).forEach((answer, i) => {
    const claimed = Array.isArray(answer) ? undefined : answer?.questionIndex;
    let target = i;
    if (claimed !== undefined) {
      if (typeof claimed !== 'number' || !Number.isInteger(claimed) || claimed < 0 || claimed >= exam.questions.length) {
        throw new ValidationError('An answer refers to a question that is not in this exam.');
      }
      target = claimed;
    }
    if (slots[target] !== undefined) {
      throw new ValidationError('Two answers refer to the same question.');
    }
    const options = exam.questions[target].options;
    const raw = Array.isArray(answer) ? answer : answer?.selected;
    const set = Array.isArray(raw)
      ? [...new Set(raw.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < options.length))].sort((a, b) => a - b)
      : [];
    const seconds = typeof answer === 'object' && answer !== null && Number.isFinite((answer as { seconds?: unknown }).seconds)
      ? Math.max(0, Number((answer as { seconds?: unknown }).seconds))
      : 0;
    slots[target] = { selected: set, seconds };
  });

  const perQuestion = exam.questions.map((question, i) => {
    const slot = slots[i] ?? { selected: [], seconds: 0 };
    return { ...slot, isCorrect: setsEqual(slot.selected, question.correctIndices) };
  });
  const flagList = Array.isArray(flagged)
    ? [...new Set(flagged.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < exam.questions.length))].sort((a, b) => a - b)
    : [];
  const score = perQuestion.filter((a) => a.isCorrect).length;
  const resolved = path.resolve(filePath);
  const attemptId = insertPracticeAttempt(db, {
    sourcePath: resolved,
    score,
    total: exam.questions.length,
    selections: perQuestion.map((a) => a.selected),
    durations: perQuestion.map((a) => Math.round(a.seconds * 10) / 10),
    flags: flagList,
  });
  const detail = buildDetail(db, attemptId);
  if (!detail) throw new ValidationError('Failed to load the submitted attempt.');
  return detail;
}

export function listExamAttempts(db: Database.Database, filePath: string): QuizAttemptSummary[] {
  requireRegisteredFile(db, filePath);
  return listPracticeAttempts(db, path.resolve(filePath));
}

export function getExamAttemptDetail(db: Database.Database, attemptId: number): QuizAttemptDetail | null {
  return buildDetail(db, attemptId);
}

function buildDetail(db: Database.Database, attemptId: number): QuizAttemptDetail | null {
  const row = getPracticeAttempt(db, attemptId);
  if (!row) return null;
  let exam: PracticeExamContent;
  try {
    exam = loadExamFile(db, row.sourcePath);
  } catch {
    return null;
  }
  if (exam.questions.length !== row.selections.length) return null;
  const answers = exam.questions.map((q, i) => {
    const valid = (row.selections[i] ?? []).filter((n) => n >= 0 && n < q.options.length);
    return {
      questionId: i,
      question: q.question,
      options: q.options,
      correctIndex: q.correctIndices[0] ?? 0,
      correctIndices: q.correctIndices,
      selectedIndex: valid[0] ?? -1,
      selectedIndices: valid,
      isCorrect: setsEqual(valid, q.correctIndices),
      explanation: q.explanation,
      seconds: row.durations[i] ?? 0,
    };
  });
  return {
    id: row.id,
    quizId: -1,
    score: row.score,
    total: row.total,
    percent: row.total > 0 ? Math.round((row.score / row.total) * 100) : 0,
    createdAt: row.createdAt,
    flagged: row.flags,
    answers,
  };
}
