import { describe, expect, it } from 'vitest';
import { timeAgo, parseDbTime, formatCountdown } from '../src/utils/format';

const NOW = new Date('2026-10-03T20:00:00Z').getTime();

describe('timeAgo', () => {
  it('handles recent times', () => {
    expect(timeAgo(new Date(NOW - 5000).toISOString(), NOW)).toBe('just now');
    expect(timeAgo(new Date(NOW - 4 * 60000).toISOString(), NOW)).toBe('4 min ago');
    expect(timeAgo(new Date(NOW - 2 * 3600000).toISOString(), NOW)).toBe('2 hours ago');
    expect(timeAgo(new Date(NOW - 3600000).toISOString(), NOW)).toBe('1 hour ago');
    expect(timeAgo(new Date(NOW - 3 * 86400000).toISOString(), NOW)).toBe('3 days ago');
  });

  it('parses SQLite datetime values as UTC', () => {
    // datetime('now') format without timezone marker
    expect(parseDbTime('2026-10-03 19:00:00')).toBe(new Date('2026-10-03T19:00:00Z').getTime());
    expect(timeAgo('2026-10-03 19:00:00', NOW)).toBe('1 hour ago');
  });

  it('handles missing or invalid input', () => {
    expect(timeAgo(null)).toBe('—');
    expect(timeAgo('not-a-date')).toBe('—');
  });
});

describe('formatCountdown', () => {
  it('formats exam clocks', () => {
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(59)).toBe('0:59');
    expect(formatCountdown(60)).toBe('1:00');
    expect(formatCountdown(600)).toBe('10:00');
    expect(formatCountdown(3600)).toBe('1:00:00');
    expect(formatCountdown(65 * 120)).toBe('2:10:00');
    expect(formatCountdown(-5)).toBe('0:00');
  });
});
