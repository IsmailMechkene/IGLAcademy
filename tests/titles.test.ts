import { describe, expect, it } from 'vitest';
import { cleanTitle, courseInitials, titleHue, examGroupInfo } from '../src/utils/titles';

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

describe('examGroupInfo', () => {
  it('extracts known exam codes with certification names', () => {
    expect(examGroupInfo('Practice Test #1 (AWS Certified Solutions Architect Associate SAA-C03)')).toEqual({
      code: 'SAA-C03',
      name: 'AWS Certified Solutions Architect – Associate',
    });
    expect(examGroupInfo('Practice Test #1 (AWS Certified Developer Associate - DVA-C02)')).toEqual({
      code: 'DVA-C02',
      name: 'AWS Certified Developer – Associate',
    });
  });

  it('falls back to the raw code for unknown exams', () => {
    expect(examGroupInfo('Practice Test #1 (XYZ-C99)')).toEqual({ code: 'XYZ-C99', name: 'XYZ-C99' });
  });

  it('derives a group from the certification name when no code is present', () => {
    expect(examGroupInfo('Practice Test #1 - AWS Certified Solutions Architect Associate')).toEqual({
      code: null,
      name: 'AWS Certified Solutions Architect Associate',
    });
    // all-caps words (AI, AWS) keep their casing
    expect(examGroupInfo('Practice Test #1 - Full-Exam - AWS Certified AI Practitioner')).toEqual({
      code: null,
      name: 'AWS Certified AI Practitioner',
    });
  });

  it('groups unrecognized titles under Other', () => {
    expect(examGroupInfo('Random Networking Quiz')).toEqual({ code: null, name: 'Other practice exams' });
  });
});
