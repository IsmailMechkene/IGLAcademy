import type Database from 'better-sqlite3';
import type { Course, CourseDetail, CourseWithProgress, SectionWithLessons, LessonWithProgress } from '../../../src/types';
import { canonicalDir, pathKey } from '../../services/pathIdentity';

interface CourseRow {
  id: number;
  title: string;
  description: string;
  source_path: string;
  thumbnail_path: string | null;
  created_at: string;
  updated_at: string;
  last_opened_at: string | null;
}

function toCourse(row: CourseRow): Course {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    sourcePath: row.source_path,
    thumbnailPath: row.thumbnail_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastOpenedAt: row.last_opened_at,
  };
}

export function listCourses(db: Database.Database): CourseWithProgress[] {
  const rows = db
    .prepare(
      `SELECT c.*,
        (SELECT COUNT(*) FROM sections s WHERE s.course_id = c.id) AS section_count,
        (SELECT COUNT(*) FROM lessons l JOIN sections s ON l.section_id = s.id WHERE s.course_id = c.id AND l.file_type IN ('video', 'practice')) AS lesson_count,
        (SELECT COUNT(*) FROM lesson_progress lp JOIN lessons l ON lp.lesson_id = l.id JOIN sections s ON l.section_id = s.id WHERE s.course_id = c.id AND lp.completed = 1) AS completed_count,
        (SELECT COALESCE(SUM(lp.watched_seconds), 0) FROM lesson_progress lp JOIN lessons l ON lp.lesson_id = l.id JOIN sections s ON l.section_id = s.id WHERE s.course_id = c.id) AS watched_seconds
      FROM courses c
      ORDER BY c.last_opened_at IS NULL, c.last_opened_at DESC, c.created_at DESC`,
    )
    .all() as Array<CourseRow & { section_count: number; lesson_count: number; completed_count: number; watched_seconds: number }>;

  return rows.map((row) => ({
    ...toCourse(row),
    sectionCount: row.section_count,
    lessonCount: row.lesson_count,
    completedCount: row.completed_count,
    progressPercent: row.lesson_count > 0 ? Math.round((row.completed_count / row.lesson_count) * 100) : 0,
    watchedSeconds: row.watched_seconds,
  }));
}

export function getCourse(db: Database.Database, id: number): Course | null {
  const row = db.prepare('SELECT * FROM courses WHERE id = ?').get(id) as CourseRow | undefined;
  return row ? toCourse(row) : null;
}

export function getCourseBySourcePath(db: Database.Database, sourcePath: string): Course | null {
  // Compared in JS rather than SQL: on Windows "C:\AWS" and "c:\aws" are the
  // same folder, and SQLite's NOCASE only folds ASCII. Both sides are also
  // resolved to their on-disk spelling, so an 8.3 short name (as Windows CI
  // machines report their temp folder) or a junction matches its folder.
  const key = pathKey(canonicalDir(sourcePath));
  const row = (db.prepare('SELECT * FROM courses').all() as CourseRow[]).find(
    (r) => pathKey(r.source_path) === key || pathKey(canonicalDir(r.source_path)) === key,
  );
  return row ? toCourse(row) : null;
}

export function insertCourse(
  db: Database.Database,
  data: { title: string; description?: string; sourcePath: string; thumbnailPath?: string | null },
): Course {
  const info = db
    .prepare('INSERT INTO courses (title, description, source_path, thumbnail_path) VALUES (?, ?, ?, ?)')
    .run(data.title, data.description ?? '', data.sourcePath, data.thumbnailPath ?? null);
  return getCourse(db, Number(info.lastInsertRowid))!;
}

export function updateCourse(
  db: Database.Database,
  id: number,
  data: { title?: string; description?: string; thumbnailPath?: string | null; sourcePath?: string },
): Course {
  const sets: string[] = [];
  const args: unknown[] = [];
  if (data.title !== undefined) {
    sets.push('title = ?');
    args.push(data.title);
  }
  if (data.description !== undefined) {
    sets.push('description = ?');
    args.push(data.description);
  }
  if (data.thumbnailPath !== undefined) {
    sets.push('thumbnail_path = ?');
    args.push(data.thumbnailPath);
  }
  if (data.sourcePath !== undefined) {
    sets.push('source_path = ?');
    args.push(data.sourcePath);
  }
  if (sets.length > 0) {
    sets.push("updated_at = datetime('now')");
    db.prepare(`UPDATE courses SET ${sets.join(', ')} WHERE id = ?`).run(...args, id);
  }
  return getCourse(db, id)!;
}

