import { ipcMain } from 'electron';
import { checkForUpdates, getUpdateStatus, installUpdate } from '../services/updateService';

export function registerUpdatesIpc(): void {
  ipcMain.handle('updates:status', () => getUpdateStatus());
  // Resolves once the check is done; a found update keeps downloading after.
  ipcMain.handle('updates:check', () => checkForUpdates());
  ipcMain.handle('updates:install', () => installUpdate());
}
