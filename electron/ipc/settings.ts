import { ipcMain } from 'electron';
import { getDb } from '../database/connection';
import { setSetting, getAllSettings } from '../database/repositories/settings';
import { requireString, ValidationError } from '../services/validate';
import { isSettingKey, validateSetting } from '../services/settingsSchema';
import { DEFAULT_SETTINGS } from '../../src/types';

export function registerSettingsIpc(): void {
  const db = getDb();

  ipcMain.handle('settings:getAll', () => getAllSettings(db));

  ipcMain.handle('settings:get', (_e, key: unknown) => {
    const k = requireString(key, 'key', 100);
    if (!isSettingKey(k)) throw new ValidationError(`Unknown setting: ${k}`);
    return getAllSettings(db)[k];
  });

  ipcMain.handle('settings:set', (_e, key: unknown, value: unknown) => {
    const k = requireString(key, 'key', 100);
    validateSetting(k, value);
    setSetting(db, k, value);
  });

  ipcMain.handle('settings:reset', () => {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      // Not a preference: resetting it would show "What's new" again.
      if (key === 'lastSeenVersion') continue;
      setSetting(db, key, value);
    }
    return getAllSettings(db);
  });
}
