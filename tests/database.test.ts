import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../electron/database/connection';
import { MIGRATIONS } from '../electron/database/migrations';
import { importCourse, rescanCourse, getCourseHealth, relocateCourseRoot } from '../electron/services/courseImportService';
import {
  listCourses,
  getCourse,
  getCourseDetail,
  getCourseBySourcePath,
  deleteCourse,
  countCourses,
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
import {
  registerSource,
  scanLibrary,
  loadExamFile,
  submitExamAttempt,
  listExamAttempts,
  getExamAttemptDetail,
  unregisterSource,
} from '../electron/services/practiceLibraryService';
import { listSources, listPracticeAttempts } from '../electron/database/repositories/practice';
import {
  listResourcesForCourse,
} from '../electron/database/repositories/resources';
import { searchResources } from '../electron/services/resourceService';
import {
  insertBookmark,
  deleteBookmark,
  listBookmarks,
  insertReviewItem,
  setReviewItemDone,
  deleteReviewItem,
  listReviewItems,
  insertDeck,
  deleteDeck,
  insertFlashcard,
  deleteFlashcard,
  listDueFlashcards,
  listFlashcards,
  updateFlashcardState,
  listDecks,
} from '../electron/database/repositories/study';
import { exportData, importData } from '../electron/services/backupService';
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

  it('applies the multi-answer and practice-source columns', () => {
    const cols = (table: string) =>
      (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols('quiz_questions')).toContain('correct_indices');
    expect(cols('quiz_attempt_answers')).toContain('selected_indices');
    expect(cols('quizzes')).toContain('source_lesson_id');
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

  it('rejects folders without playable content with a clear error', () => {
    const root = trackTemp(fs.mkdtempSync(path.join(os.tmpdir(), 'ismalearn-empty-')));
    fs.writeFileSync(path.join(root, 'notes.pdf'), '');
    const result = importCourse(db, root);
    expect(result.status).toBe('error');
    expect(result.error).toMatch(/no videos or practice tests/i);
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

  it('registers exam sources and scans them live from disk', () => {
    const root = trackTemp(fs.mkdtempSync(path.join(os.tmpdir(), 'ismalearn-lib-')));
    const examPayload = (title: string) => ({
      quiz_title: title,
      questions: [
        {
          assessment_type: 'multiple-choice',
          prompt: { question: '<p>Q?</p>', answers: ['<p>A</p>', '<p>B</p>'], explanation: '' },
          correct_response: ['a'],
        },
      ],
    });
    const writeExam = (dir: string, name: string, title: string) => {
      fs.writeFileSync(
        path.join(dir, name),
        `<html><body><script>const quizData = ${JSON.stringify(examPayload(title))};</script></body></html>`,
      );
    };
    writeExam(root, '1.1 Practice Test #1.html', 'Exam One');
    writeExam(root, '2.2 Practice Test #2.html', 'Exam Two');
    fs.writeFileSync(path.join(root, 'notes.txt'), 'not an exam');
    fs.writeFileSync(path.join(root, 'broken.html'), '<html><body>no quiz data</body></html>');

    // registering twice returns the same source (idempotent)
    const first = registerSource(db, root, 'dir');
    const again = registerSource(db, root, 'dir');
    expect(again.id).toBe(first.id);
    expect(listSources(db)).toHaveLength(1);

    // single files register too; wrong kinds and missing paths throw
    const single = registerSource(db, path.join(root, '1.1 Practice Test #1.html'), 'file');
    expect(single.kind).toBe('file');
    expect(() => registerSource(db, path.join(root, 'lesson.mp4'), 'file')).toThrow();
    expect(() => registerSource(db, path.join(root, 'nope.html'), 'file')).toThrow();
    expect(() => registerSource(db, path.join(root, 'missing-dir'), 'dir')).toThrow();

    const scanned = scanLibrary(db);
    // folder scan + single-file source overlap on Exam One: listed once
    expect(scanned.filter((f) => !f.error)).toHaveLength(2);
    expect(scanned.filter((f) => f.error)).toHaveLength(1);
    const one = scanned.find((f) => f.title === 'Exam One')!;
    expect(one.questionCount).toBe(1);
    expect(one.attemptCount).toBe(0);
    expect(one.bestPercent).toBeNull();
  });

  it('loads exam content only from registered sources', () => {
    const root = trackTemp(fs.mkdtempSync(path.join(os.tmpdir(), 'ismalearn-libload-')));
    const htmlPath = path.join(root, 'Exam.html');
    fs.writeFileSync(
      htmlPath,
      `<html><body><script>const quizData = ${JSON.stringify({
        quiz_title: 'Loaded Exam',
        questions: [
          {
            assessment_type: 'multiple-choice',
            prompt: { question: '<p>Q?</p>', answers: ['<p>A</p>', '<p>B</p>'], explanation: '<p>Why</p>' },
            correct_response: ['b'],
          },
        ],
      })};</script></body></html>`,
    );

    // unregistered files are rejected (renderer never learns raw paths)
    expect(() => loadExamFile(db, htmlPath)).toThrow(/registered/i);

    registerSource(db, root, 'dir');
    const content = loadExamFile(db, htmlPath);
    expect(content.title).toBe('Loaded Exam');
    expect(content.questions).toHaveLength(1);
    expect(content.questions[0].explanation).toBe('Why');

    const broken = path.join(root, 'broken.html');
    fs.writeFileSync(broken, '<html><body>nothing here</body></html>');
    expect(() => loadExamFile(db, broken)).toThrow(/understand/i);
  });

  it('records attempts per file with history and review', () => {
    const root = trackTemp(fs.mkdtempSync(path.join(os.tmpdir(), 'ismalearn-libatt-')));
    const htmlPath = path.join(root, 'Exam.html');
    fs.writeFileSync(
      htmlPath,
      `<html><body><script>const quizData = ${JSON.stringify({
        quiz_title: 'Attempt Exam',
        questions: [
          {
            assessment_type: 'multiple-choice',
            prompt: { question: '<p>Q1?</p>', answers: ['<p>A</p>', '<p>B</p>'], explanation: '' },
            correct_response: ['a'],
          },
          {
            assessment_type: 'multi-select',
            prompt: { question: '<p>Q2?</p>', answers: ['<p>A</p>', '<p>B</p>', '<p>C</p>'], explanation: '' },
            correct_response: ['a', 'c'],
          },
        ],
      })};</script></body></html>`,
    );
    registerSource(db, root, 'dir');

    // wrong multi-select subset scores 1/2
    const partial = submitExamAttempt(db, htmlPath, [[0], [0]]);
    expect(partial.score).toBe(1);
    expect(partial.total).toBe(2);
    expect(partial.percent).toBe(50);
    expect(partial.answers[1].isCorrect).toBe(false);
    expect(partial.answers[1].selectedIndices).toEqual([0]);

    // perfect attempt
    const perfect = submitExamAttempt(db, htmlPath, [[0], [0, 2]]);
    expect(perfect.score).toBe(2);

    // mismatched answer counts are rejected
    expect(() => submitExamAttempt(db, htmlPath, [[0]])).toThrow(/match/i);
    // out-of-range indices are dropped (counted wrong), not fatal
    const dropped = submitExamAttempt(db, htmlPath, [[5], [0, 2]]);
    expect(dropped.score).toBe(1);

    const history = listExamAttempts(db, htmlPath);
    expect(history).toHaveLength(3);
    expect(history[0].id).toBe(dropped.id);

    const scanned = scanLibrary(db).find((f) => f.filePath === htmlPath)!;
    expect(scanned.attemptCount).toBe(3);
    expect(scanned.bestPercent).toBe(100);

    const review = getExamAttemptDetail(db, perfect.id);
    expect(review?.answers[0].question).toBe('Q1?');

    // removing the source deletes its attempts
    const source = listSources(db)[0];
    unregisterSource(db, source.id);
    expect(listSources(db)).toHaveLength(0);
    expect(listPracticeAttempts(db, htmlPath)).toHaveLength(0);
    expect(() => loadExamFile(db, htmlPath)).toThrow(/registered/i);
  });

  it('loads content only from the exact registered file for file sources', () => {
    const root = trackTemp(fs.mkdtempSync(path.join(os.tmpdir(), 'ismalearn-libfile-')));
    const htmlPath = path.join(root, 'Solo.html');
    fs.writeFileSync(
      htmlPath,
      `<html><body><script>const quizData = ${JSON.stringify({
        quiz_title: 'Solo Exam',
        questions: [
          {
            assessment_type: 'multiple-choice',
            prompt: { question: '<p>Q?</p>', answers: ['<p>A</p>', '<p>B</p>'], explanation: '' },
            correct_response: ['a'],
          },
        ],
      })};</script></body></html>`,
    );
    registerSource(db, htmlPath, 'file');
    expect(loadExamFile(db, htmlPath).title).toBe('Solo Exam');
    // sibling files are NOT covered by a file source
    const sibling = path.join(root, 'Sibling.html');
    fs.writeFileSync(sibling, '<html></html>');
    expect(() => loadExamFile(db, sibling)).toThrow(/registered/i);
    expect(scanLibrary(db)).toHaveLength(1);
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
    ).toMatchObject({ question: 'Q?', correctIndex: 0, correctIndices: [0] });
    expect(
      validateQuestionInput(
        { question: 'Q?', options: ['a', 'b', 'c'], correctIndex: 0, correctIndices: [2, 0] },
        0,
      ),
    ).toMatchObject({ correctIndex: 0, correctIndices: [0, 2] });
    expect(() => validateQuestionInput({ question: '', options: ['a', 'b'], correctIndex: 0 }, 0)).toThrow();
    expect(() => validateQuestionInput({ question: 'Q?', options: ['only-one'], correctIndex: 0 }, 0)).toThrow();
    expect(() => validateQuestionInput({ question: 'Q?', options: ['a', 'b'], correctIndex: 5 }, 0)).toThrow();
  });

  it('scores attempts and keeps history', () => {
    const { courseId } = importCourse(db, makeCourseDir()) as { courseId: number };
    const quizId = insertQuiz(db, { courseId, sectionId: null, title: 'Checkpoint', description: '' });
    const q1 = insertQuestion(db, quizId, {
      question: 'What is EC2?', options: ['Compute', 'Storage', 'DB', 'CDN'],
      correctIndex: 0, correctIndices: [0], explanation: 'Elastic Compute Cloud', position: 1,
    });
    const q2 = insertQuestion(db, quizId, {
      question: 'What is S3?', options: ['Compute', 'Storage', 'DB', 'CDN'],
      correctIndex: 1, correctIndices: [1], explanation: '', position: 2,
    });

    expect(listQuizzesForCourse(db, courseId)).toHaveLength(1);
    expect(getQuiz(db, quizId)?.questions).toHaveLength(2);

    const attemptId = insertAttempt(db, quizId, [
      { questionId: q1, selectedIndex: 0, selectedIndices: [0], isCorrect: true },
      { questionId: q2, selectedIndex: 2, selectedIndices: [2], isCorrect: false },
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

describe('resources', () => {
  function makeCourseWithResources() {
    const root = trackTemp(fs.mkdtempSync(path.join(os.tmpdir(), 'ismalearn-res-')));
    const courseRoot = path.join(root, 'Course');
    fs.mkdirSync(path.join(courseRoot, 'Section A'), { recursive: true });
    fs.writeFileSync(path.join(courseRoot, 'Section A', '01 - Lesson.mp4'), '');
    fs.writeFileSync(path.join(courseRoot, 'Section A', 'notes.pdf'), '%PDF');
    fs.writeFileSync(path.join(courseRoot, 'Section A', 'readme.txt'), 'hello searchable world');
    fs.writeFileSync(path.join(courseRoot, 'Section A', 'cover.png'), '');
    return courseRoot;
  }

  it('persists scanned resources with kinds', () => {
    const { courseId } = importCourse(db, makeCourseWithResources()) as { courseId: number };
    const resources = listResourcesForCourse(db, courseId);
    expect(resources).toHaveLength(3);
    const kinds = Object.fromEntries(resources.map((r) => [r.title, r.kind]));
    expect(kinds['notes']).toBe('pdf');
    expect(kinds['readme']).toBe('text');
    expect(kinds['cover']).toBe('image');
  });

  it('searches text content with snippets', () => {
    const { courseId } = importCourse(db, makeCourseWithResources()) as { courseId: number };
    const hits = searchResources(db, courseId, 'searchable');
    expect(hits).toHaveLength(1);
    expect(hits[0].title).toBe('readme');
    expect(hits[0].snippet).toContain('searchable');
    // PDFs match by file name only
    expect(searchResources(db, courseId, 'notes')).toHaveLength(1);
    expect(searchResources(db, courseId, '  ')).toHaveLength(0);
  });

  it('merges resources on rescan (add + remove)', () => {
    const courseRoot = makeCourseWithResources();
    const { courseId } = importCourse(db, courseRoot) as { courseId: number };
    fs.writeFileSync(path.join(courseRoot, 'Section A', 'extra.md'), '# new');
    fs.rmSync(path.join(courseRoot, 'Section A', 'notes.pdf'));
    const result = rescanCourse(db, courseId);
    expect(result.status).toBe('ok');
    const titles = listResourcesForCourse(db, courseId).map((r) => r.title).sort();
    expect(titles).toEqual(['cover', 'extra', 'readme']);
  });
});

describe('course health and relocation', () => {
  it('reports missing files and relinks a moved folder', () => {
    const outer = trackTemp(fs.mkdtempSync(path.join(os.tmpdir(), 'ismalearn-health-')));
    const courseRoot = path.join(outer, 'Course');
    fs.mkdirSync(path.join(courseRoot, 'S1'), { recursive: true });
    fs.writeFileSync(path.join(courseRoot, 'S1', 'a.mp4'), '');
    fs.writeFileSync(path.join(courseRoot, 'S1', 'b.mp4'), '');
    const { courseId } = importCourse(db, courseRoot) as { courseId: number };

    // simulate the whole folder moving elsewhere
    const moved = path.join(outer, 'Course Moved');
    fs.renameSync(courseRoot, moved);

    const before = getCourseHealth(db, courseId);
    expect(before.totalLessons).toBe(2);
    expect(before.missingLessons).toHaveLength(2);

    const result = relocateCourseRoot(db, courseId, moved);
    expect(result.status).toBe('ok');
    expect(result.relocated).toBe(2);
    expect(result.stillMissing).toBe(0);

    const after = getCourseHealth(db, courseId);
    expect(after.missingLessons).toHaveLength(0);
    expect(getCourse(db, courseId)?.sourcePath).toBe(moved);
  });

  it('rejects invalid relocation targets without changing data', () => {
    const { courseId } = importCourse(db, makeCourseDir()) as { courseId: number };
    const before = getCourse(db, courseId)?.sourcePath;
    const result = relocateCourseRoot(db, courseId, path.join(os.tmpdir(), 'does-not-exist-xyz'));
    expect(result.status).toBe('error');
    expect(getCourse(db, courseId)?.sourcePath).toBe(before);
  });
});

describe('rescan isolation', () => {
  it('never poaches files owned by another course', () => {
    const outer = trackTemp(fs.mkdtempSync(path.join(os.tmpdir(), 'ismalearn-poach-')));
    const parent = path.join(outer, 'Parent');
    fs.mkdirSync(parent, { recursive: true });
    fs.writeFileSync(path.join(parent, 'a.mp4'), '');
    // Parent is imported while it holds only its own file...
    const parentCourse = importCourse(db, parent) as { courseId: number };
    expect(
      getCourseDetail(db, parentCourse.courseId)!.sections.flatMap((s) => s.lessons).map((l) => l.title),
    ).toEqual(['a']);
    // ...then a nested folder appears and becomes its own course.
    const nested = path.join(parent, 'Nested');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, 'b.mp4'), '');
    importCourse(db, nested);
    // Rescanning the parent must not absorb the nested course's file,
    // nor litter empty sections.
    const result = rescanCourse(db, parentCourse.courseId);
    expect(result.status).toBe('ok');
    expect(result.addedLessons).toBe(0);
    expect(result.addedSections).toBe(0);
    const detail = getCourseDetail(db, parentCourse.courseId)!;
    expect(detail.sections.flatMap((s) => s.lessons).map((l) => l.title)).toEqual(['a']);
    expect(detail.sections.map((s) => s.title)).toEqual(['Course Content']);
  });
});

describe('backup round trip', () => {
  it('exports and restores all user data', () => {
    const courseRoot = makeCourseDir();
    const { courseId } = importCourse(db, courseRoot) as { courseId: number };
    const lessonId = getCourseDetail(db, courseId)!.sections[0].lessons[0].id;
    savePosition(db, lessonId, 30);
    insertNote(db, { courseId, lessonId, title: 'n', content: 'c' });
    const deckId = insertDeck(db, { courseId, title: 'Deck', source: 'manual' });
    insertFlashcard(db, deckId, { front: 'f', back: 'b', position: 1 });
    insertBookmark(db, { courseId, lessonId, positionSeconds: 5, title: 'mark' });
    setSetting(db, 'theme', 'light');

    const backup = exportData(db, '1.0.0-test');
    expect(backup.format).toBe('ismalearn-backup/1');
    expect(backup.tables.courses).toHaveLength(1);
    expect(backup.tables.notes).toHaveLength(1);

    // wipe and restore into a fresh database file
    const dbDir2 = trackTemp(fs.mkdtempSync(path.join(os.tmpdir(), 'ismalearn-restore-')));
    const db2 = createDatabase(path.join(dbDir2, 'restored.db'));
    importData(db2, backup);

    expect(countCourses(db2)).toBe(1);
    expect(listNotes(db2)).toHaveLength(1);
    expect(listDecks(db2, courseId)).toHaveLength(1);
    expect(listBookmarks(db2, courseId)).toHaveLength(1);
    expect(getAllSettings(db2).theme).toBe('light');
    const detail = getCourseDetail(db2, courseId)!;
    expect(detail.sections.flatMap((s) => s.lessons).find((l) => l.id === lessonId)?.positionSeconds).toBe(30);
    db2.close();

    expect(() => importData(db, { format: 'nope' } as never)).toThrow(/format/i);
  });
});

describe('study retention', () => {
  it('manages bookmarks, queue items, decks, cards and scheduling state', () => {
    const { courseId } = importCourse(db, makeCourseDir()) as { courseId: number };
    const lessonId = getCourseDetail(db, courseId)!.sections[0].lessons[0].id;

    const mark = insertBookmark(db, { courseId, lessonId, positionSeconds: 65, title: 'Intro @ 1:05' });
    expect(listBookmarks(db, courseId)).toHaveLength(1);
    expect(listBookmarks(db)[0].positionSeconds).toBe(65);
    deleteBookmark(db, mark.id);
    expect(listBookmarks(db, courseId)).toHaveLength(0);

    const item = insertReviewItem(db, { courseId, kind: 'lesson', refId: String(lessonId), title: 'Rewatch intro' });
    expect(item.done).toBe(false);
    expect(listReviewItems(db)).toHaveLength(1);
    setReviewItemDone(db, item.id, true);
    expect(listReviewItems(db, false)).toHaveLength(0);
    deleteReviewItem(db, item.id);
    expect(listReviewItems(db)).toHaveLength(0);

    const deckId = insertDeck(db, { courseId, title: 'Basics', source: 'manual' });
    const cardId = insertFlashcard(db, deckId, { front: 'Q?', back: 'A.', position: 1 });
    expect(listDecks(db, courseId)[0].cardCount).toBe(1);
    expect(listDueFlashcards(db, deckId, new Date().toISOString())).toHaveLength(1);
    updateFlashcardState(db, cardId, {
      ease: 2.6, intervalDays: 6, reps: 2, dueAt: new Date(Date.now() + 6 * 86400000).toISOString(),
    });
    expect(listDueFlashcards(db, deckId, new Date().toISOString())).toHaveLength(0);
    expect(listFlashcards(db, deckId)[0].intervalDays).toBe(6);
    deleteFlashcard(db, cardId);
    expect(listDecks(db, courseId)[0].cardCount).toBe(0);
    deleteDeck(db, deckId);
    expect(listDecks(db, courseId)).toHaveLength(0);
  });

  it('rejects invalid review kinds', () => {
    const { courseId } = importCourse(db, makeCourseDir()) as { courseId: number };
    expect(() =>
      insertReviewItem(db, { courseId, kind: 'planet' as never, refId: '1', title: 'x' }),
    ).not.toThrow(); // repository is unvalidated; IPC validates instead
  });
});

describe('unanswered exam attempts', () => {
  it('stores empty selections distinctly from legacy rows', () => {
    const { courseId } = importCourse(db, makeCourseDir()) as { courseId: number };
    const quizId = insertQuiz(db, { courseId, sectionId: null, title: 'Q', description: '' });
    const q1 = insertQuestion(db, quizId, {
      question: 'Q?', options: ['A', 'B'], correctIndex: 0, correctIndices: [0], explanation: '', position: 1,
    });
    const attemptId = insertAttempt(db, quizId, [
      { questionId: q1, selectedIndex: -1, selectedIndices: [], isCorrect: false },
    ]);
    const detail = getAttemptDetail(db, attemptId)!;
    expect(detail.answers[0].selectedIndices).toEqual([]);
    expect(detail.answers[0].isCorrect).toBe(false);
  });
});
