import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { CourseHealth, ImportResult, RelocateResult, RescanResult } from '../../src/types';
import { scanCourseDirectory } from './courseScanner';
import {
  insertCourse, getCourseBySourcePath, getCourse, insertSection, insertLesson,
  deleteLesson, deleteSection, updateLessonFilePath, getLesson,
  markLessonMissing, clearLessonMissing,
  getCourseDetail, updateCourse,
} from '../database/repositories/courses';
import {
  insertResource, deleteResource,
} from '../database/repositories/resources';
import { titleFromFileName, resourceKindFor } from './courseScanner';

/**
 * Imports a scanned course into the database. Original files are never moved,
 * renamed or deleted — only references (absolute paths) are stored.
 */
export function importCourse(db: Database.Database, rootPath: string): ImportResult {
  const scanned = scanCourseDirectory(rootPath);

  if (scanned.lessonCount === 0) {
    return {
      status: 'error',
      error: 'No videos or practice tests were found in the selected folder. IsmaLearn imports courses that contain MP4, WebM, MKV or HTML practice-test files.',
    };
  }

  const existing = getCourseBySourcePath(db, scanned.rootPath);
  if (existing) {
    return { status: 'duplicate', courseId: existing.id, courseTitle: existing.title };
  }

  const tx = db.transaction(() => {
    const course = insertCourse(db, {
      title: scanned.title,
      sourcePath: scanned.rootPath,
      thumbnailPath: scanned.thumbnailPath,
    });

    for (const section of scanned.sections) {
      const sectionId = insertSection(db, course.id, section.title, section.position);
      for (const lesson of section.lessons) {
        insertLesson(db, sectionId, {
          title: lesson.title,
          filePath: lesson.filePath,
          fileType: lesson.kind,
          position: lesson.position,
        });
      }
      section.resources.forEach((resource, i) => {
        insertResource(db, sectionId, {
          title: titleFromFileName(resource.fileName),
          filePath: resource.filePath,
          kind: resourceKindFor(resource.fileName),
          position: i + 1,
        });
      });
    }
    return course;
  });

  const course = tx();
  return {
    status: 'imported',
    courseId: course.id,
    courseTitle: course.title,
    lessonCount: scanned.lessonCount,
    sectionCount: scanned.sections.length,
  };
}

/**
 * Rescans an existing course directory and merges new content:
 * - new sections and lessons are added
 * - lessons whose file moved are re-linked (matched by title within the section)
 * - lessons whose files disappeared are FLAGGED missing, never deleted
 * existing progress is preserved whenever a lesson can be matched
 *
 * Nothing the user created (progress, notes, bookmarks) is ever removed by a
 * rescan: a renamed folder or an unplugged drive must not cost data, and the
 * notes/bookmarks foreign keys cascade on lesson delete. Forgetting a missing
 * lesson for good is an explicit, confirmed user action (`forgetLesson`).
 */
