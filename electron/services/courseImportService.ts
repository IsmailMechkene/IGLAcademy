import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { CourseHealth, ImportResult, RelocateResult, RescanResult } from '../../src/types';
import { scanCourseDirectory, scanCourseDirectoryAsync, type ScannedCourse } from './courseScanner';
import {
  insertCourse, getCourseBySourcePath, getCourse, insertSection, insertLesson,
  deleteLesson, deleteSection, updateLessonFilePath, getLesson,
  markLessonMissing, clearLessonMissing,
  getCourseDetail, updateCourse, renameSection,
  getSectionRelPaths, setSectionRelPath, moveLessonToSection,
} from '../database/repositories/courses';
import {
  insertResource, deleteResource,
} from '../database/repositories/resources';
import { titleFromFileName, resourceKindFor, generatedSectionTitles } from './courseScanner';
import { pathKey, relKey, relDirOf } from './pathIdentity';

/**
 * Imports a scanned course into the database. Original files are never moved,
 * renamed or deleted — only references (absolute paths) are stored.
 */
export function importCourse(db: Database.Database, rootPath: string): ImportResult {
  return importScannedCourse(db, scanCourseDirectory(rootPath));
}

/** `importCourse` with the folder scan off the main thread (used by IPC). */
export async function importCourseAsync(db: Database.Database, rootPath: string): Promise<ImportResult> {
  return importScannedCourse(db, await scanCourseDirectoryAsync(rootPath));
}

