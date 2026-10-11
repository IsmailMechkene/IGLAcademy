import type Database from 'better-sqlite3';
import type { AppSettings } from '../../../src/types';
import { DEFAULT_SETTINGS } from '../../../src/types';
import { isValidSetting } from '../../services/settingsSchema';

export function getSetting<T>(db: Database.Database, key: string): T | undefined {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  if (!row) return undefined;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return undefined;
  }
}

export function setSetting(db: Database.Database, key: string, value: unknown): void {
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, JSON.stringify(value));
}

export function getAllSettings(db: Database.Database): AppSettings {
  const rows = db.prepare('SELECT key, value FROM app_settings').all() as Array<{ key: string; value: string }>;
  const settings: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      const value: unknown = JSON.parse(row.value);
      // Unknown keys and out-of-range values (old builds, hand-edited or
      // restored databases) fall back to the default instead of leaking out.
      if (isValidSetting(row.key, value)) settings[row.key] = value;
    } catch {
      // ignore malformed values
    }
  }
  return { ...DEFAULT_SETTINGS, ...(settings as Partial<AppSettings>) };
}