export function rescanCourse(db: Database.Database, courseId: number): RescanResult {
  const course = getCourse(db, courseId);
  if (!course) {
    return {
      status: 'error',
      addedLessons: 0,
      addedSections: 0,
      missingLessons: 0,
      restoredLessons: 0,
      error: 'Course not found',
    };
  }

  let addedLessons = 0;
  let addedSections = 0;
  let missingLessons = 0;
  let restoredLessons = 0;

  const tx = db.transaction(() => {
    const scanned = scanCourseDirectory(course.sourcePath);
    const detail = getCourseDetail(db, courseId);
    if (!detail) throw new Error('Course not found');

    // Index existing lessons by file path and by (sectionTitle, lessonTitle)
    const existingByPath = new Map<string, { id: number; sectionId: number; title: string }>();
    const existingByTitle = new Map<string, { id: number; sectionId: number; title: string }>();
    const existingSectionIds = new Set<number>();
    // Lessons already flagged missing before this rescan, so "restored" counts
    // only genuine comebacks.
    const missingBefore = new Set<number>(
      detail.sections.flatMap((s) => s.lessons.filter((l) => l.missingSince !== null).map((l) => l.id)),
    );
    for (const section of detail.sections) {
      existingSectionIds.add(section.id);
      for (const lesson of section.lessons) {
        existingByPath.set(path.resolve(lesson.filePath), { id: lesson.id, sectionId: section.id, title: lesson.title });
        // A lesson already flagged missing must stay claimable by title so a
        // renamed/moved file re-links to it (keeping its progress and notes)
        // instead of being added again as a brand-new lesson.
        existingByTitle.set(`${section.title}::${lesson.title}`, { id: lesson.id, sectionId: section.id, title: lesson.title });
      }
    }

    // Paths already registered to a DIFFERENT course must not be poached
    // (e.g. a subfolder imported as its own course).
    const claimedByOther = new Set<string>();
    const allLessons = db
      .prepare(
        `SELECT l.file_path, s.course_id FROM lessons l
         JOIN sections s ON s.id = l.section_id`,
      )
      .all() as Array<{ file_path: string; course_id: number }>;
    for (const row of allLessons) {
      if (row.course_id !== courseId) claimedByOther.add(path.resolve(row.file_path));
    }

    // Index existing resources by file path for merging.
    const existingResourcesByPath = new Map<string, { id: number; title: string }>();
    {
      const rows = db
        .prepare(
          `SELECT r.id, r.title, r.file_path FROM resources r
           JOIN sections s ON s.id = r.section_id
           WHERE s.course_id = ?`,
        )
        .all(courseId) as Array<{ id: number; title: string; file_path: string }>;
      for (const row of rows) {
        existingResourcesByPath.set(path.resolve(row.file_path), { id: row.id, title: row.title });
      }
    }

    for (const scannedSection of scanned.sections) {
      // Partition first so sections are only created when something is new.
      const newLessons: typeof scannedSection.lessons = [];
      for (const scannedLesson of scannedSection.lessons) {
        const resolved = path.resolve(scannedLesson.filePath);
        const unchanged = existingByPath.get(resolved);
        if (unchanged) {
          // Unchanged — keep as is (progress preserved). If it had been
          // flagged missing, the file is back.
          if (clearLessonMissing(db, unchanged.id)) restoredLessons++;
          continue;
        }
        const byTitle = existingByTitle.get(`${scannedSection.title}::${scannedLesson.title}`);
        if (byTitle) {
          // File moved/renamed — re-link, keep progress (and clear any flag)
          updateLessonFilePath(db, byTitle.id, scannedLesson.filePath);
          if (missingBefore.has(byTitle.id)) restoredLessons++;
          continue;
        }
        if (claimedByOther.has(resolved)) continue;
        newLessons.push(scannedLesson);
      }
      const newResources = scannedSection.resources.filter(
        (r) => !existingResourcesByPath.has(path.resolve(r.filePath)),
      );
      if (newLessons.length === 0 && newResources.length === 0) continue;

      // Match an existing section by title (case-insensitive)
      const existingSection = detail.sections.find(
        (s) => s.title.toLowerCase() === scannedSection.title.toLowerCase(),
      );
      const sectionId = existingSection
        ? existingSection.id
        : insertSection(db, courseId, scannedSection.title, scannedSection.position);
      if (!existingSection) addedSections++;

      for (const scannedLesson of newLessons) {
        // Brand new lesson
        insertLesson(db, sectionId, {
          title: scannedLesson.title,
          filePath: scannedLesson.filePath,
          fileType: scannedLesson.kind,
          position: scannedLesson.position,
        });
        addedLessons++;
      }
      newResources.forEach((resource, i) => {
        const id = insertResource(db, sectionId, {
          title: titleFromFileName(resource.fileName),
          filePath: resource.filePath,
          kind: resourceKindFor(resource.fileName),
          position: i + 1,
        });
        existingResourcesByPath.set(path.resolve(resource.filePath), { id, title: resource.fileName });
      });
    }

    // Flag lessons whose files no longer exist on disk. They keep their row —
    // and therefore their progress, notes and bookmarks — so an unplugged
    // drive or a renamed folder is recoverable (see `forgetLesson` for the
    // explicit, confirmed removal path).
    const scannedPaths = new Set(
      scanned.sections.flatMap((s) => s.lessons.map((l) => path.resolve(l.filePath))),
    );
    const nowIso = new Date().toISOString();
    for (const section of detail.sections) {
      for (const lesson of section.lessons) {
        if (scannedPaths.has(path.resolve(lesson.filePath))) continue;
        // Skip lessons that were re-linked above: their row now points at a
        // path the scan did find, so the stale closure value is out of date.
        const current = db.prepare('SELECT file_path FROM lessons WHERE id = ?').get(lesson.id) as
          | { file_path: string }
          | undefined;
        if (!current || path.resolve(current.file_path) !== path.resolve(lesson.filePath)) continue;
        if (markLessonMissing(db, lesson.id, nowIso)) missingLessons++;
      }
    }

    // Remove resources whose files no longer exist on disk (no progress at stake)
    const scannedResourcePaths = new Set(
      scanned.sections.flatMap((s) => s.resources.map((r) => path.resolve(r.filePath))),
    );
    for (const [resolved, entry] of existingResourcesByPath) {
      if (scannedResourcePaths.has(resolved)) continue;
      const current = db.prepare('SELECT file_path FROM resources WHERE id = ?').get(entry.id) as
        | { file_path: string }
        | undefined;
      if (current && path.resolve(current.file_path) === resolved) {
        deleteResource(db, entry.id);
      }
    }

    // Remove empty sections (no lessons left)
    const finalDetail = getCourseDetail(db, courseId);
    if (finalDetail) {
      for (const section of finalDetail.sections) {
        const resourceCount = (
          db.prepare('SELECT COUNT(*) AS n FROM resources WHERE section_id = ?').get(section.id) as { n: number }
        ).n;
        if (section.lessons.length === 0 && resourceCount === 0 && existingSectionIds.has(section.id)) {
          deleteSection(db, section.id);
        }
      }
    }
  });

  try {
    tx();
  } catch (err) {
    return {
      status: 'error',
      addedLessons,
      addedSections,
      missingLessons,
      restoredLessons,
      error: err instanceof Error ? err.message : 'Rescan failed',
    };
  }

  return { status: 'ok', addedLessons, addedSections, missingLessons, restoredLessons };
}

