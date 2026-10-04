import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';

// Full export/import of user data (notes, progress, quizzes, attempts,
// settings, exam sources, resources, bookmarks, review queue, flashcards).
// Exported as versioned JSON; import replaces all data after an automatic
// safety backup. Table lists are explicit so new tables fail loudly.

export const BACKUP_FORMAT = 'ismalearn-backup/1';

const TABLES_IN_DELETE_ORDER = [
  'quiz_attempt_answers',
  'practice_attempts',
  'flashcard_state',
  'quiz_attempts',
  'quiz_questions',
  'lesson_progress',
  'notes',
  'bookmarks',
  'review_items',
  'flashcards',
  'resources',
  'lessons',
  'quizzes',
  'flashcard_decks',
  'sections',
  'courses',
  'exam_sources',
  'app_settings',
  'schema_migrations',
] as const;

export interface BackupData {
  format: string;
  appVersion: string;
  exportedAt: string;
  tables: Record<string, Array<Record<string, unknown>>>;
}

export function exportData(db: Database.Database, appVersion: string): BackupData {
  const tables: Record<string, Array<Record<string, unknown>>> = {};
  for (const table of TABLES_IN_DELETE_ORDER) {
    try {
      tables[table] = db.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>;
    } catch {
      tables[table] = [];
    }
  }
  return {
    format: BACKUP_FORMAT,
    appVersion,
    exportedAt: new Date().toISOString(),
    tables,
  };
}

export function validateBackup(data: unknown): asserts data is BackupData {
  if (!data || typeof data !== 'object') throw new Error('Not an IsmaLearn backup file.');
  const backup = data as Partial<BackupData>;
  if (backup.format !== BACKUP_FORMAT) {
    throw new Error('Unsupported backup format. Expected IsmaLearn backup v1.');
  }
  if (!backup.tables || typeof backup.tables !== 'object') {
    throw new Error('Backup file is missing data tables.');
  }
  for (const table of TABLES_IN_DELETE_ORDER) {
    if (!Array.isArray((backup.tables as Record<string, unknown>)[table])) {
      throw new Error(`Backup file is missing table "${table}".`);
    }
  }
}

/** Replaces ALL user data with the backup content (caller backs up first). */
export function importData(db: Database.Database, data: BackupData): void {
  validateBackup(data);
  const tx = db.transaction(() => {
    for (const table of TABLES_IN_DELETE_ORDER) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
    const insertOrder = [...TABLES_IN_DELETE_ORDER].reverse();
    for (const table of insertOrder) {
      const rows = data.tables[table];
      if (rows.length === 0) continue;
      const columns = Object.keys(rows[0]);
      const placeholders = columns.map(() => '?').join(', ');
      const stmt = db.prepare(
        `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`,
      );
      for (const row of rows) {
        const values = columns.map((c) => {
          const v = (row as Record<string, unknown>)[c];
          return v === undefined ? null : v;
        });
        stmt.run(...values);
      }
    }
  });
  tx();
}

function backupDir(userDataDir: string): string {
  const dir = path.join(userDataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function listBackups(userDataDir: string): Array<{ fileName: string; sizeBytes: number; createdAt: string }> {
  const dir = backupDir(userDataDir);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.db'))
    .map((fileName) => {
      const full = path.join(dir, fileName);
      const stat = fs.statSync(full);
      return { fileName, sizeBytes: stat.size, createdAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/**
 * Copies the live database to the backups folder (after a WAL checkpoint so
 * the copy is complete) and prunes older backups beyond keepCount.
 */
export function createAutoBackup(db: Database.Database, userDataDir: string, keepCount: number): string | null {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    // checkpoint failure must not block the backup; fall through
  }
  const live = path.join(userDataDir, 'ismalearn.db');
  if (!fs.existsSync(live)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dest = path.join(backupDir(userDataDir), `ismalearn-${stamp}.db`);
  fs.copyFileSync(live, dest);

  const keep = Math.max(1, Math.min(30, Math.floor(keepCount) || 7));
  const existing = listBackups(userDataDir);
  for (const old of existing.slice(keep)) {
    try {
      fs.unlinkSync(path.join(backupDir(userDataDir), old.fileName));
    } catch {
      // best effort
    }
  }
  return dest;
}
