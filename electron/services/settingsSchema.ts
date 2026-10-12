import { DAILY_GOAL_OPTIONS, DEFAULT_SETTINGS, PLAYBACK_SPEEDS } from '../../src/types';
import type { AppSettings } from '../../src/types';
import { requireEnum, ValidationError } from './validate';

/**
 * The single definition of what a valid setting is. `settings:set` rejects
 * anything else, and `getAllSettings` ignores stored rows that fail it, so an
 * unknown key or a hand-edited value can never reach the renderer.
 */

export function isSettingKey(key: string): key is keyof AppSettings {
  return Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key);
}

function requireIntIn(value: unknown, key: string, min: number, max: number, message: string): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new ValidationError(`${key} ${message}`);
  }
}

/** Throws ValidationError unless `key` is a known setting and `value` is legal for it. */
export function validateSetting(key: string, value: unknown): void {
  if (!isSettingKey(key)) throw new ValidationError(`Unknown setting: ${key}`);
  switch (key) {
    case 'theme':
      requireEnum(value, ['dark', 'light', 'system'] as const, 'theme');
      return;
    case 'resumePlayback':
      requireEnum(value, ['ask', 'always', 'never'] as const, 'resumePlayback');
      return;
    case 'defaultPlaybackSpeed':
      if (typeof value !== 'number' || !(PLAYBACK_SPEEDS as readonly number[]).includes(value)) {
        throw new ValidationError('defaultPlaybackSpeed must be a supported speed');
      }
      return;
    case 'autoBackup':
    case 'rescanOnStartup':
    case 'examMistakesToFlashcards':
      if (typeof value !== 'boolean') throw new ValidationError(`${key} must be a boolean`);
      return;
    case 'backupKeep':
      requireIntIn(value, key, 1, 30, 'must be an integer between 1 and 30');
      return;
    case 'examPassPercent':
      requireIntIn(value, key, 50, 100, 'must be an integer between 50 and 100');
      return;
    case 'dailyGoalMinutes':
      if (typeof value !== 'number' || !(DAILY_GOAL_OPTIONS as readonly number[]).includes(value)) {
        throw new ValidationError(`dailyGoalMinutes must be one of ${DAILY_GOAL_OPTIONS.join(', ')}`);
      }
      return;
    case 'examSecondsPerQuestion':
      requireIntIn(value, key, 30, 600, 'must be 30–600 seconds');
      return;
    default: {
      // Adding a setting to AppSettings without a rule here is a compile error.
      const unhandled: never = key;
      throw new ValidationError(`Unknown setting: ${String(unhandled)}`);
    }
  }
}

export function isValidSetting(key: string, value: unknown): boolean {
  try {
    validateSetting(key, value);
    return true;
  } catch {
    return false;
  }
}
