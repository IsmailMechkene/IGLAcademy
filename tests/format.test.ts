import { describe, expect, it } from 'vitest';
import { timeAgo, parseDbTime, formatCountdown, formatDateTime, formatDate, markdownPreview, formatLength } from '../src/utils/format';

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

describe('formatDate / formatDateTime (M2)', () => {
  it('reads SQLite timestamps as UTC, exactly like ISO ones', () => {
    // Same instant, two storage formats: both must render identically.
    expect(formatDateTime('2026-10-11 17:13:29')).toBe(formatDateTime('2026-10-11T17:13:29Z'));
    expect(formatDate('2026-10-11 23:30:00')).toBe(formatDate('2026-10-11T23:30:00Z'));
  });

  it('handles missing or invalid input', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDate('garbage')).toBe('—');
  });
});

describe('markdownPreview', () => {
  it('strips markdown syntax into a single line', () => {
    expect(markdownPreview('## Domains\n- Resilient 26%\n- Fast 24%\n\nSee [0:03](t=3)')).toBe('Domains Resilient 26% Fast 24% See 0:03');
    expect(markdownPreview('Never use **root**. Enable `MFA`.')).toBe('Never use root. Enable MFA.');
  });

  it('truncates long text', () => {
    expect(markdownPreview('a'.repeat(200), 10)).toBe('aaaaaaaaa…');
  });
});

describe('formatLength', () => {
  it('scales units to the length', () => {
    expect(formatLength(0)).toBe('');
    expect(formatLength(30)).toBe('30 sec');
    expect(formatLength(12 * 60)).toBe('12 min');
    expect(formatLength(120 * 60)).toBe('2 h');
    expect(formatLength(125 * 60)).toBe('2 h 5 min');
  });
});
