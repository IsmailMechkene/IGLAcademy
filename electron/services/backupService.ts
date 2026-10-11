import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';

// Full export/import of user data (notes, progress, quizzes, attempts,
// settings, exam sources, resources, bookmarks, review queue, flashcards).
// Exported as versioned JSON; import replaces all data after an automatic
// safety backup. Table lists are explicit so new tables fail loudly.

export const BACKUP_FORMAT = 'ismalearn-backup/1';

/**
 * User-data tables, children first, so a wipe-and-restore respects foreign
 * keys (insertion walks the list in reverse).
 *
 * `exam_sessions` is not here either: an in-progress exam is transient and
 * tied to this machine's files and clock.
 *
 * `schema_migrations` is deliberately NOT here. It describes the shape of the
 * live database, not the user's data: restoring an older backup's ledger would
 * make the app re-run migrations that have already been applied, which fails
 * on the second launch and bricks startup. Backups from before this change may
 * still contain the table — it is ignored on import.
 */
const TABLES_IN_DELETE_ORDER = [
  'quiz_attempt_answers',
  'practice_attempts',
  'practice_exam_snapshots',
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
] as const;

/** Column names actually present in the live table, for whitelisting. */
function columnsOf(db: Database.Database, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

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

/**
 * Replaces ALL user data with the backup content (caller backs up first).
 *
 * Column names come from the live schema, never from the file: a backup is
 * untrusted input, and interpolating its keys into SQL would let a crafted
 * file break out of the statement. Unknown columns are dropped and missing
 * ones fall back to their schema default, so backups taken on an older or
 * newer schema still restore.
 */
export function importData(db: Database.Database, data: BackupData): void {
  validateBackup(data);
  const tx = db.transaction(() => {
    for (const table of TABLES_IN_DELETE_ORDER) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
    const insertOrder = [...TABLES_IN_DELETE_ORDER].reverse();
    for (const table of insertOrder) {
      const rows = data.tables[table];
      if (!Array.isArray(rows) || rows.length === 0) continue;
      const allowed = columnsOf(db, table);
      // One prepared statement per distinct column set (usually exactly one).
      const statements = new Map<string, Database.Statement>();
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const columns = Object.keys(row).filter((c) => allowed.has(c));
        if (columns.length === 0) continue;
        const signature = columns.join(',');
        let stmt = statements.get(signature);
        if (!stmt) {
          const placeholders = columns.map(() => '?').join(', ');
          stmt = db.prepare(
            `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders})`,
          );
          statements.set(signature, stmt);
        }
        const values = columns.map((c) => {
          const v = (row as Record<string, unknown>)[c];
          if (v === undefined) return null;
          // SQLite only binds primitives; a nested object/array in a hand-
          // edited backup would otherwise throw mid-restore.
          if (v !== null && typeof v === 'object') return JSON.stringify(v);
          if (typeof v === 'boolean') return v ? 1 : 0;
          return v;
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
