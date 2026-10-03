import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../electron/database/connection';
import { MIGRATIONS } from '../electron/database/migrations';
import { importCourse, rescanCourse } from '../electron/services/courseImportService';
import {
  listCourses,
  getCourseDetail,
  getCourseBySourcePath,
  deleteCourse,
} from '../electron/database/repositories/courses';
import {
  savePosition,
  setCompleted,
  getStats,
} from '../electron/database/repositories/progress';
import {
  insertNote,
  updateNote,
  deleteNote,
  listNotes,
  searchNotes,
} from '../electron/database/repositories/notes';
import {
  insertQuiz,
  insertQuestion,
  getQuiz,
  listQuizzesForCourse,
  insertAttempt,
  listAttempts,
  getAttemptDetail,
  deleteQuiz,
} from '../electron/database/repositories/quizzes';
import { getAllSettings, setSetting } from '../electron/database/repositories/settings';
import {
  checkFileExists,
  resolveLessonFile,
} from '../electron/services/fileService';
import { validateQuestionInput } from '../electron/ipc/quizzes';

const tmpRoots: string[] = [];
let db: Database.Database;
let dbDir: string;

function trackTemp(dir: string): string {
  tmpRoots.push(dir);
  return dir;
}

function makeCourseDir(name = 'AWS Solutions Architect'): string {
  const root = trackTemp(fs.mkdtempSync(path.join(os.tmpdir(), 'ismalearn-course-')));
  const courseRoot = path.join(root, name);
  fs.mkdirSync(path.join(courseRoot, '01 - Introduction'), { recursive: true });
  fs.mkdirSync(path.join(courseRoot, '02 - EC2'), { recursive: true });
  fs.writeFileSync(path.join(courseRoot, '01 - Introduction', '01 - Welcome.mp4'), '');
  fs.writeFileSync(path.join(courseRoot, '01 - Introduction', '02 - Overview.mp4'), '');
  fs.writeFileSync(path.join(courseRoot, '02 - EC2', '01 - Instances.mp4'), '');
  fs.writeFileSync(path.join(courseRoot, '02 - EC2', 'notes.pdf'), '');
  return courseRoot;
}

beforeEach(() => {
  dbDir = trackTemp(fs.mkdtempSync(path.join(os.tmpdir(), 'ismalearn-db-')));
  db = createDatabase(path.join(dbDir, 'test.db'));
});

