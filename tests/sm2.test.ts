import { describe, expect, it } from 'vitest';
import { scheduleReview } from '../src/utils/sm2';

const NOW = new Date('2026-10-04T12:00:00Z').getTime();
const FRESH = { ease: 2.5, intervalDays: 0, reps: 0 };

describe('scheduleReview (SM-2)', () => {
  it('starts new cards at 1 day on good', () => {
    const r = scheduleReview(FRESH, 'good', NOW);
    expect(r.intervalDays).toBe(1);
    expect(r.reps).toBe(1);
    expect(new Date(r.dueAt).getTime()).toBe(NOW + 24 * 3600 * 1000);
  });

  it('uses 6 days on the second good recall', () => {
    const first = scheduleReview(FRESH, 'good', NOW);
    const second = scheduleReview(first, 'good', NOW);
    expect(second.intervalDays).toBe(6);
    expect(second.reps).toBe(2);
  });

  it('resets progress on again with an ease penalty', () => {
    const known = { ease: 2.5, intervalDays: 30, reps: 5 };
    const r = scheduleReview(known, 'again', NOW);
    expect(r.reps).toBe(0);
    expect(r.intervalDays).toBe(1);
    expect(r.ease).toBeLessThan(2.5);
  });

  it('rewards easy recalls with longer intervals and higher ease', () => {
    const base = { ease: 2.5, intervalDays: 6, reps: 2 };
    const easy = scheduleReview(base, 'easy', NOW);
    const good = scheduleReview(base, 'good', NOW);
    expect(easy.intervalDays).toBeGreaterThan(good.intervalDays);
    expect(easy.ease).toBeGreaterThan(good.ease);
  });

  it('never drops ease below the 1.3 floor', () => {
    let card = { ease: 1.35, intervalDays: 10, reps: 4 };
    for (let i = 0; i < 5; i++) {
      card = { ...scheduleReview(card, 'again', NOW), intervalDays: card.intervalDays, reps: card.reps };
    }
    expect(card.ease).toBeGreaterThanOrEqual(1.3);
  });

  it('keeps intervals at whole days of at least one', () => {
    const r = scheduleReview({ ease: 2.5, intervalDays: 0, reps: 0 }, 'hard', NOW);
    expect(r.intervalDays).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(r.intervalDays)).toBe(true);
  });
});
