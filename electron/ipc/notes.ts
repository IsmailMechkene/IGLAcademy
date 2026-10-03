import { ipcMain } from 'electron';
import { getDb } from '../database/connection';
import { listNotes, searchNotes, getNote, insertNote, updateNote, deleteNote } from '../database/repositories/notes';
import { requireId, requireString, optionalId, optionalString } from '../services/validate';

export function registerNotesIpc(): void {
  const db = getDb();

  ipcMain.handle('notes:list', (_e, courseId?: unknown) => {
    return listNotes(db, courseId === undefined ? undefined : requireId(courseId, 'courseId'));
  });

  ipcMain.handle('notes:search', (_e, query: unknown) => {
    return searchNotes(db, requireString(query, 'query', 200));
  });

  ipcMain.handle('notes:get', (_e, id: unknown) => {
    return getNote(db, requireId(id, 'id'));
  });

  ipcMain.handle('notes:create', (_e, input: unknown) => {
    const data = input as { courseId?: unknown; lessonId?: unknown; title?: unknown; content?: unknown };
    return insertNote(db, {
      courseId: requireId(data.courseId, 'courseId'),
      lessonId: optionalId(data.lessonId, 'lessonId'),
      title: optionalString(data.title, 'title', 200),
      content: optionalString(data.content, 'content', 100000),
    });
  });

  ipcMain.handle('notes:update', (_e, id: unknown, input: unknown) => {
    const data = input as { title?: unknown; content?: unknown };
    return updateNote(db, requireId(id, 'id'), {
      title: optionalString(data.title, 'title', 200),
      content: optionalString(data.content, 'content', 100000),
    });
  });

  ipcMain.handle('notes:delete', (_e, id: unknown) => {
    deleteNote(db, requireId(id, 'id'));
  });
}
