import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { CourseHealth, ImportResult, RelocateResult, RescanResult } from '../../src/types';
import { scanCourseDirectory } from './courseScanner';
import {
  insertCourse, getCourseBySourcePath, getCourse, insertSection, insertLesson,
  findLessonByPath, deleteLesson, deleteSection, updateLessonFilePath,
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
 * - lessons whose files disappeared are removed
 * existing progress is preserved whenever a lesson can be matched
 */
export function rescanCourse(db: Database.Database, courseId: number): RescanResult {
  const course = getCourse(db, courseId);
  if (!course) return { status: 'error', addedLessons: 0, addedSections: 0, removedLessons: 0, error: 'Course not found' };

  let addedLessons = 0;
  let addedSections = 0;
  let removedLessons = 0;

  const tx = db.transaction(() => {
    const scanned = scanCourseDirectory(course.sourcePath);
    const detail = getCourseDetail(db, courseId);
    if (!detail) throw new Error('Course not found');

    // Index existing lessons by file path and by (sectionTitle, lessonTitle)
    const existingByPath = new Map<string, { id: number; sectionId: number; title: string }>();
    const existingByTitle = new Map<string, { id: number; sectionId: number; title: string }>();
    const existingSectionIds = new Set<number>();
    for (const section of detail.sections) {
      existingSectionIds.add(section.id);
      for (const lesson of section.lessons) {
        existingByPath.set(path.resolve(lesson.filePath), { id: lesson.id, sectionId: section.id, title: lesson.title });
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
        if (existingByPath.get(resolved)) {
          // Unchanged — keep as is (progress preserved)
          continue;
        }
        const byTitle = existingByTitle.get(`${scannedSection.title}::${scannedLesson.title}`);
        if (byTitle) {
          // File moved/renamed — re-link, keep progress
          updateLessonFilePath(db, byTitle.id, scannedLesson.filePath);
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

    // Remove lessons whose files no longer exist on disk
    const scannedPaths = new Set(
      scanned.sections.flatMap((s) => s.lessons.map((l) => path.resolve(l.filePath))),
    );
    for (const section of detail.sections) {
      for (const lesson of section.lessons) {
        if (!scannedPaths.has(path.resolve(lesson.filePath))) {
          // Only remove if it wasn't re-linked above (re-linked lessons keep their id)
          const stillThere = findLessonByPath(db, lesson.filePath);
          if (stillThere && stillThere.id === lesson.id) {
            deleteLesson(db, lesson.id);
            removedLessons++;
          }
        }
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
      removedLessons,
      error: err instanceof Error ? err.message : 'Rescan failed',
    };
  }

  return { status: 'ok', addedLessons, addedSections, removedLessons };
}

/**
 * Checks every lesson file of a course without touching anything.
 */
export function getCourseHealth(db: Database.Database, courseId: number): CourseHealth {
  const detail = getCourseDetail(db, courseId);
  if (!detail) throw new Error('Course not found');
  const missingLessons = detail.sections
    .flatMap((s) => s.lessons)
    .filter((l) => {
      try {
        return !fs.existsSync(l.filePath);
      } catch {
        return true;
      }
    })
    .map((l) => ({ lessonId: l.id, title: l.title, filePath: l.filePath }));
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
