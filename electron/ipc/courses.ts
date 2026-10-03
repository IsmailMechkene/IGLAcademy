import { ipcMain, dialog } from 'electron';
import { getDb } from '../database/connection';
import {
  listCourses, getCourseDetail, updateCourse, markCourseOpened, deleteCourse,
  renameSection, renameLesson,
} from '../database/repositories/courses';
import { importCourse, rescanCourse } from '../services/courseImportService';
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
}

export { ValidationError };
