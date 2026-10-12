import { ipcMain } from 'electron';
import { getDb } from '../database/connection';
import { globalSearch } from '../services/searchService';
import { ValidationError } from '../services/validate';

export function registerSearchIpc(): void {
  const db = getDb();

  // Ctrl+K palette: courses, lessons, notes and practice exams in one query.
  ipcMain.handle('search:global', (_e, query: unknown) => {
    if (typeof query !== 'string') throw new ValidationError('query must be a string');
    return globalSearch(db, query.slice(0, 200));
  });
}
