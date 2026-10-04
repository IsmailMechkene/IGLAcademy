import { ipcMain } from 'electron';
import { getDb } from '../database/connection';
import { getSetting, setSetting, getAllSettings } from '../database/repositories/settings';
import { requireString, requireEnum, ValidationError } from '../services/validate';
import { DEFAULT_SETTINGS } from '../../src/types';

const VALID_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export function registerSettingsIpc(): void {
  const db = getDb();

  ipcMain.handle('settings:getAll', () => getAllSettings(db));

  ipcMain.handle('settings:get', (_e, key: unknown) => {
    return getSetting(db, requireString(key, 'key', 100));
  });

  ipcMain.handle('settings:set', (_e, key: unknown, value: unknown) => {
    const k = requireString(key, 'key', 100);
    // Validate known setting values
    if (k === 'theme') requireEnum(value, ['dark', 'light', 'system'] as const, 'theme');
    if (k === 'resumePlayback') requireEnum(value, ['ask', 'always', 'never'] as const, 'resumePlayback');
    if (k === 'duplicateImportBehavior') requireEnum(value, ['ask', 'skip', 'rescan'] as const, 'duplicateImportBehavior');
    if (k === 'defaultPlaybackSpeed') {
      if (typeof value !== 'number' || !VALID_SPEEDS.includes(value)) {
        throw new ValidationError('defaultPlaybackSpeed must be a supported speed');
      }
    }
    if (k === 'autoBackup' || k === 'rescanOnStartup' || k === 'checkForUpdates') {
      if (typeof value !== 'boolean') throw new ValidationError(`${k} must be a boolean`);
    }
    if (k === 'backupKeep') {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 30) {
        throw new ValidationError('backupKeep must be an integer between 1 and 30');
      }
    }
    if (k === 'examPassPercent') {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 50 || value > 100) {
        throw new ValidationError('examPassPercent must be an integer between 50 and 100');
      }
    }
    if (k === 'examSecondsPerQuestion') {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 30 || value > 600) {
        throw new ValidationError('examSecondsPerQuestion must be 30–600 seconds');
      }
    }
    setSetting(db, k, value);
  });

  ipcMain.handle('settings:reset', () => {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      setSetting(db, key, value);
    }
    return getAllSettings(db);
  });
}

export { ValidationError };
