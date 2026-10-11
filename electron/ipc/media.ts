import { ipcMain, dialog, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type Database from 'better-sqlite3';
import type { Course, LocateFileResult } from '../../src/types';
import { getDb } from '../database/connection';
import {
  getMediaUrl, checkFileExists, listSubtitleTracks, resolveLessonFile, resolveSubtitleFile,
} from '../services/fileService';
import { updateLessonFilePath, getLesson, getCourse } from '../database/repositories/courses';
import { VIDEO_EXTENSIONS, PRACTICE_EXTENSIONS } from '../services/courseScanner';
import { requireId, ValidationError } from '../services/validate';
import { isInsideDir } from '../services/pathIdentity';

/** The course a lesson belongs to (lessons reach courses through sections). */
function getCourseForLesson(db: Database.Database, lessonId: number): Course | null {
  const row = db
    .prepare('SELECT s.course_id FROM lessons l JOIN sections s ON s.id = l.section_id WHERE l.id = ?')
    .get(lessonId) as { course_id: number } | undefined;
  return row ? getCourse(db, row.course_id) : null;
}

export function registerMediaIpc(): void {
  const db = getDb();

  ipcMain.handle('media:getUrl', (_e, lessonId: unknown) => {
    return getMediaUrl(db, requireId(lessonId, 'lessonId'));
  });

  ipcMain.handle('media:checkFile', (_e, lessonId: unknown) => {
    return checkFileExists(db, requireId(lessonId, 'lessonId'));
  });

  ipcMain.handle('media:subtitles', (_e, lessonId: unknown) => {
    return listSubtitleTracks(db, requireId(lessonId, 'lessonId'));
  });

  // Subtitle text (SRT converted to WebVTT). The player turns it into a
  // same-origin blob: URL: <track> loads in CORS mode, and the media://
  // scheme deliberately has no fetch/CORS support (see main.ts).
  ipcMain.handle('media:subtitleText', (_e, lessonId: unknown, index: unknown) => {
    const i = typeof index === 'number' && Number.isInteger(index) && index >= 0 ? index : -1;
    if (i < 0) throw new ValidationError('index must be a non-negative integer');
    return resolveSubtitleFile(db, requireId(lessonId, 'lessonId'), i).content;
  });

  // Opens a lesson file (e.g. an HTML practice test) in the system browser
  // for full interactivity. The path is resolved and containment-checked first.
  ipcMain.handle('media:openExternal', async (_e, lessonId: unknown) => {
    const filePath = resolveLessonFile(db, requireId(lessonId, 'lessonId'));
    await shell.openExternal(pathToFileURL(filePath).href);
  });
  // Lets the user relocate a missing lesson file via a native file dialog.
  // The chosen file is validated BEFORE the lesson row is touched: writing an
  // unusable path (outside the course folder, wrong kind) used to leave the
  // lesson permanently unplayable with no error shown anywhere.
  ipcMain.handle('media:locateFile', async (_e, lessonId: unknown): Promise<LocateFileResult> => {
    const id = requireId(lessonId, 'lessonId');
    const lesson = getLesson(db, id);
    if (!lesson) return { status: 'error', message: 'Lesson not found.' };
    const course = getCourseForLesson(db, id);
    if (!course) return { status: 'error', message: 'Course not found.' };

    const expected = lesson.fileType === 'practice' ? PRACTICE_EXTENSIONS : VIDEO_EXTENSIONS;
    const result = await dialog.showOpenDialog({
      title: `Locate "${lesson.title}"`,
      defaultPath: lesson.filePath,
      properties: ['openFile'],
      filters: [{ name: lesson.fileType === 'practice' ? 'Practice tests' : 'Video', extensions: expected.map((e) => e.slice(1)) }],
    });
    if (result.canceled || result.filePaths.length === 0) return { status: 'cancelled' };

    const picked = path.resolve(result.filePaths[0]);
    const courseRoot = path.resolve(course.sourcePath);
    if (!isInsideDir(courseRoot, picked)) {
      // Refuse rather than store a path the media protocol will always deny.
      return { status: 'outside-course', courseTitle: course.title };
    }
    if (!(expected as readonly string[]).includes(path.extname(picked).toLowerCase())) {
      return { status: 'wrong-type', expected: expected.join(', ') };
    }
    if (!fs.existsSync(picked)) {
      return { status: 'error', message: 'That file no longer exists.' };
    }

    updateLessonFilePath(db, id, picked);
    try {
      return { status: 'ok', url: getMediaUrl(db, id) };
    } catch (err) {
      return { status: 'error', message: err instanceof Error ? err.message : 'Could not open that file.' };
    }
  });
}
