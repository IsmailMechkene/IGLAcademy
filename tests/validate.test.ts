import { describe, expect, it } from 'vitest';
import {
  ValidationError,
  requireString,
  optionalString,
  requireId,
  optionalId,
  requireEnum,
  requirePath,
  optionalTimestamp,
} from '../electron/services/validate';

describe('validate helpers', () => {
  it('requireString trims and rejects empty/non-string values', () => {
    expect(requireString('  hello  ', 'f')).toBe('hello');
    expect(() => requireString('', 'f')).toThrow(ValidationError);
    expect(() => requireString('   ', 'f')).toThrow(ValidationError);
    expect(() => requireString(42, 'f')).toThrow(ValidationError);
    expect(() => requireString('x'.repeat(501), 'f')).toThrow(ValidationError);
  });

  it('optionalString returns empty string for null/undefined', () => {
    expect(optionalString(undefined, 'f')).toBe('');
    expect(optionalString(null, 'f')).toBe('');
    expect(optionalString('ok', 'f')).toBe('ok');
    expect(() => optionalString(42, 'f')).toThrow(ValidationError);
  });

  it('requireId accepts positive integers only', () => {
    expect(requireId(5, 'id')).toBe(5);
    expect(requireId('7', 'id')).toBe(7);
    expect(() => requireId(0, 'id')).toThrow(ValidationError);
    expect(() => requireId(-1, 'id')).toThrow(ValidationError);
    expect(() => requireId(1.5, 'id')).toThrow(ValidationError);
    expect(() => requireId('abc', 'id')).toThrow(ValidationError);
  });

  it('optionalId returns null for missing values', () => {
    expect(optionalId(undefined, 'id')).toBeNull();
    expect(optionalId(null, 'id')).toBeNull();
    expect(optionalId(3, 'id')).toBe(3);
  });

  it('requireEnum rejects values outside the allowed set', () => {
    expect(requireEnum('dark', ['dark', 'light'] as const, 'theme')).toBe('dark');
    expect(() => requireEnum('blue', ['dark', 'light'] as const, 'theme')).toThrow(ValidationError);
  });

  it('requirePath rejects null bytes', () => {
    expect(requirePath('C:\\courses\\aws', 'p')).toBe('C:\\courses\\aws');
    expect(() => requirePath('a\0b', 'p')).toThrow(ValidationError);
  });
});

describe('optionalTimestamp', () => {
  it('canonicalises to ISO-8601 UTC and falls back when absent', () => {
    expect(optionalTimestamp('2030-01-01T12:00:00Z', 'f', 'x')).toBe('2030-01-01T12:00:00.000Z');
    expect(optionalTimestamp('2030-01-01T13:00:00+01:00', 'f', 'x')).toBe('2030-01-01T12:00:00.000Z');
    expect(optionalTimestamp(undefined, 'f', 'fallback')).toBe('fallback');
    expect(optionalTimestamp('', 'f', 'fallback')).toBe('fallback');
  });

  it('rejects non-dates', () => {
    expect(() => optionalTimestamp('tomorrow-ish', 'f', 'x')).toThrow(ValidationError);
    expect(() => optionalTimestamp(42, 'f', 'x')).toThrow(ValidationError);
  });
});
