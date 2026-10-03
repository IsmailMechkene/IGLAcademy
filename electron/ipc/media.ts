import { ipcMain, dialog } from 'electron';
import { getDb } from '../database/connection';
import { getMediaUrl, checkFileExists } from '../services/fileService';
import { updateLessonFilePath, getLesson } from '../database/repositories/courses';
import { requireId } from '../services/validate';

export function registerMediaIpc(): void {
  const db = getDb();

  ipcMain.handle('media:getUrl', (_e, lessonId: unknown) => {
    return getMediaUrl(db, requireId(lessonId, 'lessonId'));
  });

  ipcMain.handle('media:checkFile', (_e, lessonId: unknown) => {
    return checkFileExists(db, requireId(lessonId, 'lessonId'));
  });

  // Lets the user relocate a missing lesson file via a native file dialog.
  ipcMain.handle('media:locateFile', async (_e, lessonId: unknown) => {
    const id = requireId(lessonId, 'lessonId');
    const lesson = getLesson(db, id);
    if (!lesson) throw new Error('Lesson not found');

    const result = await dialog.showOpenDialog({
      title: `Locate "${lesson.title}"`,
      defaultPath: lesson.filePath,
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const newPath = result.filePaths[0];
    updateLessonFilePath(db, id, newPath);
    return getMediaUrl(db, id);
  });
}