export function markCourseOpened(db: Database.Database, id: number): void {
  db.prepare("UPDATE courses SET last_opened_at = datetime('now') WHERE id = ?").run(id);
}

export function deleteCourse(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM courses WHERE id = ?').run(id);
}

export function getCourseDetail(db: Database.Database, id: number): CourseDetail | null {
  const course = getCourse(db, id);
  if (!course) return null;

  const sectionRows = db
    .prepare('SELECT * FROM sections WHERE course_id = ? ORDER BY position')
    .all(id) as Array<{ id: number; course_id: number; title: string; position: number }>;

  const lessonStmt = db.prepare(
    `SELECT l.*, lp.completed, lp.completed_at, lp.position_seconds, lp.watched_seconds
     FROM lessons l
     LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id
     WHERE l.section_id = ? AND l.file_type IN ('video', 'practice')
     ORDER BY l.position`,
  );

  const sections: SectionWithLessons[] = sectionRows.map((s) => {
    const lessons = (lessonStmt.all(s.id) as Array<{
      id: number; section_id: number; title: string; file_path: string;
      file_type: string; duration: number | null; position: number;
      missing_since: string | null;
      completed: number | null; completed_at: string | null;
      position_seconds: number | null; watched_seconds: number | null;
    }>).map((l) => ({
      id: l.id,
      sectionId: l.section_id,
      title: l.title,
      filePath: l.file_path,
      fileType: l.file_type as 'video' | 'practice',
      duration: l.duration,
      position: l.position,
      missingSince: l.missing_since,
      completed: l.completed === 1,
      completedAt: l.completed_at,
      positionSeconds: l.position_seconds ?? 0,
      watchedSeconds: l.watched_seconds ?? 0,
    }));
    return {
      id: s.id,
      courseId: s.course_id,
      title: s.title,
      position: s.position,
      lessons,
    };
  });

  const lessonCount = sections.reduce((n, s) => n + s.lessons.length, 0);
  const completedCount = sections.reduce((n, s) => n + s.lessons.filter((l) => l.completed).length, 0);
  const watchedSeconds = sections.reduce(
    (n, s) => n + s.lessons.reduce((m, l) => m + l.watchedSeconds, 0),
    0,
  );

  return {
    ...course,
    sections,
    lessonCount,
    completedCount,
    progressPercent: lessonCount > 0 ? Math.round((completedCount / lessonCount) * 100) : 0,
    watchedSeconds,
  };
}

export function getLesson(db: Database.Database, lessonId: number): LessonWithProgress | null {
  const row = db
    .prepare(
      `SELECT l.*, lp.completed, lp.completed_at, lp.position_seconds, lp.watched_seconds
       FROM lessons l LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id
       WHERE l.id = ?`,
    )
    .get(lessonId) as
    | {
        id: number; section_id: number; title: string; file_path: string;
        file_type: string; duration: number | null; position: number;
        missing_since: string | null;
        completed: number | null; completed_at: string | null;
        position_seconds: number | null; watched_seconds: number | null;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    sectionId: row.section_id,
    title: row.title,
    filePath: row.file_path,
    fileType: row.file_type as 'video' | 'practice' | 'resource',
    duration: row.duration,
    position: row.position,
    missingSince: row.missing_since,
    completed: row.completed === 1,
    completedAt: row.completed_at,
    positionSeconds: row.position_seconds ?? 0,
    watchedSeconds: row.watched_seconds ?? 0,
  };
}

export function getSection(db: Database.Database, sectionId: number) {
  return db.prepare('SELECT * FROM sections WHERE id = ?').get(sectionId) as
    | { id: number; course_id: number; title: string; position: number }
    | undefined;
}

export function insertSection(
  db: Database.Database,
  courseId: number,
  title: string,
  position: number,
  relPath: string | null = null,
): number {
  const info = db
    .prepare('INSERT INTO sections (course_id, title, position, rel_path) VALUES (?, ?, ?, ?)')
    .run(courseId, title, position, relPath);
  return Number(info.lastInsertRowid);
}

