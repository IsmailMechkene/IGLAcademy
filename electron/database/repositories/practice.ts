import type Database from 'better-sqlite3';
import type { ExamSource, QuizAttemptSummary } from '../../../src/types';
import { isInsideDir } from '../../services/pathIdentity';

interface SourceRow {
  id: number;
  path: string;
  kind: string;
  created_at: string;
}

function toSource(row: SourceRow): ExamSource {
  return {
    id: row.id,
    path: row.path,
    kind: row.kind === 'file' ? 'file' : 'dir',
    createdAt: row.created_at,
  };
}

export function listSources(db: Database.Database): ExamSource[] {
  return (
    db.prepare('SELECT * FROM exam_sources ORDER BY created_at').all() as SourceRow[]
  ).map(toSource);
}

export function getSource(db: Database.Database, id: number): ExamSource | null {
  const row = db.prepare('SELECT * FROM exam_sources WHERE id = ?').get(id) as
    | SourceRow
    | undefined;
  return row ? toSource(row) : null;
}

export function findSourceByPath(db: Database.Database, resolvedPath: string): ExamSource | null {
  const row = db.prepare('SELECT * FROM exam_sources WHERE path = ?').get(resolvedPath) as
    | SourceRow
    | undefined;
  return row ? toSource(row) : null;
}

export function insertSource(
  db: Database.Database,
  data: { path: string; kind: 'file' | 'dir' },
): ExamSource {
  const info = db
    .prepare('INSERT INTO exam_sources (path, kind) VALUES (?, ?)')
    .run(data.path, data.kind);
  return getSource(db, Number(info.lastInsertRowid))!;
}

export function deleteSource(db: Database.Database, id: number): void {
  const source = getSource(db, id);
  db.prepare('DELETE FROM exam_sources WHERE id = ?').run(id);
  if (!source) return;
  // Attempts belong to the removed source's files and cannot be reviewed
  // without them, so they go too.
  if (source.kind === 'file') {
    db.prepare('DELETE FROM practice_attempts WHERE source_path = ?').run(source.path);
  } else {
    // JS-side prefix filtering: LIKE + ESCAPE handling of Windows paths is
    // unreliable, and attempt tables are tiny.
    const rows = db.prepare('SELECT DISTINCT source_path FROM practice_attempts').all() as Array<{
      source_path: string;
    }>;
    const stmt = db.prepare('DELETE FROM practice_attempts WHERE source_path = ?');
    for (const row of rows) {
      if (isInsideDir(source.path, row.source_path)) stmt.run(row.source_path);
    }
  }
  pruneExamSnapshots(db);
  deleteSessionsOutside(db);
}

/** Session keys for course quizzes; exam files use their resolved path. */
export const QUIZ_SESSION_PREFIX = 'quiz:';

/** The in-progress run for an exam file, if any (raw JSON, owned by the renderer). */
export function getExamSession(db: Database.Database, sourcePath: string): { state: string; updatedAt: string } | null {
  const row = db.prepare('SELECT state, updated_at FROM exam_sessions WHERE source_path = ?').get(sourcePath) as
    | { state: string; updated_at: string }
    | undefined;
  return row ? { state: row.state, updatedAt: row.updated_at } : null;
}

export function saveExamSession(db: Database.Database, sourcePath: string, state: string): void {
  db.prepare(
    `INSERT INTO exam_sessions (source_path, state, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(source_path) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
  ).run(sourcePath, state, new Date().toISOString());
}

export function deleteExamSession(db: Database.Database, sourcePath: string): void {
  db.prepare('DELETE FROM exam_sessions WHERE source_path = ?').run(sourcePath);
}

/** Drops sessions whose file no longer belongs to any registered source. */
function deleteSessionsOutside(db: Database.Database): void {
  const sources = listSources(db);
  const rows = db.prepare('SELECT source_path FROM exam_sessions').all() as Array<{ source_path: string }>;
  const stmt = db.prepare('DELETE FROM exam_sessions WHERE source_path = ?');
  for (const row of rows) {
    // Course-quiz runs ("quiz:<id>") are not exam files; never prune them here.
    if (row.source_path.startsWith(QUIZ_SESSION_PREFIX)) continue;
    const covered = sources.some((s) =>
      s.kind === 'file' ? s.path === row.source_path : isInsideDir(s.path, row.source_path),
    );
    if (!covered) stmt.run(row.source_path);
  }
}

export interface PracticeStats {
  attemptCount: number;
  bestPercent: number | null;
  lastAttemptAt: string | null;
}

export function getPracticeStats(db: Database.Database, filePath: string): PracticeStats {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n,
        MAX(CAST(score AS REAL) / NULLIF(total, 0)) AS best,
        MAX(created_at) AS last_at
       FROM practice_attempts WHERE source_path = ?`,
    )
    .get(filePath) as { n: number; best: number | null; last_at: string | null };
  return {
    attemptCount: row.n,
    bestPercent: row.best === null ? null : Math.round(row.best * 100),
    lastAttemptAt: row.last_at,
  };
}

