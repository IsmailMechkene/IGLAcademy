import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { getCourse, getCourseDetail } from '../database/repositories/courses';

/**
 * Real course thumbnails for courses that ship no cover image: a frame from
 * the course's first playable video, produced by the operating system's own
 * thumbnailer (the one File Explorer uses) and cached as a PNG in the app's
 * data folder. Course folders are never written to.
 */

/** Renders a thumbnail for a media file; null when the OS cannot. */
export type ThumbnailGenerator = (filePath: string) => Promise<Buffer | null>;

let cacheDir: string | null = null;
const inFlight = new Map<number, Promise<boolean>>();
/** Courses the OS could not thumbnail this session — don't retry every render. */
const failed = new Set<number>();

export function initThumbnailCache(userDataDir: string): void {
  cacheDir = path.join(userDataDir, 'thumbnails');
  fs.mkdirSync(cacheDir, { recursive: true });
  inFlight.clear();
  failed.clear();
}

/** Where a course's generated thumbnail lives (path built from an id only). */
export function generatedThumbnailPath(courseId: number): string | null {
  if (!cacheDir || !Number.isInteger(courseId) || courseId <= 0) return null;
  return path.join(cacheDir, `course-${courseId}.png`);
}

export function hasGeneratedThumbnail(courseId: number): boolean {
  const file = generatedThumbnailPath(courseId);
  return file !== null && fs.existsSync(file);
}

export function clearGeneratedThumbnail(courseId: number): void {
  const file = generatedThumbnailPath(courseId);
  failed.delete(courseId);
  if (file) fs.rmSync(file, { force: true });
}

/** How many videos to try before giving up (a broken first file is common). */
const MAX_CANDIDATES = 3;

/**
 * Makes sure the course has a generated thumbnail, creating it on first use.
 * Resolves true when one is available. Concurrent calls share one attempt.
 */
export function ensureGeneratedThumbnail(
  db: Database.Database,
  courseId: number,
  generate: ThumbnailGenerator,
): Promise<boolean> {
  const file = generatedThumbnailPath(courseId);
  if (!file) return Promise.resolve(false);
  if (fs.existsSync(file)) return Promise.resolve(true);
  if (failed.has(courseId)) return Promise.resolve(false);
  const pending = inFlight.get(courseId);
  if (pending) return pending;

  const attempt = (async () => {
    const detail = getCourseDetail(db, courseId);
    const candidates = (detail?.sections ?? [])
      .flatMap((s) => s.lessons)
      .filter((l) => l.fileType === 'video' && l.missingSince === null && fs.existsSync(l.filePath))
      .slice(0, MAX_CANDIDATES);
    for (const lesson of candidates) {
      try {
        const png = await generate(lesson.filePath);
        if (png && png.length > 0) {
          fs.writeFileSync(file, png);
          return true;
        }
      } catch {
        // try the next video
      }
    }
    failed.add(courseId);
    return false;
  })().finally(() => inFlight.delete(courseId));
  inFlight.set(courseId, attempt);
  return attempt;
}

/** The cover image the course folder provides itself, if it is usable. */
export function folderCoverExists(db: Database.Database, courseId: number): boolean {
  const course = getCourse(db, courseId);
  return Boolean(course?.thumbnailPath && fs.existsSync(course.thumbnailPath));
}
