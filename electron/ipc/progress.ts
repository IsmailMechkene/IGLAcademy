import { ipcMain } from 'electron';
import { getDb } from '../database/connection';
import { savePosition, setCompleted, getStats, getMostRecentCourseId, getRecentlyOpenedCourseIds, getLastActivity } from '../database/repositories/progress';
import { requireId } from '../services/validate';
import { getLesson } from '../database/repositories/courses';
import { getAllSettings } from '../database/repositories/settings';
import { getStudyStats, recordActivity } from '../database/repositories/activity';

/** The player flushes every ~15 s; anything far above that is not real. */
const MAX_WATCH_FLUSH_SECONDS = 120;

export function registerProgressIpc(): void {
  const db = getDb();

  ipcMain.handle('progress:savePosition', (_e, lessonId: unknown, seconds: unknown) => {
    const s = typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0 ? seconds : 0;
    savePosition(db, requireId(lessonId, 'lessonId'), s);
  });

  ipcMain.handle('progress:setCompleted', (_e, lessonId: unknown, completed: unknown) => {
    const id = requireId(lessonId, 'lessonId');
    const wasCompleted = getLesson(db, id)?.completed === true;
    setCompleted(db, id, completed === true);
    // Only a lesson newly finished counts towards today; toggling back and
    // forth must not inflate it.
    if (completed === true && !wasCompleted) recordActivity(db, { lessonsCompleted: 1 });
  });

  // Real playback time, flushed by the player every few seconds. Capped per
  // call so a bad or replayed message cannot invent hours of study.
  ipcMain.handle('progress:addWatchTime', (_e, lessonId: unknown, seconds: unknown) => {
    requireId(lessonId, 'lessonId');
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return;
    recordActivity(db, { watchSeconds: Math.min(seconds, MAX_WATCH_FLUSH_SECONDS) });
  });

  ipcMain.handle('progress:studyStats', () => {
    return getStudyStats(db, getAllSettings(db).dailyGoalMinutes);
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
