import type Database from 'better-sqlite3';
import type { Bookmark, ReviewItem, FlashcardDeck, Flashcard } from '../../../src/types';

// ---------- bookmarks ----------

interface BookmarkRow {
  id: number;
  course_id: number;
  lesson_id: number | null;
  position_seconds: number;
  title: string;
  note: string;
  created_at: string;
  course_title: string;
  lesson_title: string | null;
}

function toBookmark(row: BookmarkRow): Bookmark {
  return {
    id: row.id,
    courseId: row.course_id,
    courseTitle: row.course_title,
    lessonId: row.lesson_id,
    lessonTitle: row.lesson_title,
    positionSeconds: row.position_seconds,
    title: row.title,
    note: row.note,
    createdAt: row.created_at,
  };
}

const BOOKMARK_SELECT = `
  SELECT b.*, c.title AS course_title, l.title AS lesson_title
  FROM bookmarks b
  JOIN courses c ON c.id = b.course_id
  LEFT JOIN lessons l ON l.id = b.lesson_id`;

export function listBookmarks(db: Database.Database, courseId?: number): Bookmark[] {
  if (courseId !== undefined) {
    return (
      db.prepare(`${BOOKMARK_SELECT} WHERE b.course_id = ? ORDER BY b.created_at DESC`).all(courseId) as BookmarkRow[]
    ).map(toBookmark);
  }
  return (db.prepare(`${BOOKMARK_SELECT} ORDER BY b.created_at DESC`).all() as BookmarkRow[]).map(toBookmark);
}

export function insertBookmark(
  db: Database.Database,
  data: { courseId: number; lessonId: number | null; positionSeconds: number; title: string; note?: string },
): Bookmark {
  const info = db
    .prepare('INSERT INTO bookmarks (course_id, lesson_id, position_seconds, title, note) VALUES (?, ?, ?, ?, ?)')
    .run(data.courseId, data.lessonId, data.positionSeconds, data.title, data.note ?? '');
  const row = db.prepare(`${BOOKMARK_SELECT} WHERE b.id = ?`).get(Number(info.lastInsertRowid)) as BookmarkRow;
  return toBookmark(row);
}

export function deleteBookmark(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM bookmarks WHERE id = ?').run(id);
}

// ---------- review-later queue ----------

interface ReviewItemRow {
  id: number;
  course_id: number | null;
  kind: string;
  ref_id: string;
  title: string;
  due_at: string;
  done: number;
  created_at: string;
  course_title: string | null;
}

function toReviewItem(row: ReviewItemRow): ReviewItem {
  return {
    id: row.id,
    courseId: row.course_id,
    courseTitle: row.course_title ?? '',
    kind: row.kind as ReviewItem['kind'],
    refId: row.ref_id,
    title: row.title,
    dueAt: row.due_at,
    done: row.done === 1,
    createdAt: row.created_at,
  };
}

const REVIEW_SELECT = `
  SELECT r.*, c.title AS course_title
  FROM review_items r
  LEFT JOIN courses c ON c.id = r.course_id`;

export function listReviewItems(db: Database.Database, includeDone = true): ReviewItem[] {
  const sql = includeDone
    ? `${REVIEW_SELECT} ORDER BY r.done, r.due_at`
    : `${REVIEW_SELECT} WHERE r.done = 0 ORDER BY r.due_at`;
  return (db.prepare(sql).all() as ReviewItemRow[]).map(toReviewItem);
}

export function countDueReviews(db: Database.Database, nowIso: string): { itemsDue: number; cardsDue: number } {
  const items = db
    .prepare("SELECT COUNT(*) AS n FROM review_items WHERE done = 0 AND due_at <= ?")
    .get(nowIso) as { n: number };
  const cards = db
    .prepare('SELECT COUNT(*) AS n FROM flashcard_state WHERE due_at <= ?')
    .get(nowIso) as { n: number };
  return { itemsDue: items.n, cardsDue: cards.n };
}

export function insertReviewItem(
  db: Database.Database,
  data: { courseId: number | null; kind: ReviewItem['kind']; refId: string; title: string; dueAt?: string },
): ReviewItem {
  const dueAt = data.dueAt ?? new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const info = db
    .prepare('INSERT INTO review_items (course_id, kind, ref_id, title, due_at) VALUES (?, ?, ?, ?, ?)')
    .run(data.courseId, data.kind, data.refId, data.title, dueAt);
  const row = db.prepare(`${REVIEW_SELECT} WHERE r.id = ?`).get(Number(info.lastInsertRowid)) as ReviewItemRow;
  return toReviewItem(row);
}

export function setReviewItemDone(db: Database.Database, id: number, done: boolean): void {
  db.prepare('UPDATE review_items SET done = ? WHERE id = ?').run(done ? 1 : 0, id);
}

