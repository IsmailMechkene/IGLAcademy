import { ipcMain, app, dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../database/connection';
import { countCourses } from '../database/repositories/courses';

export function registerAppIpc(): void {
  const db = getDb();

  ipcMain.handle('app:getVersion', () => app.getVersion());

  ipcMain.handle('app:getPaths', () => ({
    userData: app.getPath('userData'),
    dbPath: path.join(app.getPath('userData'), 'ismalearn.db'),
  }));

  ipcMain.handle('app:getLibraryInfo', () => {
    const dbPath = path.join(app.getPath('userData'), 'ismalearn.db');
    let dbSize = 0;
    try {
      dbSize = fs.statSync(dbPath).size;
    } catch {
      // database may not exist yet
    }
    return {
      courseCount: countCourses(db),
      dbSizeBytes: dbSize,
      dbPath,
    };
  });

  ipcMain.handle('app:showError', (_e, title: unknown, message: unknown) => {
    dialog.showErrorBox(
      typeof title === 'string' ? title : 'IsmaLearn',
      typeof message === 'string' ? message : 'An unexpected error occurred.',
    );
  });
}
