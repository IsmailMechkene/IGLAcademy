/**
 * The saved state of a practice-exam run, so closing the app mid-exam can be
 * resumed. Stored by the main process as opaque JSON; everything read back is
 * validated here, because it outlives app versions and file edits.
 */

/** What a runner reports as it goes (question ids are indices in the FILE). */
export interface RunSnapshot {
  current: number;
  /** question id -> selected option indices as DISPLAYED (shuffle-aware). */
  answers: Array<[number, number[]]>;
  flagged: number[];
  /** Practice mode: questions whose answer has been revealed. */
  revealed: number[];
  /** question id -> seconds spent. */
  timings: Array<[number, number]>;
}

export interface ExamSession extends RunSnapshot {
  version: 1;
  mode: 'exam' | 'practice';
  /** Shuffle seed, or null for file order. */
  seed: number | null;
  /** Exam mode: wall-clock deadline (epoch ms). The clock runs while closed. */
  deadlineAt: number | null;
  /** The exam version answered; a changed file voids the session. */
  contentHash: string;
  startedAt: number;
  savedAt: number;
}

export const EMPTY_SNAPSHOT: RunSnapshot = { current: 0, answers: [], flagged: [], revealed: [], timings: [] };

const isInt = (n: unknown, min = 0): n is number => typeof n === 'number' && Number.isInteger(n) && n >= min;
const isTime = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/**
 * Returns the session when it is well-formed and belongs to this exact exam
 * version, otherwise null (the caller then discards it).
 */
export function parseSession(raw: unknown, contentHash: string, questionCount: number): ExamSession | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const s = raw as Record<string, unknown>;
  if (s.version !== 1 || (s.mode !== 'exam' && s.mode !== 'practice')) return null;
  if (s.contentHash !== contentHash) return null;
  if (!(s.seed === null || isInt(s.seed))) return null;
  if (!(s.deadlineAt === null || isTime(s.deadlineAt))) return null;
  if (s.mode === 'exam' && s.deadlineAt === null) return null;
  if (!isTime(s.startedAt) || !isTime(s.savedAt)) return null;
  if (!isInt(s.current) || s.current >= questionCount) return null;

  const validQuestion = (q: unknown): q is number => isInt(q) && q < questionCount;
  if (!Array.isArray(s.answers) || !Array.isArray(s.flagged) || !Array.isArray(s.revealed) || !Array.isArray(s.timings)) {
    return null;
  }
  const answers: Array<[number, number[]]> = [];
  for (const entry of s.answers) {
    if (!Array.isArray(entry) || entry.length !== 2 || !validQuestion(entry[0]) || !Array.isArray(entry[1])) return null;
    if (!entry[1].every((o) => isInt(o) && o < 26)) return null;
    answers.push([entry[0], entry[1] as number[]]);
  }
  const timings: Array<[number, number]> = [];
  for (const entry of s.timings) {
    if (!Array.isArray(entry) || entry.length !== 2 || !validQuestion(entry[0])) return null;
    if (typeof entry[1] !== 'number' || !Number.isFinite(entry[1]) || entry[1] < 0) return null;
    timings.push([entry[0], entry[1]]);
  }
  if (!s.flagged.every(validQuestion) || !s.revealed.every(validQuestion)) return null;

  return {
    version: 1,
    mode: s.mode,
    seed: s.seed as number | null,
    deadlineAt: s.deadlineAt as number | null,
    contentHash,
    startedAt: s.startedAt,
    savedAt: s.savedAt,
    current: s.current,
    answers,
    flagged: s.flagged as number[],
    revealed: s.revealed as number[],
    timings,
  };
}

/** Questions with at least one selected option. */
export function answeredCount(session: RunSnapshot): number {
  return session.answers.filter(([, sel]) => sel.length > 0).length;
}