function importScannedCourse(db: Database.Database, scanned: ScannedCourse): ImportResult {
  if (scanned.lessonCount === 0) {
    return {
      status: 'error',
      error: 'No videos or practice tests were found in the selected folder. IGLAcademy imports courses that contain MP4, WebM, MKV or HTML practice-test files.',
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
      const sectionId = insertSection(db, course.id, section.title, section.position, section.relPath);
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
  if (!course) return rescanFailed('Course not found');
  let scanned: ScannedCourse;
  try {
    scanned = scanCourseDirectory(course.sourcePath);
  } catch (err) {
    return rescanFailed(err instanceof Error ? err.message : 'Rescan failed');
  }
  return applyRescan(db, courseId, course.sourcePath, scanned);
}

/** `rescanCourse` with the folder scan off the main thread (used by IPC). */
export async function rescanCourseAsync(db: Database.Database, courseId: number): Promise<RescanResult> {
  const course = getCourse(db, courseId);
  if (!course) return rescanFailed('Course not found');
  let scanned: ScannedCourse;
  try {
    scanned = await scanCourseDirectoryAsync(course.sourcePath);
  } catch (err) {
    return rescanFailed(err instanceof Error ? err.message : 'Rescan failed');
  }
  return applyRescan(db, courseId, course.sourcePath, scanned);
}

function rescanFailed(error: string): RescanResult {
  return { status: 'error', addedLessons: 0, addedSections: 0, missingLessons: 0, restoredLessons: 0, error };
}

/** Merges a scan of `scannedFrom` into the course (see `rescanCourse`). */
function applyRescan(db: Database.Database, courseId: number, scannedFrom: string, scanned: ScannedCourse): RescanResult {
  // An async scan leaves a window for the course to be removed or relocated;
  // merging a scan of the old folder would flag every lesson missing.
  const course = getCourse(db, courseId);
  if (!course) return rescanFailed('Course not found');
  if (course.sourcePath !== scannedFrom) return rescanFailed('The course folder changed during the rescan. Try again.');

  let addedLessons = 0;
  let addedSections = 0;
  let missingLessons = 0;
  let restoredLessons = 0;

  const tx = db.transaction(() => {
    const root = scanned.rootPath;
    const detail = getCourseDetail(db, courseId);
    if (!detail) throw new Error('Course not found');

    // Section identity is the folder path relative to the course root. Legacy
    // sections (imported before rel_path existed) get it backfilled from the
    // folder their lessons live in.
    const relPaths = getSectionRelPaths(db, courseId);
    const sectionByRel = new Map<string, number>();
    for (const section of detail.sections) {
      let rel = relPaths.get(section.id) ?? null;
      if (rel === null && section.lessons.length > 0) {
        rel = relDirOf(root, section.lessons[0].filePath);
        if (rel !== null) {
          setSectionRelPath(db, section.id, rel);
          relPaths.set(section.id, rel);
        }
      }
      if (rel !== null && !sectionByRel.has(relKey(rel))) sectionByRel.set(relKey(rel), section.id);
    }
    const scannedRels = new Set(
      scanned.sections.flatMap((s) => (s.relPath === null ? [] : [relKey(s.relPath)])),
    );

    // Lessons already flagged missing before this rescan, so "restored" counts
    // only genuine comebacks.
    const missingBefore = new Set<number>(
      detail.sections.flatMap((s) => s.lessons.filter((l) => l.missingSince !== null).map((l) => l.id)),
    );
    const existingLessons = detail.sections.flatMap((s) =>
      s.lessons.map((l) => ({
        id: l.id,
        sectionId: s.id,
        title: l.title,
        key: pathKey(l.filePath),
        relDir: relDirOf(root, l.filePath),
        nameKey: relKey(path.basename(l.filePath)),
      })),
    );
    const existingByPath = new Map(existingLessons.map((l) => [l.key, l]));
    const scannedLessonKeys = new Set(
      scanned.sections.flatMap((s) => s.lessons.map((l) => pathKey(l.filePath))),
    );
    // Lessons whose recorded file this scan did not find: the only rows a
    // moved/renamed file may be re-linked to. Each can be claimed once.
    const gone = existingLessons.filter((l) => !scannedLessonKeys.has(l.key));
    const relinked = new Set<number>();

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
      if (row.course_id !== courseId) claimedByOther.add(pathKey(row.file_path));
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
        existingResourcesByPath.set(pathKey(row.file_path), { id: row.id, title: row.title });
      }
    }

    /**
     * Finds the lesson a new-looking file used to be. In order:
     *  1. same folder, same title (the file was renamed in place);
     *  2. same file name, when exactly one vanished lesson has it (the file —
     *     or its whole folder — moved).
     * Titles are never matched across folders: that is what used to merge
     * "Part 1/Videos/Intro" into "Part 2/Videos/Intro".
     */
    const findMoved = (filePath: string, title: string, rel: string | null) => {
      const open = gone.filter((l) => !relinked.has(l.id));
      if (rel !== null) {
        const inPlace = open.find(
          (l) => l.relDir !== null && relKey(l.relDir) === relKey(rel) && l.title === title,
        );
        if (inPlace) return inPlace;
      }
      const nameKey = relKey(path.basename(filePath));
      const sameName = open.filter((l) => l.nameKey === nameKey);
      return sameName.length === 1 ? sameName[0] : undefined;
    };

    for (const scannedSection of scanned.sections) {
      const rel = scannedSection.relPath;
      // Existing sections that the recognised lessons of this folder belong to.
      const homes = new Map<number, number>();
      const newLessons: typeof scannedSection.lessons = [];
      const movedLessons: Array<{ id: number; sectionId: number }> = [];
      for (const scannedLesson of scannedSection.lessons) {
        const key = pathKey(scannedLesson.filePath);
        const unchanged = existingByPath.get(key);
        if (unchanged) {
          // Unchanged — keep as is (progress preserved). If it had been
          // flagged missing, the file is back.
          if (clearLessonMissing(db, unchanged.id)) restoredLessons++;
          homes.set(unchanged.sectionId, (homes.get(unchanged.sectionId) ?? 0) + 1);
          continue;
        }
        if (claimedByOther.has(key)) continue;
        const moved = findMoved(scannedLesson.filePath, scannedLesson.title, rel);
        if (moved) {
          // File moved/renamed — re-link, keep progress (and clear any flag)
          relinked.add(moved.id);
          updateLessonFilePath(db, moved.id, scannedLesson.filePath);
          if (missingBefore.has(moved.id)) restoredLessons++;
          homes.set(moved.sectionId, (homes.get(moved.sectionId) ?? 0) + 1);
          movedLessons.push({ id: moved.id, sectionId: moved.sectionId });
          continue;
        }
        newLessons.push(scannedLesson);
      }
      const newResources = scannedSection.resources.filter(
        (r) => !existingResourcesByPath.has(pathKey(r.filePath)),
      );

      let sectionId = rel !== null ? sectionByRel.get(relKey(rel)) : undefined;
      if (sectionId === undefined && rel === null) {
        // The synthetic "Resources" section has no folder; match it by title.
        sectionId = detail.sections.find(
          (s) =>
            (relPaths.get(s.id) ?? null) === null &&
            s.title.toLowerCase() === scannedSection.title.toLowerCase(),
        )?.id;
      }
      if (sectionId === undefined && rel !== null && homes.size === 1) {
        // Every lesson we recognised lives in one existing section whose own
        // folder is gone: the folder was renamed. Adopt that section (and its
        // new name, unless the user renamed it) instead of creating a
        // duplicate next to a section full of "missing" lessons.
        const [homeId] = homes.keys();
        const oldRel = relPaths.get(homeId) ?? null;
        if (oldRel === null || !scannedRels.has(relKey(oldRel))) {
          sectionId = homeId;
          setSectionRelPath(db, homeId, rel);
          relPaths.set(homeId, rel);
          sectionByRel.set(relKey(rel), homeId);
          const home = detail.sections.find((s) => s.id === homeId);
          if (home && oldRel !== null && generatedSectionTitles(oldRel).includes(home.title)) {
            renameSection(db, homeId, scannedSection.title);
          }
        }
      }

      const strays = movedLessons.filter((m) => m.sectionId !== sectionId);
      if (newLessons.length === 0 && newResources.length === 0 && strays.length === 0) continue;

      if (sectionId === undefined) {
        sectionId = insertSection(db, courseId, scannedSection.title, scannedSection.position, rel);
        if (rel !== null) sectionByRel.set(relKey(rel), sectionId);
        addedSections++;
      }
      const targetId = sectionId;
      // A file that moved to a different, still-existing folder follows it.
      for (const stray of strays) moveLessonToSection(db, stray.id, targetId);

      for (const scannedLesson of newLessons) {
        // Brand new lesson
        insertLesson(db, targetId, {
          title: scannedLesson.title,
          filePath: scannedLesson.filePath,
          fileType: scannedLesson.kind,
          position: scannedLesson.position,
        });
        addedLessons++;
      }
      newResources.forEach((resource, i) => {
        const id = insertResource(db, targetId, {
          title: titleFromFileName(resource.fileName),
          filePath: resource.filePath,
          kind: resourceKindFor(resource.fileName),
          position: i + 1,
        });
        existingResourcesByPath.set(pathKey(resource.filePath), { id, title: resource.fileName });
      });
    }

    // Flag lessons whose files no longer exist on disk. They keep their row —
    // and therefore their progress, notes and bookmarks — so an unplugged
    // drive or a renamed folder is recoverable (see `forgetLesson` for the
    // explicit, confirmed removal path).
    const nowIso = new Date().toISOString();
    for (const lesson of gone) {
      if (relinked.has(lesson.id)) continue;
      if (markLessonMissing(db, lesson.id, nowIso)) missingLessons++;
    }

    // Remove resources whose files no longer exist on disk (no progress at stake)
    const scannedResourcePaths = new Set(
      scanned.sections.flatMap((s) => s.resources.map((r) => pathKey(r.filePath))),
    );
    for (const [key, entry] of existingResourcesByPath) {
      if (!scannedResourcePaths.has(key)) deleteResource(db, entry.id);
    }

    // Remove sections that existed before this rescan and are now empty
    const finalDetail = getCourseDetail(db, courseId);
    if (finalDetail) {
      for (const section of finalDetail.sections) {
        const resourceCount = (
          db.prepare('SELECT COUNT(*) AS n FROM resources WHERE section_id = ?').get(section.id) as { n: number }
        ).n;
        if (section.lessons.length === 0 && resourceCount === 0 && relPaths.has(section.id)) {
          deleteSection(db, section.id);
        }
      }
    }

    // Pick up a cover added to the folder since import (or drop a removed one)
    if (scanned.thumbnailPath !== course.thumbnailPath) {
      updateCourse(db, courseId, { thumbnailPath: scanned.thumbnailPath });
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
