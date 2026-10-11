import { ipcMain, dialog } from 'electron';
import { getDb } from '../database/connection';
import { listSources } from '../database/repositories/practice';
import {
  registerSource,
  unregisterSource,
  scanLibrary,
  loadExamFile,
  submitExamAttempt,
  listExamAttempts,
  getExamAttemptDetail,
} from '../services/practiceLibraryService';
import { requireId, requirePath } from '../services/validate';

export function registerPracticeIpc(): void {
  const db = getDb();

  ipcMain.handle('practice:listSources', () => {
    return listSources(db);
  });

  ipcMain.handle('practice:addFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select a folder of practice tests',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return registerSource(db, result.filePaths[0], 'dir');
  });

  ipcMain.handle('practice:addFile', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      title: 'Select a practice test file',
      filters: [{ name: 'Practice exams', extensions: ['html', 'htm'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return registerSource(db, result.filePaths[0], 'file');
  });

  // Direct-path variants (scripting/tests; the dialogs above cover the UI).
  ipcMain.handle('practice:addFolderPath', (_e, dirPath: unknown) => {
    return registerSource(db, requirePath(dirPath, 'dirPath'), 'dir');
  });

  ipcMain.handle('practice:addFilePath', (_e, filePath: unknown) => {
    return registerSource(db, requirePath(filePath, 'filePath'), 'file');
  });

  ipcMain.handle('practice:removeSource', (_e, sourceId: unknown) => {
    unregisterSource(db, requireId(sourceId, 'sourceId'));
  });

  ipcMain.handle('practice:scan', () => {
    return scanLibrary(db);
  });

  ipcMain.handle('practice:load', (_e, filePath: unknown) => {
    return loadExamFile(db, requirePath(filePath, 'filePath'));
  });

  ipcMain.handle('practice:submit', (_e, filePath: unknown, answers: unknown, flagged?: unknown, contentHash?: unknown) => {
    return submitExamAttempt(db, requirePath(filePath, 'filePath'), answers, flagged, contentHash);
  });

  ipcMain.handle('practice:history', (_e, filePath: unknown) => {
    return listExamAttempts(db, requirePath(filePath, 'filePath'));
  });

  ipcMain.handle('practice:attemptDetail', (_e, attemptId: unknown) => {
    return getExamAttemptDetail(db, requireId(attemptId, 'attemptId'));
  });
}