afterEach(() => {
  try {
    db.close();
  } catch {
    // beforeEach may have failed — nothing to close
  }
  for (const dir of tmpRoots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('migrations', () => {
  it('creates all required tables', () => {
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>
    ).map((r) => r.name);
    for (const t of [
      'courses', 'sections', 'lessons', 'lesson_progress', 'notes',
      'quizzes', 'quiz_questions', 'quiz_attempts', 'quiz_attempt_answers', 'app_settings',
    ]) {
      expect(tables).toContain(t);
    }
    expect(MIGRATIONS.length).toBeGreaterThan(0);
  });

  it('is idempotent when run twice', () => {
    const db2 = createDatabase(path.join(dbDir, 'test.db'));
    db2.close();
  });
});

describe('course import', () => {
  it('imports sections and lessons without touching original files', () => {
    const courseRoot = makeCourseDir();
    const before = fs.readdirSync(courseRoot);
    const result = importCourse(db, courseRoot);
    expect(result.status).toBe('imported');
    expect(result.lessonCount).toBe(3);

    const detail = getCourseDetail(db, result.courseId!);
    expect(detail?.sections).toHaveLength(2);
    expect(detail?.lessonCount).toBe(3);

    // original files untouched
    expect(fs.readdirSync(courseRoot).sort()).toEqual(before.sort());
  });

  it('detects duplicate imports by source path', () => {
    const courseRoot = makeCourseDir();
    const first = importCourse(db, courseRoot);
    expect(first.status).toBe('imported');
    const second = importCourse(db, courseRoot);
    expect(second.status).toBe('duplicate');
    expect(second.courseId).toBe(first.courseId);
    expect(listCourses(db)).toHaveLength(1);
    expect(getCourseBySourcePath(db, courseRoot)?.id).toBe(first.courseId);
  });

  it('rejects folders without videos with a clear error', () => {
    const root = trackTemp(fs.mkdtempSync(path.join(os.tmpdir(), 'ismalearn-empty-')));
    fs.writeFileSync(path.join(root, 'notes.pdf'), '');
    const result = importCourse(db, root);
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/no video files/i);
  });

  it('removes a course and cascades related rows', () => {
    const result = importCourse(db, makeCourseDir());
    const courseId = result.courseId!;
    const detail = getCourseDetail(db, courseId)!;
    const lessonId = detail.sections[0].lessons[0].id;
    savePosition(db, lessonId, 42);
    insertNote(db, { courseId, lessonId, title: 't', content: 'c' });
    deleteCourse(db, courseId);
    expect(getCourseDetail(db, courseId)).toBeNull();
    expect(listNotes(db)).toHaveLength(0);
  });

  it('imports HTML practice tests as completable lessons', () => {
    const root = trackTemp(fs.mkdtempSync(path.join(os.tmpdir(), 'ismalearn-practice-')));
    const courseRoot = path.join(root, 'DVA-C02 Practice Exams');
    fs.mkdirSync(path.join(courseRoot, '01. practice-test'), { recursive: true });
    fs.writeFileSync(path.join(courseRoot, '01. practice-test', '1.1 Practice Test #1.html'), '<html></html>');
    fs.writeFileSync(path.join(courseRoot, '01. practice-test', '1.2 Practice Test #2.html'), '<html></html>');
    fs.writeFileSync(path.join(courseRoot, 'intro.mp4'), '');

    const result = importCourse(db, courseRoot);
    expect(result.status).toBe('imported');
    expect(result.lessonCount).toBe(3);

    const detail = getCourseDetail(db, result.courseId!)!;
    expect(detail.sections).toHaveLength(2);
    const practiceSection = detail.sections.find((s) => s.lessons[0]?.fileType === 'practice')!;
    expect(practiceSection.lessons).toHaveLength(2);
    expect(practiceSection.lessons[0].fileType).toBe('practice');

    // counts include practice lessons and they can be completed manually
    expect(detail.lessonCount).toBe(3);
    setCompleted(db, practiceSection.lessons[0].id, true);
    const updated = getCourseDetail(db, result.courseId!)!;
    expect(updated.completedCount).toBe(1);
    expect(listCourses(db)[0].lessonCount).toBe(3);
  });
});

describe('rescan', () => {
  it('adds new lessons and removes deleted ones while preserving progress', () => {
    const courseRoot = makeCourseDir();
    const { courseId } = importCourse(db, courseRoot) as { courseId: number };
    const before = getCourseDetail(db, courseId)!;
    const firstLesson = before.sections[0].lessons[0];
    setCompleted(db, firstLesson.id, true);
    savePosition(db, firstLesson.id, 120);

    // add a lesson, delete another
    fs.writeFileSync(path.join(courseRoot, '02 - EC2', '02 - New Lesson.mp4'), '');
    fs.rmSync(path.join(courseRoot, '01 - Introduction', '02 - Overview.mp4'));

    const result = rescanCourse(db, courseId);
    expect(result.status).toBe('ok');
    expect(result.addedLessons).toBe(1);
    expect(result.removedLessons).toBe(1);

    const after = getCourseDetail(db, courseId)!;
    expect(after.lessonCount).toBe(3);
    const kept = after.sections[0].lessons.find((l) => l.id === firstLesson.id);
    expect(kept?.completed).toBe(true);
    expect(kept?.positionSeconds).toBe(120);
  });
});

describe('progress persistence', () => {
  it('saves positions, toggles completion and computes stats', () => {
    const { courseId } = importCourse(db, makeCourseDir()) as { courseId: number };
    const detail = getCourseDetail(db, courseId)!;
    const [l1, l2] = detail.sections.flatMap((s) => s.lessons);

    savePosition(db, l1.id, 65);
    // reopening the db from the same file keeps progress
    db.close();
    db = createDatabase(path.join(dbDir, 'test.db'));
    const reopened = getCourseDetail(db, courseId)!;
    expect(reopened.sections.flatMap((s) => s.lessons).find((l) => l.id === l1.id)?.positionSeconds).toBe(65);

    // opening a lesson must not auto-complete it
    expect(reopened.sections.flatMap((s) => s.lessons).find((l) => l.id === l1.id)?.completed).toBe(false);

    setCompleted(db, l1.id, true);
    setCompleted(db, l2.id, true);
    const done = getCourseDetail(db, courseId)!;
    expect(done.completedCount).toBe(2);
    expect(done.progressPercent).toBe(Math.round((2 / done.lessonCount) * 100));

    const stats = getStats(db);
    expect(stats.courseCount).toBe(1);
    expect(stats.lessonsCompleted).toBe(2);
    expect(stats.totalLessons).toBe(3);
  });
});

describe('notes', () => {
  it('creates, updates, searches and deletes notes, surviving restarts', () => {
    const { courseId } = importCourse(db, makeCourseDir()) as { courseId: number };
    const lessonId = getCourseDetail(db, courseId)!.sections[0].lessons[0].id;

    const note = insertNote(db, {
      courseId,
      lessonId,
      title: 'EC2 recap',
      content: 'Instances are [05:00](t=300) virtual servers',
    });
    expect(note.id).toBeGreaterThan(0);

    const updated = updateNote(db, note.id, { title: 'EC2 recap v2', content: 'updated content' });
    expect(updated.title).toBe('EC2 recap v2');

    expect(searchNotes(db, 'recap')).toHaveLength(1);
    expect(searchNotes(db, 'nothing-matching-xyz')).toHaveLength(0);
    expect(listNotes(db, courseId)).toHaveLength(1);

    // persistence across restarts
    db.close();
    db = createDatabase(path.join(dbDir, 'test.db'));
    expect(listNotes(db)).toHaveLength(1);

    deleteNote(db, note.id);
    expect(listNotes(db)).toHaveLength(0);
  });
});

describe('quizzes', () => {
  it('validates question input', () => {
    expect(
      validateQuestionInput({ question: 'Q?', options: ['a', 'b'], correctIndex: 0 }, 0),
    ).toMatchObject({ question: 'Q?', correctIndex: 0 });
    expect(() => validateQuestionInput({ question: '', options: ['a', 'b'], correctIndex: 0 }, 0)).toThrow();
    expect(() => validateQuestionInput({ question: 'Q?', options: ['only-one'], correctIndex: 0 }, 0)).toThrow();
    expect(() => validateQuestionInput({ question: 'Q?', options: ['a', 'b'], correctIndex: 5 }, 0)).toThrow();
  });

  it('scores attempts and keeps history', () => {
    const { courseId } = importCourse(db, makeCourseDir()) as { courseId: number };
    const quizId = insertQuiz(db, { courseId, sectionId: null, title: 'Checkpoint', description: '' });
    const q1 = insertQuestion(db, quizId, {
      question: 'What is EC2?', options: ['Compute', 'Storage', 'DB', 'CDN'],
      correctIndex: 0, explanation: 'Elastic Compute Cloud', position: 1,
    });
    const q2 = insertQuestion(db, quizId, {
      question: 'What is S3?', options: ['Compute', 'Storage', 'DB', 'CDN'],
      correctIndex: 1, explanation: '', position: 2,
    });

    expect(listQuizzesForCourse(db, courseId)).toHaveLength(1);
    expect(getQuiz(db, quizId)?.questions).toHaveLength(2);

    const attemptId = insertAttempt(db, quizId, [
      { questionId: q1, selectedIndex: 0, isCorrect: true },
      { questionId: q2, selectedIndex: 2, isCorrect: false },
    ]);
    const detail = getAttemptDetail(db, attemptId)!;
    expect(detail.score).toBe(1);
    expect(detail.total).toBe(2);
    expect(detail.percent).toBe(50);
    expect(detail.answers[0].isCorrect).toBe(true);
    expect(detail.answers[1].isCorrect).toBe(false);

    expect(listAttempts(db, quizId)).toHaveLength(1);
    deleteQuiz(db, quizId);
    expect(listQuizzesForCourse(db, courseId)).toHaveLength(0);
  });
});

describe('settings', () => {
  it('returns defaults and persists changes', () => {
    const defaults = getAllSettings(db);
    expect(defaults.theme).toBe('dark');
    expect(defaults.resumePlayback).toBe('ask');

    setSetting(db, 'theme', 'light');
    expect(getAllSettings(db).theme).toBe('light');

    db.close();
    db = createDatabase(path.join(dbDir, 'test.db'));
    expect(getAllSettings(db).theme).toBe('light');
  });
});

describe('missing media files', () => {
  it('reports missing files safely instead of crashing', () => {
    const courseRoot = makeCourseDir();
    const { courseId } = importCourse(db, courseRoot) as { courseId: number };
    const lesson = getCourseDetail(db, courseId)!.sections[0].lessons[0];
    expect(checkFileExists(db, lesson.id)).toBe(true);
    expect(() => resolveLessonFile(db, lesson.id)).not.toThrow();

    fs.rmSync(path.join(courseRoot, '01 - Introduction', '01 - Welcome.mp4'));
    expect(checkFileExists(db, lesson.id)).toBe(false);
    expect(() => resolveLessonFile(db, lesson.id)).toThrow(/not found/i);
  });

  it('rejects files outside the course directory', () => {
    const { courseId } = importCourse(db, makeCourseDir()) as { courseId: number };
    const lesson = getCourseDetail(db, courseId)!.sections[0].lessons[0];
    // Simulate a lesson path that escapes the course root
    const outside = path.join(os.tmpdir(), 'evil.mp4');
    db.prepare('UPDATE lessons SET file_path = ? WHERE id = ?').run(outside, lesson.id);
    expect(() => resolveLessonFile(db, lesson.id)).toThrow(/outside/i);
  });
});
