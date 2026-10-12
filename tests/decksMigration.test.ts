import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import SqliteDatabase from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../electron/database/connection';
import { MIGRATIONS } from '../electron/database/migrations';

const tmpRoots: string[] = [];
afterEach(() => {
  for (const dir of tmpRoots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const count = (db: SqliteDatabase.Database, table: string) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe('migration 12 (decks without a course)', () => {
  it('rebuilds flashcard_decks without losing cards, schedules or cascades', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ismalearn-m12-'));
    tmpRoots.push(dir);
    const file = path.join(dir, 'legacy.db');

    // A database exactly as v11 left it, with real study data in it.
    const legacy = new SqliteDatabase(file);
    legacy.pragma('foreign_keys = ON');
    legacy.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')));`);
    for (const m of MIGRATIONS.filter((x) => x.version < 12)) {
      legacy.exec(m.sql);
      legacy.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(m.version, m.name);
    }
    legacy.exec(`
      INSERT INTO courses (id, title, source_path) VALUES (1, 'C1', '/c1'), (2, 'C2', '/c2');
      INSERT INTO flashcard_decks (id, course_id, title, source) VALUES (10, 1, 'Deck A', 'manual'), (11, 2, 'Deck B', 'quiz:3');
      INSERT INTO flashcards (id, deck_id, front, back, position) VALUES
        (100, 10, 'Q1', 'A1', 1), (101, 10, 'Q2', 'A2', 2), (102, 11, 'Q3', 'A3', 1);
      INSERT INTO flashcard_state (card_id, ease, interval_days, reps, due_at) VALUES
        (100, 2.6, 6, 2, '2030-01-01T00:00:00.000Z'), (101, 2.5, 0, 0, '2026-01-01T00:00:00.000Z'),
        (102, 2.5, 1, 1, '2026-02-01T00:00:00.000Z');
    `);
    legacy.close();

    const db = createDatabase(file);
    try {
      // everything survived, ids and scheduling included
      expect(count(db, 'flashcard_decks')).toBe(2);
      expect(count(db, 'flashcards')).toBe(3);
      expect(db.prepare('SELECT ease, interval_days, reps FROM flashcard_state WHERE card_id = 100').get())
        .toEqual({ ease: 2.6, interval_days: 6, reps: 2 });
      expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(db.pragma('foreign_key_check')).toEqual([]);

      // a deck no longer needs a course
      db.prepare("INSERT INTO flashcard_decks (course_id, title, source) VALUES (NULL, 'Mistakes', 'mistakes:x')").run();

      // cascades still work: course -> deck -> cards -> state
      db.prepare('DELETE FROM courses WHERE id = 1').run();
      expect(count(db, 'flashcard_decks')).toBe(2); // Deck B + Mistakes
      expect(count(db, 'flashcards')).toBe(1);
      expect(count(db, 'flashcard_state')).toBe(1);
      db.prepare('DELETE FROM flashcard_decks WHERE id = 11').run();
      expect(count(db, 'flashcards')).toBe(0);
    } finally {
      db.close();
    }
  });
});
