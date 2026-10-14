import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../electron/database/connection';
import { importCourse, rescanCourse } from '../electron/services/courseImportService';
import { getCourse, updateCourse } from '../electron/database/repositories/courses';
import { getCourseThumbnailUrl, resolveThumbnailFile } from '../electron/services/fileService';
import {
  clearGeneratedThumbnail,
  ensureGeneratedThumbnail,
  generatedThumbnailPath,
  initThumbnailCache,
} from '../electron/services/thumbnailService';

const tmpRoots: string[] = [];
let db: Database.Database;
let userData: string;

function tmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

function touch(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'x');
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

beforeEach(() => {
  userData = tmp('ismalearn-ud-');
  db = createDatabase(path.join(userData, 'test.db'));
  initThumbnailCache(userData);
});

afterEach(() => {
  db.close();
  for (const dir of tmpRoots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function makeCourse(withCover = false): number {
  const root = path.join(tmp('ismalearn-course-'), 'Course');
  touch(path.join(root, '01 - Intro', '01 - Broken.mp4'));
  touch(path.join(root, '01 - Intro', '02 - Good.mp4'));
  if (withCover) touch(path.join(root, 'cover.jpg'));
  return (importCourse(db, root) as { courseId: number }).courseId;
}

describe('generated course thumbnails', () => {
  it('renders a frame from the first video that works and caches it in the app data folder', async () => {
    const courseId = makeCourse();
    const calls: string[] = [];
    const generate = async (file: string) => {
      calls.push(path.basename(file));
      return file.includes('Broken') ? null : PNG;
    };

    const url = await getCourseThumbnailUrl(db, courseId, generate);
    expect(url).toBe(`media://thumb/${courseId}`);
    expect(calls).toEqual(['01 - Broken.mp4', '02 - Good.mp4']);
    const cached = generatedThumbnailPath(courseId)!;
    expect(cached.startsWith(path.join(userData, 'thumbnails'))).toBe(true);
    expect(fs.readFileSync(cached)).toEqual(PNG);
    expect(resolveThumbnailFile(db, courseId)).toBe(cached);

    // cached: no second render
    await getCourseThumbnailUrl(db, courseId, generate);
    expect(calls).toHaveLength(2);
  });

  it('prefers a cover image from the course folder', async () => {
    const courseId = makeCourse(true);
    let called = false;
    const url = await getCourseThumbnailUrl(db, courseId, async () => {
      called = true;
      return PNG;
    });
    expect(url).toBe(`media://thumb/${courseId}`);
    expect(called).toBe(false);
    expect(resolveThumbnailFile(db, courseId)).toMatch(/cover\.jpg$/);
  });

  it('ignores a lecture screenshot stored as the cover by older imports', async () => {
    const courseId = makeCourse();
    const course = getCourse(db, courseId)!;
    const screenshot = path.join(course.sourcePath, '01 - Intro', '3. 2019-12-03_04-27-30.PNG');
    touch(screenshot);
    updateCourse(db, courseId, { thumbnailPath: screenshot });

    const url = await getCourseThumbnailUrl(db, courseId, async () => PNG);
    expect(url).toBe(`media://thumb/${courseId}`);
    expect(resolveThumbnailFile(db, courseId)).toBe(generatedThumbnailPath(courseId));

    // a rescan replaces it with the cover added to the folder since
    touch(path.join(course.sourcePath, 'cover.jpg'));
    rescanCourse(db, courseId);
    expect(resolveThumbnailFile(db, courseId)).toMatch(/cover\.jpg$/);
  });

  it('gives up quietly (and only tries once per session) when the OS cannot render', async () => {
    const courseId = makeCourse();
    let calls = 0;
    const generate = async () => {
      calls++;
      throw new Error('no codec');
    };
    expect(await getCourseThumbnailUrl(db, courseId, generate)).toBeNull();
    expect(await getCourseThumbnailUrl(db, courseId, generate)).toBeNull();
    expect(calls).toBe(2); // two candidate videos, one attempt
    expect(() => resolveThumbnailFile(db, courseId)).toThrow(/No thumbnail/);
  });

  it('shares one render between concurrent requests and clears with the course', async () => {
    const courseId = makeCourse();
    let calls = 0;
    const generate = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return PNG;
    };
    const results = await Promise.all([
      ensureGeneratedThumbnail(db, courseId, generate),
      ensureGeneratedThumbnail(db, courseId, generate),
      ensureGeneratedThumbnail(db, courseId, generate),
    ]);
    expect(results).toEqual([true, true, true]);
    expect(calls).toBe(1);
    clearGeneratedThumbnail(courseId);
    expect(fs.existsSync(generatedThumbnailPath(courseId)!)).toBe(false);
  });
});
