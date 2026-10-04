import { ipcMain, app, dialog, shell } from 'electron';
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

  // Opens an https URL in the system browser (validated scheme + host).
  ipcMain.handle('app:openUrl', async (_e, url: unknown) => {
    if (typeof url !== 'string') throw new Error('Invalid URL');
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('Invalid URL');
    }
    if (parsed.protocol !== 'https:') throw new Error('Only https links can be opened.');
    await shell.openExternal(parsed.href);
  });
}
