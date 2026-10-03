import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
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

const MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.vtt': 'text/vtt',
};

/**
 * Serves a local file as an HTTP-style response with explicit Range support.
 * Video seeking depends on correct 206 Partial Content responses — a plain
 * passthrough does not reliably forward ranges for file URLs, which leaves
 * the player able to load metadata but unable to seek or resume.
 */
export function serveMediaFile(filePath: string, rangeHeader: string | null): Response {
  const size = fs.statSync(filePath).size;
  const contentType =
    MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';

  if (rangeHeader) {
    const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
    if (match) {
      let start = match[1] === '' ? Number.NaN : parseInt(match[1], 10);
      let end = match[2] === '' ? Number.NaN : parseInt(match[2], 10);
      if (Number.isNaN(start) && !Number.isNaN(end)) {
        // Suffix range: last N bytes
        start = Math.max(0, size - end);
        end = size - 1;
      }
      if (Number.isNaN(end) || end >= size) end = size - 1;
      if (!Number.isNaN(start) && start < size && start <= end) {
        const stream = Readable.toWeb(fs.createReadStream(filePath, { start, end }));
        return new Response(stream as ReadableStream, {
          status: 206,
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(end - start + 1),
            'Content-Range': `bytes ${start}-${end}/${size}`,
            'Accept-Ranges': 'bytes',
          },
        });
      }
      return new Response('Range not satisfiable', {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}` },
      });
    }
  }

  const stream = Readable.toWeb(fs.createReadStream(filePath));
  return new Response(stream as ReadableStream, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(size),
      'Accept-Ranges': 'bytes',
    },
  });
}