export function insertPracticeAttempt(
  db: Database.Database,
  data: {
    sourcePath: string; score: number; total: number; selections: number[][];
    durations?: number[]; flags?: number[]; contentHash?: string | null;
  },
): number {
  const info = db
    .prepare(
      `INSERT INTO practice_attempts (source_path, score, total, selections, durations, flags, content_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      data.sourcePath,
      data.score,
      data.total,
      JSON.stringify(data.selections),
      JSON.stringify(data.durations ?? []),
      JSON.stringify(data.flags ?? []),
      data.contentHash ?? null,
    );
  return Number(info.lastInsertRowid);
}

/** Stores one version of an exam's questions (idempotent per hash). */
export function saveExamSnapshot(db: Database.Database, contentHash: string, questions: unknown): void {
  db.prepare('INSERT OR IGNORE INTO practice_exam_snapshots (content_hash, questions) VALUES (?, ?)').run(
    contentHash,
    JSON.stringify(questions),
  );
}

export function getExamSnapshot(db: Database.Database, contentHash: string): unknown[] | null {
  const row = db.prepare('SELECT questions FROM practice_exam_snapshots WHERE content_hash = ?').get(contentHash) as
    | { questions: string }
    | undefined;
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.questions) as unknown;
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Drops snapshots no attempt refers to any more. */
export function pruneExamSnapshots(db: Database.Database): void {
  db.prepare(
    `DELETE FROM practice_exam_snapshots WHERE content_hash NOT IN
       (SELECT content_hash FROM practice_attempts WHERE content_hash IS NOT NULL)`,
  ).run();
}

export function listPracticeAttempts(db: Database.Database, filePath: string): QuizAttemptSummary[] {
  return (
    db
      .prepare('SELECT * FROM practice_attempts WHERE source_path = ? ORDER BY id DESC')
      .all(filePath) as Array<{ id: number; score: number; total: number; created_at: string }>
  ).map((a) => ({
    id: a.id,
    quizId: -1,
    score: a.score,
    total: a.total,
    percent: a.total > 0 ? Math.round((a.score / a.total) * 100) : 0,
    createdAt: a.created_at,
  }));
}

export function getPracticeAttempt(
  db: Database.Database,
  attemptId: number,
): {
  id: number; sourcePath: string; score: number; total: number; selections: number[][];
  durations: number[]; flags: number[]; createdAt: string; contentHash: string | null;
} | null {
  const row = db.prepare('SELECT * FROM practice_attempts WHERE id = ?').get(attemptId) as
    | {
        id: number; source_path: string; score: number; total: number; selections: string;
        durations: string | null; flags: string | null; created_at: string; content_hash: string | null;
      }
    | undefined;
  if (!row) return null;
  const parseNumArray = (raw: string | null): number[] => {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.filter((n): n is number => typeof n === 'number' && Number.isFinite(n)) : [];
    } catch {
      return [];
    }
  };
  let selections: number[][] = [];
  try {
    const parsed = JSON.parse(row.selections) as unknown;
    if (Array.isArray(parsed)) {
      selections = parsed.map((s) => (Array.isArray(s) ? s.filter((n) => Number.isInteger(n)) : []));
    }
  } catch {
    selections = [];
  }
  return {
    id: row.id,
    sourcePath: row.source_path,
    contentHash: row.content_hash,
    score: row.score,
    total: row.total,
    selections,
    durations: parseNumArray(row.durations),
    flags: parseNumArray(row.flags).filter((n) => Number.isInteger(n)),
    createdAt: row.created_at,
  };
}
