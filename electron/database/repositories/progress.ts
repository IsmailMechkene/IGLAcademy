import type Database from 'better-sqlite3';
import type { LearningStats, LessonActivity } from '../../../src/types';

/**
 * Saves the playback position.
 *
 * NOTE on `watched_seconds`: it is the FURTHEST point reached in the lesson
 * (hence MAX), not time actually spent watching — skipping ahead counts. The
 * UI labels it accordingly ("Content covered"). Real watch time would need a
 * playback ticker; there is deliberately no half-built accumulator here any
 * more, because the unused one made the column look like something it is not.
 */
export function savePosition(db: Database.Database, lessonId: number, seconds: number): void {
  db.prepare(
    `INSERT INTO lesson_progress (lesson_id, position_seconds, watched_seconds, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(lesson_id) DO UPDATE SET
       position_seconds = excluded.position_seconds,
       watched_seconds = MAX(lesson_progress.watched_seconds, excluded.watched_seconds),
       updated_at = datetime('now')`,
  ).run(lessonId, seconds, seconds);
}

export function setCompleted(db: Database.Database, lessonId: number, completed: boolean): void {
  db.prepare(
    `INSERT INTO lesson_progress (lesson_id, completed, completed_at, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(lesson_id) DO UPDATE SET
       completed = excluded.completed,
       completed_at = excluded.completed_at,
       updated_at = datetime('now')`,
  ).run(lessonId, completed ? 1 : 0, completed ? new Date().toISOString() : null);
}

export function getStats(db: Database.Database): LearningStats {
  const row = db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM courses) AS course_count,
        (SELECT COALESCE(SUM(watched_seconds), 0) FROM lesson_progress) AS total_watched,
        (SELECT COUNT(*) FROM lesson_progress WHERE completed = 1) AS completed,
        (SELECT COUNT(*) FROM lessons WHERE file_type IN ('video', 'practice')) AS total_lessons`,
    )
    .get() as { course_count: number; total_watched: number; completed: number; total_lessons: number };

  return {
    courseCount: row.course_count,
    totalWatchedSeconds: row.total_watched,
    lessonsCompleted: row.completed,
    totalLessons: row.total_lessons,
    overallProgressPercent:
      row.total_lessons > 0 ? Math.round((row.completed / row.total_lessons) * 100) : 0,
  };
}

/** Returns the most recently studied course id (by latest progress update), or null. */
export function getMostRecentCourseId(db: Database.Database): number | null {
  const row = db
    .prepare(
      `SELECT l.id AS lesson_id, lp.updated_at
       FROM lesson_progress lp
       JOIN lessons l ON l.id = lp.lesson_id
       JOIN sections s ON s.id = l.section_id
       WHERE lp.updated_at IS NOT NULL
       ORDER BY lp.updated_at DESC
       LIMIT 1`,
    )
    .get() as { lesson_id: number } | undefined;
  if (!row) return null;
  const lesson = db
    .prepare('SELECT s.course_id FROM lessons l JOIN sections s ON s.id = l.section_id WHERE l.id = ?')
    .get(row.lesson_id) as { course_id: number } | undefined;
  return lesson ? lesson.course_id : null;
}

/** Returns ids of recently opened courses, most recent first. */
export function getRecentlyOpenedCourseIds(db: Database.Database, limit = 5): number[] {
  const rows = db
    .prepare('SELECT id FROM courses WHERE last_opened_at IS NOT NULL ORDER BY last_opened_at DESC LIMIT ?')
    .all(limit) as Array<{ id: number }>;
  return rows.map((r) => r.id);
}

/** Returns the most recently touched lesson of a course (by progress update). */
export function getLastActivity(db: Database.Database, courseId: number): LessonActivity | null {
  const row = db
    .prepare(
      `SELECT l.id AS lesson_id, l.title AS lesson_title, s.title AS section_title, lp.updated_at
       FROM lesson_progress lp
       JOIN lessons l ON l.id = lp.lesson_id
       JOIN sections s ON s.id = l.section_id
       WHERE s.course_id = ?
       ORDER BY lp.updated_at DESC
       LIMIT 1`,
    )
    .get(courseId) as
    | { lesson_id: number; lesson_title: string; section_title: string; updated_at: string }
    | undefined;
  if (!row) return null;
  return {
    lessonId: row.lesson_id,
    lessonTitle: row.lesson_title,
    sectionTitle: row.section_title,
    updatedAt: row.updated_at,
  };
}
