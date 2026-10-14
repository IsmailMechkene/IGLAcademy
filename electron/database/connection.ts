import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { app } from 'electron';
import { MIGRATIONS, runMigrations } from './migrations';

let db: Database.Database | null = null;

export function databasePath(): string {
  return path.join(app.getPath('userData'), 'ismalearn.db');
}

/**
 * Opens (or creates) the application database inside Electron's userData
 * directory so it survives application updates. The database is a singleton
 * for the lifetime of the main process.
 */
export function getDb(): Database.Database {
  if (db) return db;
  const dir = app.getPath('userData');
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = databasePath();
  backupBeforeMigrating(dbPath, dir);
  db = createDatabase(dbPath);
  return db;
}

/**
 * Copies the database aside before a schema upgrade touches it. A failed
 * migration is the one failure mode a post-startup backup cannot rescue, so
 * the copy has to happen first. Entirely best-effort: never blocks startup.
 */
function backupBeforeMigrating(dbPath: string, userDataDir: string): void {
  try {
    if (!fs.existsSync(dbPath) || fs.statSync(dbPath).size === 0) return;
    const latest = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);
    const probe = new Database(dbPath, { readonly: true });
    let applied = 0;
    try {
      const row = probe
        .prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations')
        .get() as { v: number } | undefined;
      applied = row?.v ?? 0;
    } catch {
      applied = 0; // no ledger yet (fresh or pre-migrations file)
    } finally {
      probe.close();
    }
    if (applied >= latest) return;

    const dir = path.join(userDataDir, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    fs.copyFileSync(dbPath, path.join(dir, `ismalearn-pre-v${latest}-${stamp}.db`));
  } catch {
    // A missing backup must never stop the app from opening.
  }
}

/**
 * Quarantines an unopenable database (corrupt file, half-applied migration)
 * by renaming it — never deleting it — so the app can start on a fresh one
 * and the user's file is still there to recover from.
 * Returns the path the broken database was moved to, or null.
 */
export function quarantineDatabase(dbPath: string = databasePath()): string | null {
  if (!fs.existsSync(dbPath)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dest = `${dbPath.replace(/\.db$/, '')}-unreadable-${stamp}.db`;
  try {
    fs.renameSync(dbPath, dest);
    // WAL sidecars belong to the old file and would corrupt the new one.
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(dbPath + suffix)) {
        try {
          fs.renameSync(dbPath + suffix, dest + suffix);
        } catch {
          fs.rmSync(dbPath + suffix, { force: true });
        }
      }
    }
    return dest;
  } catch {
    return null;
  }
}

/**
 * Creates a new database at an arbitrary path and applies all migrations.
 * Used by tests with temporary directories.
 */
export function createDatabase(dbPath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const database = new Database(dbPath);
  try {
    database.pragma('journal_mode = WAL');
    // With WAL, NORMAL skips the fsync on every commit. It cannot corrupt the
    // file; a power cut can at most drop the last commits (a few seconds of
    // progress), which FULL would have kept.
    database.pragma('synchronous = NORMAL');
    database.pragma('temp_store = MEMORY');
    database.pragma('cache_size = -16000'); // ~16 MB page cache
    database.pragma('foreign_keys = ON');
    runMigrations(database);
  } catch (err) {
    // Release the file handle before rethrowing: Windows will not let the
    // caller move a locked database aside, which is exactly what the startup
    // recovery path needs to do after a failed migration.
    try {
      database.close();
    } catch {
      // already unusable
    }
    throw err;
  }
  return database;
}

/** Closes the singleton database (used by tests). */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
