import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type {
  ExamSource,
  PracticeExamContent,
  PracticeExamFile,
  PracticeExamQuestion,
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
  saveExamSnapshot,
  getExamSnapshot,
} from '../database/repositories/practice';
import { isPracticeFile, titleFromFileName } from './courseScanner';
import { naturalSort } from './naturalSort';
import { parsePracticeExamHtml } from './practiceExamParser';
import { ValidationError } from './validate';
import { isInsideDir, pathKey } from './pathIdentity';

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
    if (source.kind === 'file' && pathKey(resolved) === pathKey(source.path)) return resolved;
    if (source.kind === 'dir' && isInsideDir(source.path, resolved)) return resolved;
  }
  throw new ValidationError('File is not in a registered exam folder.');
}

type ParsedExam = ReturnType<typeof parsePracticeExamHtml>;

/**
 * Parsed exams keyed by path, valid while the file's size and mtime are
 * unchanged. The library page re-listed (and fully re-parsed) every file on
 * each visit, and analytics re-parsed the same file once per attempt — all
 * synchronous work on the main thread. Treat the result as read-only.
 */
const parseCache = new Map<string, { stamp: string; parsed: ParsedExam }>();
const PARSE_CACHE_LIMIT = 64;

function parseExamFile(file: string): ParsedExam {
  const st = fs.statSync(file);
  const stamp = `${st.size}:${st.mtimeMs}`;
  const key = pathKey(file);
  const hit = parseCache.get(key);
  if (hit && hit.stamp === stamp) {
    parseCache.delete(key); // refresh LRU position
    parseCache.set(key, hit);
    return hit.parsed;
  }
  const parsed = parsePracticeExamHtml(fs.readFileSync(file, 'utf8'));
  parseCache.set(key, { stamp, parsed });
  while (parseCache.size > PARSE_CACHE_LIMIT) parseCache.delete(parseCache.keys().next().value as string);
  return parsed;
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
        const parsed = parseExamFile(file);
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
  let parsed: ParsedExam;
  try {
    parsed = parseExamFile(resolved);
  } catch {
    throw new ValidationError('Could not read this file. It may have been moved or deleted.');
  }
  if (!parsed || parsed.questions.length === 0) {
    throw new ValidationError('Could not understand this practice file.');
  }
  const questions: PracticeExamQuestion[] = parsed.questions.map((q) => ({
    question: q.question,
    options: q.options,
    correctIndices: q.correctIndices,
    explanation: q.explanation,
    topic: q.topic,
  }));
  const contentHash = hashQuestions(questions);
  rememberServed(resolved, contentHash, questions);
  return {
    title: parsed.title || titleFromFileName(resolved),
    description:
      `${parsed.questions.length} questions` +
      (parsed.skipped > 0 ? ` (${parsed.skipped} skipped)` : '') +
      ` · ${path.basename(resolved)}`,
    questions,
    contentHash,
  };
}

function hashQuestions(questions: PracticeExamQuestion[]): string {
  return createHash('sha256').update(JSON.stringify(questions)).digest('hex');
}

/**
 * The last few exam versions handed to the renderer, by file + hash. If the
 * file changes while someone is mid-exam, their submission is still scored
 * against the questions they were shown instead of being thrown away.
 */
const served = new Map<string, PracticeExamQuestion[]>();
const SERVED_LIMIT = 16;

function rememberServed(resolved: string, hash: string, questions: PracticeExamQuestion[]): void {
  const key = `${hash}:${resolved}`;
  served.delete(key);
  served.set(key, questions);
  while (served.size > SERVED_LIMIT) served.delete(served.keys().next().value as string);
}

function isQuestion(value: unknown): value is PracticeExamQuestion {
  if (typeof value !== 'object' || value === null) return false;
  const q = value as Record<string, unknown>;
  return (
    typeof q.question === 'string' &&
    Array.isArray(q.options) && q.options.every((o) => typeof o === 'string') &&
    Array.isArray(q.correctIndices) && q.correctIndices.every((n) => Number.isInteger(n)) &&
    typeof q.explanation === 'string'
  );
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
  contentHash?: unknown,
): QuizAttemptDetail {
  const current = loadExamFile(db, filePath);
  const resolved = path.resolve(filePath);
  // Score against the version the user was given. When the file changed
  // mid-exam that is the remembered copy, not what is on disk now.
  let exam: { questions: PracticeExamQuestion[]; contentHash: string } = current;
  if (typeof contentHash === 'string' && contentHash !== current.contentHash) {
    const answered = served.get(`${contentHash}:${resolved}`);
    if (!answered) {
      throw new ValidationError(
        'This exam file changed on disk while you were taking it, and the version you answered is no longer available. Your answers could not be scored.',
      );
    }
    exam = { questions: answered, contentHash };
  }
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
  const attemptId = db.transaction(() => {
    saveExamSnapshot(db, exam.contentHash, exam.questions);
    return insertPracticeAttempt(db, {
      sourcePath: resolved,
      score,
      total: exam.questions.length,
      selections: perQuestion.map((a) => a.selected),
      durations: perQuestion.map((a) => Math.round(a.seconds * 10) / 10),
      flags: flagList,
      contentHash: exam.contentHash,
    });
  })();
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
  const summary = {
    id: row.id,
    quizId: -1,
    score: row.score,
    total: row.total,
    percent: row.total > 0 ? Math.round((row.score / row.total) * 100) : 0,
    createdAt: row.createdAt,
    flagged: row.flags,
  };

  // Attempts carry their own copy of the questions; older ones fall back to
  // the file, which only works while it still matches what was answered.
  let questions: PracticeExamQuestion[];
  const snapshot = row.contentHash ? getExamSnapshot(db, row.contentHash) : null;
  if (snapshot && snapshot.every(isQuestion)) {
    questions = snapshot;
  } else {
    let exam: PracticeExamContent;
    try {
      exam = loadExamFile(db, row.sourcePath);
    } catch {
      return {
        ...summary,
        answers: [],
        unavailableReason:
          'The exam file for this attempt can no longer be read, so its questions cannot be shown. The score is kept.',
      };
    }
    const matches = row.contentHash
      ? exam.contentHash === row.contentHash
      : exam.questions.length === row.selections.length;
    if (!matches) {
      return {
        ...summary,
        answers: [],
        unavailableReason:
          'The exam file has changed since this attempt, so its questions cannot be matched to your answers. The score is kept.',
      };
    }
    questions = exam.questions;
  }

  const answers = questions.map((q, i) => {
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
      topic: typeof q.topic === 'string' ? q.topic : '',
      seconds: row.durations[i] ?? 0,
    };
  });
  return { ...summary, answers };
}
