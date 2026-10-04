import fs from 'node:fs';
import path from 'node:path';
import { ipcMain, dialog, shell } from 'electron';
import { getDb } from '../database/connection';
import { getResource, listResourcesForCourse } from '../database/repositories/resources';
import { resolveResourceFile } from '../services/fileService';
import { searchResources } from '../services/resourceService';
import { requireId, requireString } from '../services/validate';

export function registerResourceIpc(): void {
  const db = getDb();

  ipcMain.handle('resources:listForCourse', (_e, courseId: unknown) => {
    return listResourcesForCourse(db, requireId(courseId, 'courseId'));
  });

  ipcMain.handle('resources:previewUrl', (_e, resourceId: unknown) => {
    resolveResourceFile(db, requireId(resourceId, 'resourceId')); // throws when unavailable
    return `media://resource/${requireId(resourceId, 'resourceId')}`;
  });

  ipcMain.handle('resources:search', (_e, courseId: unknown, query: unknown) => {
    return searchResources(db, requireId(courseId, 'courseId'), requireString(query, 'query', 200));
  });

  // Opens with the system default application.
  ipcMain.handle('resources:open', async (_e, resourceId: unknown) => {
    const filePath = resolveResourceFile(db, requireId(resourceId, 'resourceId'));
    await shell.openPath(filePath);
  });

  // Reveals the file in the system file manager.
  ipcMain.handle('resources:reveal', (_e, resourceId: unknown) => {
    const filePath = resolveResourceFile(db, requireId(resourceId, 'resourceId'));
    shell.showItemInFolder(filePath);
  });

  // Copies the file to a user-chosen location ("download").
  ipcMain.handle('resources:download', async (_e, resourceId: unknown) => {
    const id = requireId(resourceId, 'resourceId');
    const filePath = resolveResourceFile(db, id);
    const resource = getResource(db, id);
    const result = await dialog.showSaveDialog({
      title: 'Save resource copy',
      defaultPath: resource ? resource.title + path.extname(filePath) : path.basename(filePath),
    });
    if (result.canceled || !result.filePath) return null;
    fs.copyFileSync(filePath, result.filePath);
    return result.filePath;
  });
}
