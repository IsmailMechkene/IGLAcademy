import { ipcMain, dialog } from 'electron';
import { getDb } from '../database/connection';
import {
  listCourses, getCourseDetail, updateCourse, markCourseOpened, deleteCourse,
  renameSection, renameLesson,
} from '../database/repositories/courses';
import { importCourse, rescanCourse, getCourseHealth, relocateCourseRoot, forgetLesson } from '../services/courseImportService';
import { getCourseThumbnailUrl } from '../services/fileService';
import { requireId, requireString, optionalString, ValidationError } from '../services/validate';

export function registerCourseIpc(): void {
  const db = getDb();

  ipcMain.handle('courses:list', () => {
    return listCourses(db);
  });

  ipcMain.handle('courses:get', (_e, courseId: unknown) => {
    return getCourseDetail(db, requireId(courseId, 'courseId'));
  });

  ipcMain.handle('courses:import', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select a course folder',
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { status: 'cancelled' as const };
    }
    return importCourse(db, result.filePaths[0]);
  });

  ipcMain.handle('courses:importPath', (_e, dirPath: unknown) => {
    return importCourse(db, requireString(dirPath, 'dirPath', 4096));
  });

  ipcMain.handle('courses:rename', (_e, courseId: unknown, title: unknown) => {
    updateCourse(db, requireId(courseId, 'courseId'), { title: requireString(title, 'title', 200) });
  });

  ipcMain.handle('courses:updateDescription', (_e, courseId: unknown, description: unknown) => {
    updateCourse(db, requireId(courseId, 'courseId'), { description: optionalString(description, 'description', 5000) });
  });

  ipcMain.handle('courses:rescan', (_e, courseId: unknown) => {
    return rescanCourse(db, requireId(courseId, 'courseId'));
  });

  ipcMain.handle('courses:remove', (_e, courseId: unknown) => {
    deleteCourse(db, requireId(courseId, 'courseId'));
  });

  ipcMain.handle('courses:markOpened', (_e, courseId: unknown) => {
    markCourseOpened(db, requireId(courseId, 'courseId'));
  });

  ipcMain.handle('courses:renameSection', (_e, sectionId: unknown, title: unknown) => {
    renameSection(db, requireId(sectionId, 'sectionId'), requireString(title, 'title', 200));
  });

  ipcMain.handle('courses:renameLesson', (_e, lessonId: unknown, title: unknown) => {
    renameLesson(db, requireId(lessonId, 'lessonId'), requireString(title, 'title', 200));
  });

  ipcMain.handle('courses:thumbnailUrl', (_e, courseId: unknown) => {
    return getCourseThumbnailUrl(db, requireId(courseId, 'courseId'));
  });

  ipcMain.handle('courses:health', (_e, courseId: unknown) => {
    return getCourseHealth(db, requireId(courseId, 'courseId'));
  });

  // Bulk relink: pick the course's new folder, re-point every matching file.
  ipcMain.handle('courses:relocate', async (_e, courseId: unknown) => {
    const id = requireId(courseId, 'courseId');
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select the new location of this course folder',
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { status: 'cancelled' as const, relocated: 0, stillMissing: 0 };
    }
    return relocateCourseRoot(db, id, result.filePaths[0]);
  });

  // Rescans every course (used by the library button and startup setting).
  ipcMain.handle('courses:rescanAll', () => {
    const summary = { courses: 0, addedLessons: 0, addedSections: 0, missingLessons: 0, restoredLessons: 0, errors: 0 };
    const ids = (db.prepare('SELECT id FROM courses').all() as Array<{ id: number }>).map((r) => r.id);
    for (const courseId of ids) {
      try {
        const r = rescanCourse(db, courseId);
        summary.courses += 1;
        if (r.status === 'ok') {
          summary.addedLessons += r.addedLessons;
          summary.addedSections += r.addedSections;
          summary.missingLessons += r.missingLessons;
          summary.restoredLessons += r.restoredLessons;
        } else {
          summary.errors += 1;
        }
      } catch {
        summary.errors += 1;
      }
    }
    return summary;
  });

  // Permanently drops a lesson whose file is gone, together with its progress,
  // notes and bookmarks. Only ever reached from a confirmed UI action — a
  // rescan flags missing lessons instead (see rescanCourse).
  ipcMain.handle('courses:forgetLesson', (_e, lessonId: unknown) => {
    return forgetLesson(db, requireId(lessonId, 'lessonId'));
  });
}

export { ValidationError };