/**
 * Permanently removes a single lesson the user has decided to give up on.
 * This DOES cascade its progress, notes and bookmarks, so it is only ever
 * called from an explicitly confirmed UI action — never from a rescan.
 */
export function forgetLesson(
  db: Database.Database,
  lessonId: number,
): { status: 'ok' | 'error'; title: string; error?: string } {
  const lesson = getLesson(db, lessonId);
  if (!lesson) return { status: 'error', title: '', error: 'Lesson not found' };
  if (fs.existsSync(lesson.filePath)) {
    return {
      status: 'error',
      title: lesson.title,
      error: 'This lesson’s file is on disk again — rescan the course instead of forgetting it.',
    };
  }
  deleteLesson(db, lessonId);
  return { status: 'ok', title: lesson.title };
}

/**
 * Checks every lesson file of a course. Never touches files or user data; it
 * does keep the `missing_since` flag in sync with what is actually on disk so
 * the lesson lists can badge missing lessons without a full rescan.
 */
export function getCourseHealth(db: Database.Database, courseId: number): CourseHealth {
  const detail = getCourseDetail(db, courseId);
  if (!detail) throw new Error('Course not found');
  const nowIso = new Date().toISOString();
  const missingLessons: CourseHealth['missingLessons'] = [];
  for (const lesson of detail.sections.flatMap((s) => s.lessons)) {
    let present: boolean;
    try {
      present = fs.existsSync(lesson.filePath);
    } catch {
      present = false;
    }
    if (present) {
      clearLessonMissing(db, lesson.id);
      continue;
    }
    markLessonMissing(db, lesson.id, nowIso);
    missingLessons.push({ lessonId: lesson.id, title: lesson.title, filePath: lesson.filePath });
  }
  return { courseId, totalLessons: detail.lessonCount, missingLessons };
}

/**
 * Re-points a whole course at a new folder: every lesson whose relative path
 * exists under the new root is re-linked (progress preserved); the course
 * root only moves when at least one file matched.
 */
export function relocateCourseRoot(
  db: Database.Database,
  courseId: number,
  newRootPath: string,
): RelocateResult {
  const course = getCourse(db, courseId);
  if (!course) return { status: 'error', relocated: 0, stillMissing: 0, error: 'Course not found' };
  const newRoot = path.resolve(newRootPath);
  try {
    if (!fs.statSync(newRoot).isDirectory()) throw new Error('not a directory');
  } catch {
    return { status: 'error', relocated: 0, stillMissing: 0, error: 'Selected folder is not accessible.' };
  }

  const oldRoot = path.resolve(course.sourcePath);
  const detail = getCourseDetail(db, courseId);
  if (!detail) return { status: 'error', relocated: 0, stillMissing: 0, error: 'Course not found' };

  let relocated = 0;
  const stillMissing: string[] = [];
  const tx = db.transaction(() => {
    for (const lesson of detail.sections.flatMap((s) => s.lessons)) {
      if (fs.existsSync(lesson.filePath)) continue;
      const rel = path.relative(oldRoot, path.resolve(lesson.filePath));
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        stillMissing.push(lesson.title);
        continue;
      }
      const candidate = path.join(newRoot, rel);
      if (fs.existsSync(candidate)) {
        updateLessonFilePath(db, lesson.id, candidate);
        relocated++;
      } else {
        stillMissing.push(lesson.title);
      }
    }
    if (relocated > 0) {
      updateCourse(db, courseId, { sourcePath: newRoot });
      if (course.thumbnailPath) {
        const thumbRel = path.relative(oldRoot, path.resolve(course.thumbnailPath));
        if (!thumbRel.startsWith('..') && !path.isAbsolute(thumbRel)) {
          const thumbCandidate = path.join(newRoot, thumbRel);
          if (fs.existsSync(thumbCandidate)) {
            updateCourse(db, courseId, { thumbnailPath: thumbCandidate });
          }
        }
      }
    }
  });

  try {
    tx();
  } catch (err) {
    return {
      status: 'error',
      relocated: 0,
      stillMissing: stillMissing.length,
      error: err instanceof Error ? err.message : 'Relocation failed',
    };
  }
  return { status: 'ok', relocated, stillMissing: stillMissing.length };
}