/** Folder identity (course-relative path) of each section in a course. */
export function getSectionRelPaths(db: Database.Database, courseId: number): Map<number, string | null> {
  const rows = db
    .prepare('SELECT id, rel_path FROM sections WHERE course_id = ?')
    .all(courseId) as Array<{ id: number; rel_path: string | null }>;
  return new Map(rows.map((r) => [r.id, r.rel_path]));
}

export function setSectionRelPath(db: Database.Database, sectionId: number, relPath: string | null): void {
  db.prepare('UPDATE sections SET rel_path = ? WHERE id = ?').run(relPath, sectionId);
}

export function moveLessonToSection(db: Database.Database, lessonId: number, sectionId: number): void {
  db.prepare('UPDATE lessons SET section_id = ? WHERE id = ?').run(sectionId, lessonId);
}

export function renameSection(db: Database.Database, sectionId: number, title: string): void {
  db.prepare("UPDATE sections SET title = ? WHERE id = ?").run(title, sectionId);
}

export function insertLesson(
  db: Database.Database,
  sectionId: number,
  data: { title: string; filePath: string; fileType: 'video' | 'practice' | 'resource'; position: number },
): number {
  const info = db
    .prepare('INSERT INTO lessons (section_id, title, file_path, file_type, position) VALUES (?, ?, ?, ?, ?)')
    .run(sectionId, data.title, data.filePath, data.fileType, data.position);
  return Number(info.lastInsertRowid);
}

export function renameLesson(db: Database.Database, lessonId: number, title: string): void {
  db.prepare('UPDATE lessons SET title = ? WHERE id = ?').run(title, lessonId);
}

/**
 * Stores the real media duration, learned from the player the first time a
 * lesson is opened (the scanner cannot know it without decoding). Writes only
 * when the value is new or has drifted by more than a second, so playing a
 * lesson does not keep touching the row.
 */
export function updateLessonDuration(db: Database.Database, lessonId: number, duration: number): boolean {
  const row = db.prepare('SELECT duration FROM lessons WHERE id = ?').get(lessonId) as
    | { duration: number | null }
    | undefined;
  if (!row) return false;
  if (row.duration !== null && Math.abs(row.duration - duration) < 1) return false;
  db.prepare('UPDATE lessons SET duration = ? WHERE id = ?').run(duration, lessonId);
  return true;
}

/** Re-points a lesson at a new file. A relinked lesson is no longer missing. */
export function updateLessonFilePath(db: Database.Database, lessonId: number, filePath: string): void {
  db.prepare('UPDATE lessons SET file_path = ?, missing_since = NULL WHERE id = ?').run(filePath, lessonId);
}

/**
 * Flags a lesson whose file is gone. Idempotent: the first-seen timestamp is
 * kept so the UI can say how long it has been missing. Returns true when this
 * call is what flagged it (for rescan counters).
 */
export function markLessonMissing(db: Database.Database, lessonId: number, atIso: string): boolean {
  const info = db
    .prepare('UPDATE lessons SET missing_since = ? WHERE id = ? AND missing_since IS NULL')
    .run(atIso, lessonId);
  return info.changes > 0;
}

/** Clears the missing flag after a file reappears. Returns true when it was set. */
export function clearLessonMissing(db: Database.Database, lessonId: number): boolean {
  const info = db
    .prepare('UPDATE lessons SET missing_since = NULL WHERE id = ? AND missing_since IS NOT NULL')
    .run(lessonId);
  return info.changes > 0;
}

export function listMissingLessonIds(db: Database.Database, courseId: number): number[] {
  return (
    db
      .prepare(
        `SELECT l.id FROM lessons l JOIN sections s ON s.id = l.section_id
         WHERE s.course_id = ? AND l.missing_since IS NOT NULL`,
      )
      .all(courseId) as Array<{ id: number }>
  ).map((r) => r.id);
}

export function deleteLesson(db: Database.Database, lessonId: number): void {
  db.prepare('DELETE FROM lessons WHERE id = ?').run(lessonId);
}

export function deleteSection(db: Database.Database, sectionId: number): void {
  db.prepare('DELETE FROM sections WHERE id = ?').run(sectionId);
}

export function countCourses(db: Database.Database): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM courses').get() as { n: number }).n;
}
