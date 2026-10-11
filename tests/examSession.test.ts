import { describe, expect, it } from 'vitest';
import { answeredCount, parseSession, type ExamSession } from '../src/utils/examSession';

const base: ExamSession = {
  version: 1,
  mode: 'exam',
  seed: 12345,
  deadlineAt: 2_000_000_000_000,
  contentHash: 'abc',
  startedAt: 1_900_000_000_000,
  savedAt: 1_900_000_100_000,
  current: 2,
  answers: [[0, [1]], [3, []], [4, [0, 2]]],
  flagged: [4],
  revealed: [],
  timings: [[0, 12.5]],
};

describe('parseSession', () => {
  it('accepts a well-formed session for the same exam version', () => {
    expect(parseSession(JSON.parse(JSON.stringify(base)), 'abc', 10)).toEqual(base);
  });

  it('voids a session for a different version of the file', () => {
    expect(parseSession(base, 'other-hash', 10)).toBeNull();
  });

  it('rejects malformed or out-of-range data', () => {
    expect(parseSession(null, 'abc', 10)).toBeNull();
    expect(parseSession({ ...base, version: 2 }, 'abc', 10)).toBeNull();
    expect(parseSession({ ...base, current: 10 }, 'abc', 10)).toBeNull();
    expect(parseSession({ ...base, answers: [[11, [0]]] }, 'abc', 10)).toBeNull();
    expect(parseSession({ ...base, answers: [[0, [-1]]] }, 'abc', 10)).toBeNull();
    expect(parseSession({ ...base, flagged: ['x'] }, 'abc', 10)).toBeNull();
    expect(parseSession({ ...base, mode: 'exam', deadlineAt: null }, 'abc', 10)).toBeNull();
    expect(parseSession({ ...base, timings: [[0, -3]] }, 'abc', 10)).toBeNull();
  });

  it('allows untimed practice sessions', () => {
    expect(parseSession({ ...base, mode: 'practice', deadlineAt: null, revealed: [0] }, 'abc', 10)?.mode).toBe('practice');
  });
});

describe('answeredCount', () => {
  it('counts only questions with a selection', () => {
    expect(answeredCount(base)).toBe(2);
  });
});
