import { describe, expect, it } from 'vitest';
import {
  compareAttempts,
  mulberry32,
  normalizeSelected,
  shuffledIndexes,
  timingSummary,
  topicScores,
} from '../src/utils/examAnalytics';
import type { PracticeExamQuestion } from '../src/types';

const QUESTIONS: PracticeExamQuestion[] = [
  { question: 'Q1', options: ['a', 'b'], correctIndices: [0], explanation: '', topic: 'Security' },
  { question: 'Q2', options: ['a', 'b'], correctIndices: [1], explanation: '', topic: 'Security' },
  { question: 'Q3', options: ['a', 'b'], correctIndices: [0], explanation: '', topic: 'Storage' },
];

describe('topicScores', () => {
  it('aggregates per-topic correctness, weakest first', () => {
    const scores = topicScores(QUESTIONS, [[0], [0], [0]]);
    expect(scores).toEqual([
      { topic: 'Security', correct: 1, total: 2, percent: 50 },
      { topic: 'Storage', correct: 1, total: 1, percent: 100 },
    ]);
  });

  it('groups untagged questions under General', () => {
    const scores = topicScores(
      [{ question: 'Q', options: ['a'], correctIndices: [0], explanation: '', topic: '' }],
      [[1]],
    );
    expect(scores[0].topic).toBe('General');
    expect(scores[0].percent).toBe(0);
  });
});

describe('compareAttempts', () => {
  it('returns null with fewer than two attempts', () => {
    expect(compareAttempts([])).toBeNull();
    expect(compareAttempts([{ id: 1, percent: 80, createdAt: '' }])).toBeNull();
  });

  it('compares the two latest attempts', () => {
    const result = compareAttempts([
      { id: 1, percent: 60, createdAt: '' },
      { id: 2, percent: 50, createdAt: '' },
      { id: 3, percent: 80, createdAt: '' },
    ]);
    expect(result?.delta).toBe(30);
    expect(result?.latest.percent).toBe(80);
  });
});

describe('timingSummary', () => {
  it('averages and ranks the slowest questions', () => {
    const summary = timingSummary([10, 30, 20], 3);
    expect(summary.averageSeconds).toBe(20);
    expect(summary.slowest.map((s) => s.index)).toEqual([1, 2, 0]);
  });
});

describe('shuffle helpers', () => {
  it('produces deterministic permutations with a seed', () => {
    const a = shuffledIndexes(10, mulberry32(42));
    const b = shuffledIndexes(10, mulberry32(42));
    const c = shuffledIndexes(10, mulberry32(7));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect([...a].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('normalizes display positions back to original indices', () => {
    // displayed [x, y] came from original [2, 0]
    expect(normalizeSelected([0, 1], [2, 0, 1])).toEqual([0, 2]);
    expect(normalizeSelected([5], [2, 0, 1])).toEqual([]);
  });
});
