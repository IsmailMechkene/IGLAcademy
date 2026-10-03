import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { getCourse, getLesson } from '../database/repositories/courses';

/**
 * Media access control: the renderer never receives raw filesystem paths.
 * It requests opaque `media://` URLs for a lesson/thumbnail id; the main
 * process resolves the id to a file, verifies the file lives inside the
 * course's registered directory, and streams it through a custom protocol.
 * This works both in dev (renderer served over http) and in production,
 * where plain file:// subresources would be blocked.
 */

export function resolveLessonFile(db: Database.Database, lessonId: number): string {
  const lesson = getLesson(db, lessonId);
  if (!lesson) throw new Error('Lesson not found');

  const row = db
    .prepare('SELECT s.course_id FROM lessons l JOIN sections s ON s.id = l.section_id WHERE l.id = ?')
    .get(lessonId) as { course_id: number } | undefined;
  if (!row) throw new Error('Lesson not found');

  const course = getCourse(db, row.course_id);
  if (!course) throw new Error('Course not found');

  const resolved = path.resolve(lesson.filePath);
  const courseRoot = path.resolve(course.sourcePath);
  // The file must live inside the course's registered directory
  if (resolved !== courseRoot && !resolved.startsWith(courseRoot + path.sep)) {
    throw new Error('Access denied: file is outside the course directory');
  }
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${path.basename(resolved)}`);
  }
  return resolved;
}

export function resolveThumbnailFile(db: Database.Database, courseId: number): string {
  const course = getCourse(db, courseId);
  if (!course?.thumbnailPath) throw new Error('No thumbnail for this course');
  if (!fs.existsSync(course.thumbnailPath)) throw new Error('Thumbnail file not found');
  return path.resolve(course.thumbnailPath);
}

/** Validates availability and returns an opaque protocol URL for the lesson. */
export function getMediaUrl(db: Database.Database, lessonId: number): string {
  resolveLessonFile(db, lessonId); // throws when unavailable
  return `media://lesson/${lessonId}`;
}

export function getCourseThumbnailUrl(db: Database.Database, courseId: number): string | null {
  const course = getCourse(db, courseId);
  if (!course?.thumbnailPath) return null;
  if (!fs.existsSync(course.thumbnailPath)) return null;
  return `media://thumb/${courseId}`;
}

export function checkFileExists(db: Database.Database, lessonId: number): boolean {
  try {
    resolveLessonFile(db, lessonId);
    return true;
  } catch {
    return false;
  }
}
