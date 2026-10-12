import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../electron/database/connection';
import { importCourse } from '../electron/services/courseImportService';
import { getCourseDetail } from '../electron/database/repositories/courses';
import { insertNote } from '../electron/database/repositories/notes';
import { setCompleted } from '../electron/database/repositories/progress';
import { registerSource } from '../electron/services/practiceLibraryService';
import { globalSearch, invalidateSearchCache } from '../electron/services/searchService';

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
  invalidateSearchCache();
});

afterEach(() => {
  db.close();
  for (const dir of tmpRoots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('globalSearch', () => {
  it('finds courses, lessons, notes and practice exams in one query', () => {
    const root = path.join(tmp('ismalearn-course-'), 'AWS Storage Deep Dive');
    touch(path.join(root, '01 - Intro', '01 - Welcome.mp4'));
    touch(path.join(root, '02 - S3', '01 - Storage classes.mp4'));
    touch(path.join(root, '02 - S3', '02 - Versioning.mp4'));
    const { courseId } = importCourse(db, root) as { courseId: number };
    const lesson = getCourseDetail(db, courseId)!.sections[1].lessons[0];
    insertNote(db, { courseId, lessonId: lesson.id, title: 'Glacier tiers', content: 'Deep archive storage is cheapest.' });

    const exams = tmp('ismalearn-exams-');
    touch(
      path.join(exams, 'Storage quiz.html'),
      `<html><body><script>const quizData = ${JSON.stringify({
        quiz_title: 'Storage practice test',
        questions: [{ assessment_type: 'multiple-choice', prompt: { question: '<p>Q</p>', answers: ['<p>A</p>', '<p>B</p>'], explanation: '' }, correct_response: ['a'] }],
      })};</script></body></html>`,
    );
    registerSource(db, exams, 'dir');

    const r = globalSearch(db, 'storage');
    expect(r.courses.map((c) => c.title)).toEqual(['AWS Storage Deep Dive']);
    expect(r.courses[0].lessonCount).toBe(3);
    expect(r.lessons.map((l) => l.title)).toEqual(['01 - Storage classes']);
    expect(r.lessons[0]).toMatchObject({ courseId, sectionTitle: '02 - S3', kind: 'video' });
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]).toMatchObject({ title: 'Glacier tiers', lessonId: lesson.id });
    expect(r.notes[0].snippet).toContain('storage is cheapest');
    expect(r.exams.map((e) => e.title)).toEqual(['Storage practice test']);
  });

  it('ranks titles that start with the query first and treats % and _ literally', () => {
    const root = path.join(tmp('ismalearn-course-'), 'Course');
    touch(path.join(root, 'A', '01 - Intro to versioning.mp4'));
    touch(path.join(root, 'A', '02 - Versioning basics.mp4'));
    touch(path.join(root, 'A', '03 - 100% coverage.mp4'));
    importCourse(db, root);

    expect(globalSearch(db, 'versioning').lessons.map((l) => l.title)).toEqual([
      '02 - Versioning basics',
      '01 - Intro to versioning',
    ]);
    expect(globalSearch(db, '0%').lessons.map((l) => l.title)).toEqual(['03 - 100% coverage']);
    expect(globalSearch(db, '_').lessons).toEqual([]);
    expect(globalSearch(db, '   ')).toEqual({ courses: [], sections: [], lessons: [], notes: [], exams: [] });
  });

  it('finds sections by name and lists their lessons after title matches', () => {
    const root = path.join(tmp('ismalearn-course-'), 'Course');
    touch(path.join(root, '01 - Basics', '01 - Storage overview.mp4'));
    touch(path.join(root, '02 - Storage', '01 - Buckets.mp4'));
    touch(path.join(root, '02 - Storage', '02 - Versioning.mp4'));
    const { courseId } = importCourse(db, root) as { courseId: number };
    const [buckets, versioning] = getCourseDetail(db, courseId)!.sections[1].lessons;

    const r = globalSearch(db, 'storage');
    expect(r.sections).toEqual([
      { id: expect.any(Number), title: '02 - Storage', courseId, courseTitle: 'Course', lessonCount: 2, lessonId: buckets.id },
    ]);
    // the lesson named "Storage …" first, then the lessons in the Storage section
    expect(r.lessons.map((l) => l.title)).toEqual(['01 - Storage overview', '01 - Buckets', '02 - Versioning']);

    // the section opens on the first lesson not yet finished
    setCompleted(db, buckets.id, true);
    expect(globalSearch(db, 'storage').sections[0].lessonId).toBe(versioning.id);
  });
});