export function deleteReviewItem(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM review_items WHERE id = ?').run(id);
}

// ---------- flashcards ----------

interface DeckRow {
  id: number;
  course_id: number;
  title: string;
  source: string;
  created_at: string;
  course_title: string;
  card_count: number;
  due_count: number;
}

export function listDecks(db: Database.Database, courseId?: number): FlashcardDeck[] {
  const nowIso = new Date().toISOString();
  const where = courseId !== undefined ? 'WHERE d.course_id = ?' : '';
  // Parameter order must match placeholder order in the SQL below
  // (the due_at subquery comes before the course filter).
  const args = courseId !== undefined ? [nowIso, courseId] : [nowIso];
  return (
    db
      .prepare(
        `SELECT d.*, c.title AS course_title,
          (SELECT COUNT(*) FROM flashcards f WHERE f.deck_id = d.id) AS card_count,
          (SELECT COUNT(*) FROM flashcards f JOIN flashcard_state s ON s.card_id = f.id
           WHERE f.deck_id = d.id AND s.due_at <= ?) AS due_count
         FROM flashcard_decks d
         JOIN courses c ON c.id = d.course_id
         ${where}
         ORDER BY d.created_at DESC`,
      )
      .all(...args) as DeckRow[]
  ).map((row) => ({
    id: row.id,
    courseId: row.course_id,
    courseTitle: row.course_title,
    title: row.title,
    source: row.source,
    cardCount: row.card_count,
    dueCount: row.due_count,
    createdAt: row.created_at,
  }));
}

export function insertDeck(
  db: Database.Database,
  data: { courseId: number; title: string; source?: string },
): number {
  const info = db
    .prepare('INSERT INTO flashcard_decks (course_id, title, source) VALUES (?, ?, ?)')
    .run(data.courseId, data.title, data.source ?? 'manual');
  return Number(info.lastInsertRowid);
}

export function deleteDeck(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM flashcard_decks WHERE id = ?').run(id);
}

export function insertFlashcard(
  db: Database.Database,
  deckId: number,
  data: { front: string; back: string; position: number },
): number {
  const tx = db.transaction(() => {
    const info = db
      .prepare('INSERT INTO flashcards (deck_id, front, back, position) VALUES (?, ?, ?, ?)')
      .run(deckId, data.front, data.back, data.position);
    const cardId = Number(info.lastInsertRowid);
    db.prepare("INSERT INTO flashcard_state (card_id, due_at) VALUES (?, datetime('now'))").run(cardId);
    return cardId;
  });
  return tx();
}

export function deleteFlashcard(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM flashcards WHERE id = ?').run(id);
}

export function listDueFlashcards(db: Database.Database, deckId: number, nowIso: string, limit = 100): Flashcard[] {
  return (
    db
      .prepare(
        `SELECT f.*, s.ease, s.interval_days, s.reps, s.due_at
         FROM flashcards f
         JOIN flashcard_state s ON s.card_id = f.id
         WHERE f.deck_id = ? AND s.due_at <= ?
         ORDER BY s.due_at, f.position
         LIMIT ?`,
      )
      .all(deckId, nowIso, limit) as Array<{
      id: number; deck_id: number; front: string; back: string; position: number;
      ease: number; interval_days: number; reps: number; due_at: string;
    }>
  ).map((row) => ({
    id: row.id,
    deckId: row.deck_id,
    front: row.front,
    back: row.back,
    position: row.position,
    ease: row.ease,
    intervalDays: row.interval_days,
    reps: row.reps,
    dueAt: row.due_at,
  }));
}

export function listFlashcards(db: Database.Database, deckId: number): Flashcard[] {
  return (
    db
      .prepare(
        `SELECT f.*, s.ease, s.interval_days, s.reps, s.due_at
         FROM flashcards f
         JOIN flashcard_state s ON s.card_id = f.id
         WHERE f.deck_id = ?
         ORDER BY f.position`,
      )
      .all(deckId) as Array<{
      id: number; deck_id: number; front: string; back: string; position: number;
      ease: number; interval_days: number; reps: number; due_at: string;
    }>
  ).map((row) => ({
    id: row.id,
    deckId: row.deck_id,
    front: row.front,
    back: row.back,
    position: row.position,
    ease: row.ease,
    intervalDays: row.interval_days,
    reps: row.reps,
    dueAt: row.due_at,
  }));
}

export function updateFlashcardState(
  db: Database.Database,
  cardId: number,
  data: { ease: number; intervalDays: number; reps: number; dueAt: string },
): void {
  db.prepare(
    `UPDATE flashcard_state SET ease = ?, interval_days = ?, reps = ?,
       due_at = ?, updated_at = datetime('now') WHERE card_id = ?`,
  ).run(data.ease, data.intervalDays, data.reps, data.dueAt, cardId);
}
