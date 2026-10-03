import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { app } from 'electron';
import { runMigrations } from './migrations';

let db: Database.Database | null = null;

/**
 * Opens (or creates) the application database inside Electron's userData
 * directory so it survives application updates. The database is a singleton
 * for the lifetime of the main process.
 */
export function getDb(): Database.Database {
  if (db) return db;
  const dir = app.getPath('userData');
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, 'ismalearn.db');
  db = createDatabase(dbPath);
  return db;
}

/**
 * Creates a new database at an arbitrary path and applies all migrations.
 * Used by tests with temporary directories.
 */
export function createDatabase(dbPath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const database = new Database(dbPath);
  database.pragma('journal_mode = WAL');
  database.pragma('foreign_keys = ON');
  runMigrations(database);
  return database;
}

/** Closes the singleton database (used by tests). */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
