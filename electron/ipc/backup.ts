import fs from 'node:fs';
import path from 'node:path';
import { ipcMain, dialog, shell, app } from 'electron';
import { getDb } from '../database/connection';
import { exportData, importData, createAutoBackup, listBackups } from '../services/backupService';
import { getAllSettings } from '../database/repositories/settings';
import { log } from '../services/logger';

export function registerBackupIpc(): void {
  const db = getDb();

  ipcMain.handle('backup:export', async () => {
    const result = await dialog.showSaveDialog({
      title: 'Export IGLAcademy data',
      defaultPath: `ismalearn-backup-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'IGLAcademy backup', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return null;
    const data = exportData(db, app.getVersion());
    fs.writeFileSync(result.filePath, JSON.stringify(data));
    log('info', `exported backup to ${path.basename(result.filePath)}`);
    return result.filePath;
  });

  // Replaces ALL data with the backup file, after an automatic safety backup.
  ipcMain.handle('backup:import', async () => {
    const picked = await dialog.showOpenDialog({
      title: 'Import IGLAcademy backup (replaces all data)',
      properties: ['openFile'],
      filters: [{ name: 'IGLAcademy backup', extensions: ['json'] }],
    });
    if (picked.canceled || picked.filePaths.length === 0) return { status: 'cancelled' as const };

    const confirm = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Restore backup', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Restore backup?',
      message: 'This replaces ALL courses, progress, notes, quizzes and settings with the backup content.',
      detail: 'A safety backup of the current data is created first.',
    });
    if (confirm.response !== 0) return { status: 'cancelled' as const };

    let raw: string;
    try {
      raw = fs.readFileSync(picked.filePaths[0], 'utf8');
    } catch {
      return { status: 'error' as const, error: 'Could not read the backup file.' };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      return { status: 'error' as const, error: 'Backup file is not valid JSON.' };
    }

    try {
      const settings = getAllSettings(db);
      createAutoBackup(db, app.getPath('userData'), Math.max(1, settings.backupKeep));
      importData(db, parsed as Parameters<typeof importData>[1]);
      log('info', `restored backup from ${path.basename(picked.filePaths[0])}`);
      return { status: 'ok' as const };
    } catch (err) {
      log('error', 'backup import failed', err instanceof Error ? err.message : String(err));
      return { status: 'error' as const, error: err instanceof Error ? err.message : 'Restore failed.' };
    }
  });

  ipcMain.handle('backup:now', () => {
    const settings = getAllSettings(db);
    const dest = createAutoBackup(db, app.getPath('userData'), settings.backupKeep);
    if (dest) log('info', `manual backup to ${path.basename(dest)}`);
    return dest;
  });

  ipcMain.handle('backup:list', () => {
    return listBackups(app.getPath('userData'));
  });

  ipcMain.handle('backup:openFolder', async () => {
    const dir = path.join(app.getPath('userData'), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    await shell.openPath(dir);
  });

  ipcMain.handle('app:openLogs', async () => {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    await shell.openPath(dir);
  });
}
