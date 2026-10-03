import { describe, expect, it } from 'vitest';
import { naturalCompare, naturalSort } from '../electron/services/naturalSort';

describe('naturalCompare', () => {
  it('sorts numbered prefixes numerically, not lexicographically', () => {
    const input = ['10 - VPC.mp4', '2 - EC2.mp4', '1 - Intro.mp4'];
    expect([...input].sort(naturalCompare)).toEqual([
      '1 - Intro.mp4',
      '2 - EC2.mp4',
      '10 - VPC.mp4',
    ]);
  });

  it('handles multi-level numbering', () => {
    const input = ['2.10 Lesson.mp4', '2.2 Lesson.mp4', '2.1 Lesson.mp4'];
    expect([...input].sort(naturalCompare)).toEqual([
      '2.1 Lesson.mp4',
      '2.2 Lesson.mp4',
      '2.10 Lesson.mp4',
    ]);
  });

  it('sorts case-insensitively for text parts', () => {
    expect(naturalCompare('apple', 'Banana')).toBeLessThan(0);
    expect(naturalCompare('Banana', 'apple')).toBeGreaterThan(0);
  });

  it('is deterministic for equal keys', () => {
    expect(naturalCompare('Lesson 1', 'Lesson 1')).toBe(0);
  });

  it('puts shorter prefixes first when one is a prefix of the other', () => {
    expect(naturalCompare('Lesson', 'Lesson 2')).toBeLessThan(0);
  });
});

describe('naturalSort', () => {
  it('sorts objects by a key selector without mutating the input', () => {
    const input = [{ name: '10' }, { name: '2' }, { name: '1' }];
    const sorted = naturalSort(input, (x) => x.name);
    expect(sorted.map((x) => x.name)).toEqual(['1', '2', '10']);
    expect(input.map((x) => x.name)).toEqual(['10', '2', '1']);
  });
});
