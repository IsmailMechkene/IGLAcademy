import type Database from 'better-sqlite3';
import type { Note } from '../../../src/types';

interface NoteRow {
  id: number;
  course_id: number;
  lesson_id: number | null;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
  course_title: string;
  lesson_title: string | null;
}

function toNote(row: NoteRow): Note {
  return {
    id: row.id,
    courseId: row.course_id,
    lessonId: row.lesson_id,
    title: row.title,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    courseTitle: row.course_title,
    lessonTitle: row.lesson_title,
  };
}

const SELECT_SQL = `
  SELECT n.*, c.title AS course_title, l.title AS lesson_title
  FROM notes n
  JOIN courses c ON c.id = n.course_id
  LEFT JOIN lessons l ON l.id = n.lesson_id`;

export function listNotes(db: Database.Database, courseId?: number): Note[] {
  if (courseId !== undefined) {
    return (db.prepare(`${SELECT_SQL} WHERE n.course_id = ? ORDER BY n.updated_at DESC`).all(courseId) as NoteRow[]).map(toNote);
  }
  return (db.prepare(`${SELECT_SQL} ORDER BY n.updated_at DESC`).all() as NoteRow[]).map(toNote);
}

export function searchNotes(db: Database.Database, query: string): Note[] {
  const like = `%${query.replace(/[%_]/g, (m) => '\\' + m)}%`;
  return (db
    .prepare(`${SELECT_SQL} WHERE n.content LIKE ? ESCAPE '\\' OR n.title LIKE ? ESCAPE '\\' OR c.title LIKE ? ESCAPE '\\' ORDER BY n.updated_at DESC`)
    .all(like, like, like) as NoteRow[]).map(toNote);
}

export function getNote(db: Database.Database, id: number): Note | null {
  const row = db.prepare(`${SELECT_SQL} WHERE n.id = ?`).get(id) as NoteRow | undefined;
  return row ? toNote(row) : null;
}

export function insertNote(
  db: Database.Database,
  data: { courseId: number; lessonId: number | null; title: string; content: string },
): Note {
  const info = db
    .prepare('INSERT INTO notes (course_id, lesson_id, title, content) VALUES (?, ?, ?, ?)')
    .run(data.courseId, data.lessonId, data.title, data.content);
  return getNote(db, Number(info.lastInsertRowid))!;
}

export function updateNote(
  db: Database.Database,
  id: number,
  data: { title: string; content: string },
): Note {
  db.prepare("UPDATE notes SET title = ?, content = ?, updated_at = datetime('now') WHERE id = ?").run(
    data.title,
    data.content,
    id,
  );
  return getNote(db, id)!;
}

export function deleteNote(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM notes WHERE id = ?').run(id);
}
