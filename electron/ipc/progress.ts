import { ipcMain } from 'electron';
import { getDb } from '../database/connection';
import { savePosition, setCompleted, getStats, getMostRecentCourseId, getRecentlyOpenedCourseIds, getLastActivity } from '../database/repositories/progress';
import { requireId } from '../services/validate';

export function registerProgressIpc(): void {
  const db = getDb();

  ipcMain.handle('progress:savePosition', (_e, lessonId: unknown, seconds: unknown) => {
    const s = typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
    savePosition(db, requireId(lessonId, 'lessonId'), s);
  });

  ipcMain.handle('progress:setCompleted', (_e, lessonId: unknown, completed: unknown) => {
    setCompleted(db, requireId(lessonId, 'lessonId'), completed === true);
  });

  ipcMain.handle('progress:stats', () => {
    return getStats(db);
  });

  ipcMain.handle('progress:mostRecentCourseId', () => {
    return getMostRecentCourseId(db);
  });

  ipcMain.handle('progress:recentCourseIds', (_e, limit?: unknown) => {
    const n = typeof limit === 'number' && Number.isInteger(limit) && limit > 0 ? Math.min(limit, 20) : 5;
    return getRecentlyOpenedCourseIds(db, n);
  });

  ipcMain.handle('progress:lastActivity', (_e, courseId: unknown) => {
    return getLastActivity(db, requireId(courseId, 'courseId'));
  });
}
