import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../electron/database/connection';
import { importCourse } from '../electron/services/courseImportService';
import { updateCourse } from '../electron/database/repositories/courses';
import { listResourcesForCourse, withFileSizes } from '../electron/database/repositories/resources';
import { resolveThumbnailFile } from '../electron/services/fileService';
import { registerSource, loadExamFile } from '../electron/services/practiceLibraryService';

const tmpRoots: string[] = [];
let db: Database.Database;

function tmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

function touch(file: string, content = ''): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

beforeEach(() => {
  db = createDatabase(path.join(tmp('ismalearn-db-'), 'test.db'));
});

afterEach(() => {
  db.close();
  for (const dir of tmpRoots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('thumbnail containment (L4)', () => {
  it('serves a thumbnail only from inside the course folder', () => {
    const root = path.join(tmp('ismalearn-course-'), 'Course');
    touch(path.join(root, 'cover.png'));
    touch(path.join(root, '01 - Intro', '01 - Welcome.mp4'));
    const { courseId } = importCourse(db, root) as { courseId: number };
    expect(resolveThumbnailFile(db, courseId)).toMatch(/cover\.png$/);

    const outside = path.join(tmp('ismalearn-elsewhere-'), 'secret.png');
    touch(outside);
    updateCourse(db, courseId, { thumbnailPath: outside });
    expect(() => resolveThumbnailFile(db, courseId)).toThrow(/outside the course/);
  });
});

describe('resource sizes (L8)', () => {
  it('are looked up asynchronously, with -1 for a missing file', async () => {
    const root = path.join(tmp('ismalearn-course-'), 'Course');
    touch(path.join(root, '01 - Intro', '01 - Welcome.mp4'));
    touch(path.join(root, '01 - Intro', 'notes.txt'), 'hello');
    touch(path.join(root, '01 - Intro', 'gone.pdf'), 'x');
    const { courseId } = importCourse(db, root) as { courseId: number };
    fs.rmSync(path.join(root, '01 - Intro', 'gone.pdf'));

    const records = listResourcesForCourse(db, courseId);
    expect(records[0]).not.toHaveProperty('sizeBytes');
    const sized = await withFileSizes(records);
    expect(sized.find((r) => r.title === 'notes')?.sizeBytes).toBe(5);
    expect(sized.find((r) => r.title === 'gone')?.sizeBytes).toBe(-1);
  });
});

describe('indexes (L6)', () => {
  it('indexes flashcards by deck', () => {
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>)
      .map((r) => r.name);
    expect(names).toContain('idx_flashcards_deck');
  });
});

describe('parsed exam cache (M18)', () => {
  it('re-parses a file as soon as it changes on disk', () => {
    const root = tmp('ismalearn-cache-');
    const file = path.join(root, 'Exam.html');
    const html = (q: string) =>
      `<html><body><script>const quizData = ${JSON.stringify({
        quiz_title: 'Exam',
        questions: [{
          assessment_type: 'multiple-choice',
          prompt: { question: `<p>${q}</p>`, answers: ['<p>A</p>', '<p>B</p>'], explanation: '' },
          correct_response: ['a'],
        }],
      })};</script></body></html>`;
    touch(file, html('First?'));
    registerSource(db, root, 'dir');
    const first = loadExamFile(db, file);
    expect(loadExamFile(db, file).contentHash).toBe(first.contentHash); // served from cache

    touch(file, html('Second, longer question?'));
    const second = loadExamFile(db, file);
    expect(second.questions[0].question).toBe('Second, longer question?');
    expect(second.contentHash).not.toBe(first.contentHash);
  });
});
