import type { FlashGrade } from '../types';

export interface CardScheduling {
  ease: number;
  intervalDays: number;
  reps: number;
}

export interface ReviewResult extends CardScheduling {
  dueAt: string;
}

const DAY_MS = 24 * 3600 * 1000;

/**
 * Simplified SM-2 scheduling for flashcards.
 * - again: reset progress, review tomorrow, lower ease
 * - hard: small ease penalty, slightly stretched interval
 * - good: standard easiness-scaled interval (1d, then 6d, then scaled)
 * - easy: ease bonus and stretched interval
 */
export function scheduleReview(
  card: CardScheduling,
  grade: FlashGrade,
  now = Date.now(),
): ReviewResult {
  let { ease, intervalDays, reps } = card;
  reps += 1;

  if (grade === 'again') {
    return {
      ease: Math.max(1.3, ease - 0.2),
      intervalDays: 1,
      reps: 0,
      dueAt: new Date(now + DAY_MS).toISOString(),
    };
  }
  if (grade === 'hard') {
    ease = Math.max(1.3, ease - 0.15);
    intervalDays = reps <= 1 ? 1 : Math.max(1, Math.round(intervalDays * 1.2));
  } else if (grade === 'good') {
    intervalDays = reps <= 1 ? 1 : reps === 2 ? 6 : Math.max(1, Math.round(intervalDays * ease));
  } else {
    ease = ease + 0.15;
    intervalDays = Math.max(4, Math.round(Math.max(1, intervalDays) * ease * 1.3));
  }
  return {
    ease: Math.round(ease * 100) / 100,
    intervalDays,
    reps,
    dueAt: new Date(now + intervalDays * DAY_MS).toISOString(),
  };
}
