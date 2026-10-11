import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../electron/database/connection';
import { importCourse, rescanCourse } from '../electron/services/courseImportService';
import {
  getCourseDetail,
  getSectionRelPaths,
  renameSection,
  listCourses,
} from '../electron/database/repositories/courses';
import { savePosition, setCompleted } from '../electron/database/repositories/progress';
import { insertNote, listNotes } from '../electron/database/repositories/notes';
import { isInsideDir, relDirOf } from '../electron/services/pathIdentity';

const tmpRoots: string[] = [];
let db: Database.Database;

function tmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

function touch(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '');
}

beforeEach(() => {
  db = createDatabase(path.join(tmp('ismalearn-db-'), 'test.db'));
});

afterEach(() => {
  db.close();
  for (const dir of tmpRoots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('path identity helpers', () => {
  it('contains only real descendants', () => {
    const root = path.resolve('/courses/aws');
    expect(isInsideDir(root, path.join(root, 'a', 'b.mp4'))).toBe(true);
    expect(isInsideDir(root, root)).toBe(true);
    expect(isInsideDir(root, path.resolve('/courses/aws-extra/x.mp4'))).toBe(false);
    expect(isInsideDir(root, path.resolve('/courses/x.mp4'))).toBe(false);
    // a folder whose name merely starts with two dots is still inside
    expect(isInsideDir(root, path.join(root, '..hidden', 'x.mp4'))).toBe(true);
  });

  it('gives course-relative folders with forward slashes', () => {
    const root = path.resolve('/c');
    expect(relDirOf(root, path.join(root, 'Part 1', 'Videos', 'a.mp4'))).toBe('Part 1/Videos');
    expect(relDirOf(root, path.join(root, 'a.mp4'))).toBe('');
    expect(relDirOf(root, path.resolve('/elsewhere/a.mp4'))).toBeNull();
  });
});

describe('course identity (M3)', () => {
  it.runIf(process.platform === 'win32')('treats a differently-cased path as the same course', () => {
    const root = path.join(tmp('ismalearn-course-'), 'AWS Course');
    touch(path.join(root, '01 - Intro', '01 - Welcome.mp4'));
    const first = importCourse(db, root);
    expect(first.status).toBe('imported');

    const second = importCourse(db, root.toLowerCase());
    expect(second.status).toBe('duplicate');
    const third = importCourse(db, root.toUpperCase());
    expect(third.status).toBe('duplicate');
    expect(listCourses(db)).toHaveLength(1);
  });

  it('treats a non-normalised spelling of the same folder as the same course', () => {
    const root = path.join(tmp('ismalearn-course-'), 'AWS Course');
    touch(path.join(root, '01 - Intro', '01 - Welcome.mp4'));
    expect(importCourse(db, root).status).toBe('imported');
    expect(importCourse(db, path.join(root, '01 - Intro', '..') + path.sep).status).toBe('duplicate');
  });
});

describe('section identity (M10)', () => {
  it('keeps same-named sibling folders apart, on import and on rescan', () => {
    const root = path.join(tmp('ismalearn-course-'), 'Course');
    touch(path.join(root, 'Part 1', 'Videos', '01 - Intro.mp4'));
    touch(path.join(root, 'Part 2', 'Videos', '01 - Intro.mp4'));
    const { courseId } = importCourse(db, root) as { courseId: number };

    const detail = getCourseDetail(db, courseId)!;
    expect(detail.sections.map((s) => s.title)).toEqual(['Part 1 / Videos', 'Part 2 / Videos']);
    expect([...getSectionRelPaths(db, courseId).values()].sort()).toEqual(['Part 1/Videos', 'Part 2/Videos']);
    const [part1, part2] = detail.sections;

    // A new file in Part 2 must land in Part 2, not the first "Videos".
    touch(path.join(root, 'Part 2', 'Videos', '02 - Next.mp4'));
    const result = rescanCourse(db, courseId);
    expect(result).toMatchObject({ status: 'ok', addedLessons: 1, addedSections: 0, missingLessons: 0 });
    const after = getCourseDetail(db, courseId)!;
    expect(after.sections.find((s) => s.id === part1.id)!.lessons).toHaveLength(1);
    expect(after.sections.find((s) => s.id === part2.id)!.lessons.map((l) => l.title)).toEqual([
      '01 - Intro',
      '02 - Next',
    ]);
  });

  it('follows a renamed section folder instead of duplicating it', () => {
    const root = path.join(tmp('ismalearn-course-'), 'Course');
    touch(path.join(root, '01 - Introduction', '01 - Welcome.mp4'));
    touch(path.join(root, '01 - Introduction', '02 - Overview.mp4'));
    touch(path.join(root, '02 - EC2', '01 - Instances.mp4'));
    const { courseId } = importCourse(db, root) as { courseId: number };
    const before = getCourseDetail(db, courseId)!;
    const intro = before.sections[0];
    const welcome = intro.lessons[0];
    savePosition(db, welcome.id, 42);
    setCompleted(db, welcome.id, true);
    insertNote(db, { courseId, lessonId: welcome.id, title: 'n', content: 'c' });

    fs.renameSync(path.join(root, '01 - Introduction'), path.join(root, '01 - Getting Started'));
    const result = rescanCourse(db, courseId);
    expect(result).toMatchObject({ status: 'ok', addedLessons: 0, addedSections: 0, missingLessons: 0 });

    const after = getCourseDetail(db, courseId)!;
    expect(after.sections).toHaveLength(2);
    const moved = after.sections.find((s) => s.id === intro.id)!;
    expect(moved.title).toBe('01 - Getting Started');
    expect(moved.lessons.map((l) => l.id)).toEqual(intro.lessons.map((l) => l.id));
    expect(moved.lessons.every((l) => l.missingSince === null)).toBe(true);
    const kept = moved.lessons.find((l) => l.id === welcome.id)!;
    expect(kept.positionSeconds).toBe(42);
    expect(kept.completed).toBe(true);
    expect(kept.filePath).toBe(path.join(after.sourcePath, '01 - Getting Started', '01 - Welcome.mp4'));
    expect(listNotes(db, courseId)).toHaveLength(1);
    expect(getSectionRelPaths(db, courseId).get(intro.id)).toBe('01 - Getting Started');
  });

  it('keeps a title the user chose when the folder is renamed', () => {
    const root = path.join(tmp('ismalearn-course-'), 'Course');
    touch(path.join(root, '01 - Introduction', '01 - Welcome.mp4'));
    const { courseId } = importCourse(db, root) as { courseId: number };
    const sectionId = getCourseDetail(db, courseId)!.sections[0].id;
    renameSection(db, sectionId, 'My favourite part');

    fs.renameSync(path.join(root, '01 - Introduction'), path.join(root, '01 - Intro'));
    rescanCourse(db, courseId);
    const after = getCourseDetail(db, courseId)!;
    expect(after.sections).toHaveLength(1);
    expect(after.sections[0].title).toBe('My favourite part');
  });

  it('moves a lesson whose file moved into another existing folder', () => {
    const root = path.join(tmp('ismalearn-course-'), 'Course');
    touch(path.join(root, 'A', '01 - One.mp4'));
    touch(path.join(root, 'A', '02 - Two.mp4'));
    touch(path.join(root, 'B', '01 - Three.mp4'));
    const { courseId } = importCourse(db, root) as { courseId: number };
    const [a, b] = getCourseDetail(db, courseId)!.sections;
    const two = a.lessons[1];
    savePosition(db, two.id, 7);

    fs.renameSync(path.join(root, 'A', '02 - Two.mp4'), path.join(root, 'B', '02 - Two.mp4'));
    expect(rescanCourse(db, courseId)).toMatchObject({ addedLessons: 0, missingLessons: 0 });
    const after = getCourseDetail(db, courseId)!;
    expect(after.sections.find((s) => s.id === a.id)!.lessons.map((l) => l.id)).toEqual([a.lessons[0].id]);
    const bLessons = after.sections.find((s) => s.id === b.id)!.lessons;
    expect(bLessons.find((l) => l.id === two.id)?.positionSeconds).toBe(7);
  });

  it('backfills the folder of sections imported before folders were recorded', () => {
    const root = path.join(tmp('ismalearn-course-'), 'Course');
    touch(path.join(root, 'Part 1', 'Videos', '01 - Intro.mp4'));
    const { courseId } = importCourse(db, root) as { courseId: number };
    db.prepare('UPDATE sections SET rel_path = NULL').run();

    touch(path.join(root, 'Part 1', 'Videos', '02 - More.mp4'));
    expect(rescanCourse(db, courseId)).toMatchObject({ addedLessons: 1, addedSections: 0 });
    expect([...getSectionRelPaths(db, courseId).values()]).toEqual(['Part 1/Videos']);
  });
});
