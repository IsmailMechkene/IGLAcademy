import type { PracticeExamQuestion } from '../types';

export interface TopicScore {
  topic: string;
  correct: number;
  total: number;
  percent: number;
}

export interface AttemptPoint {
  id: number;
  percent: number;
  createdAt: string;
}

/** Per-topic correctness for one attempt (topics from the live exam content). */
export function topicScores(
  questions: PracticeExamQuestion[],
  selectedByIndex: number[][],
): TopicScore[] {
  const map = new Map<string, { correct: number; total: number }>();
  questions.forEach((q, i) => {
    const topic = q.topic.trim() || 'General';
    const entry = map.get(topic) ?? { correct: 0, total: 0 };
    entry.total += 1;
    const sel = [...(selectedByIndex[i] ?? [])].sort((a, b) => a - b);
    const correct = [...q.correctIndices].sort((a, b) => a - b);
    if (sel.length === correct.length && sel.every((v, j) => v === correct[j])) {
      entry.correct += 1;
    }
    map.set(topic, entry);
  });
  return [...map.entries()]
    .map(([topic, s]) => ({
      topic,
      correct: s.correct,
      total: s.total,
      percent: s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0,
    }))
    .sort((a, b) => a.percent - b.percent || b.total - a.total);
}

/** Retake comparison between the two most recent attempts. */
export function compareAttempts(
  attempts: AttemptPoint[],
): { delta: number; previous: AttemptPoint; latest: AttemptPoint } | null {
  if (attempts.length < 2) return null;
  const sorted = [...attempts].sort((a, b) => a.id - b.id);
  const previous = sorted[sorted.length - 2];
  const latest = sorted[sorted.length - 1];
  return { delta: latest.percent - previous.percent, previous, latest };
}

/** Average seconds per question + slowest entries from recorded durations. */
export function timingSummary(
  durations: number[],
  count: number,
): { averageSeconds: number; slowest: Array<{ index: number; seconds: number }> } {
  const vals = durations.slice(0, count);
  const averageSeconds = vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
  const slowest = vals
    .map((seconds, index) => ({ index, seconds }))
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 3);
  return { averageSeconds: Math.round(averageSeconds * 10) / 10, slowest };
}

/**
 * Deterministic shuffle (mulberry32). Returns display order plus, per
 * question, the mapping from displayed option position to original index so
 * answers can be normalized back before submit.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffledIndexes(length: number, rand: () => number): number[] {
  const order = Array.from({ length }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

export function normalizeSelected(displayed: number[], optionOrder: number[]): number[] {
  return [...new Set(displayed.map((d) => optionOrder[d]).filter((n) => n !== undefined))].sort((a, b) => a - b);
}
