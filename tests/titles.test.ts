import { describe, expect, it } from 'vitest';
import { cleanTitle, courseInitials, titleHue } from '../src/utils/titles';

describe('cleanTitle', () => {
  it('strips marketplace prefixes and suffixes', () => {
    expect(cleanTitle('Udemy - AWS Solutions Architect')).toBe('AWS Solutions Architect');
    expect(cleanTitle('Python Bootcamp - Udemy')).toBe('Python Bootcamp');
    expect(cleanTitle('Coursera: Machine Learning')).toBe('Machine Learning');
  });

  it('strips resolution tags', () => {
    expect(cleanTitle('React Course 1080p')).toBe('React Course');
    expect(cleanTitle('React Course (1080)')).toBe('React Course');
    expect(cleanTitle('Design Basics 1080')).toBe('Design Basics');
    expect(cleanTitle('Video Editing 4K')).toBe('Video Editing');
  });

  it('strips date suffixes', () => {
    expect(cleanTitle('TypeScript Guide 2026-6')).toBe('TypeScript Guide');
    expect(cleanTitle('TypeScript Guide - 2026-6')).toBe('TypeScript Guide');
    expect(cleanTitle('TypeScript Guide (2024_12)')).toBe('TypeScript Guide');
  });

  it('combines all noise patterns', () => {
    expect(cleanTitle('Udemy - Complete Blender Course 1080p - 2026-6')).toBe('Complete Blender Course');
  });

  it('leaves legitimate titles untouched', () => {
    expect(cleanTitle('CS101 - Introduction to Programming')).toBe('CS101 - Introduction to Programming');
    expect(cleanTitle('Vitamin K Guide')).toBe('Vitamin K Guide');
    expect(cleanTitle('Machine Learning A-Z')).toBe('Machine Learning A-Z');
    expect(cleanTitle('Top 10 Guitar Lessons')).toBe('Top 10 Guitar Lessons');
  });

  it('handles empty input', () => {
    expect(cleanTitle('')).toBe('');
  });
});

describe('courseInitials', () => {
  it('takes first letters of the first two words', () => {
    expect(courseInitials('AWS Solutions Architect')).toBe('AS');
    expect(courseInitials('Udemy - Python Bootcamp 1080')).toBe('PB');
  });

  it('falls back to two letters for single words', () => {
    expect(courseInitials('Python')).toBe('PY');
  });
});

describe('titleHue', () => {
  it('is deterministic and within range', () => {
    const a = titleHue('AWS Solutions Architect');
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(360);
    expect(titleHue('AWS Solutions Architect')).toBe(a);
    expect(titleHue('Something else')).not.toBe(a);
  });
});
