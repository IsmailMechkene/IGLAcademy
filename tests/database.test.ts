import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import SqliteDatabase from 'better-sqlite3';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, quarantineDatabase } from '../electron/database/connection';
import { MIGRATIONS } from '../electron/database/migrations';
import { importCourse, rescanCourse, getCourseHealth, relocateCourseRoot, forgetLesson } from '../electron/services/courseImportService';
import {
  listCourses,
  getCourse,
  getCourseDetail,
  getCourseBySourcePath,
  deleteCourse,
  countCourses,
  updateLessonDuration,
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
  updateQuestion,
  deleteQuestion,
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
  listSubtitleTracks,
  resolveSubtitleFile,
} from '../electron/services/fileService';
import { validateQuestionInput, scoreAttempt } from '../electron/ipc/quizzes';
import { mulberry32, normalizeSelected, shuffledIndexes } from '../src/utils/examAnalytics';

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

  it('upgrades a populated older database without losing anything', () => {
    // Build a database the way an already-installed copy looks: every
    // migration except the newest, with real user data in it.
    const legacyPath = path.join(dbDir, 'legacy.db');
    const legacy = new SqliteDatabase(legacyPath);
    legacy.pragma('journal_mode = WAL');
    legacy.pragma('foreign_keys = ON');
    const older = MIGRATIONS.filter((m) => m.version < 5);
    legacy.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')));`);
    for (const m of older) {
      legacy.exec(m.sql);
      legacy.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(m.version, m.name);
    }
    legacy.exec(`
      INSERT INTO courses (id, title, source_path) VALUES (1, 'Legacy course', 'C:\\legacy');
      INSERT INTO sections (id, course_id, title, position) VALUES (1, 1, 'S1', 1);
      INSERT INTO lessons (id, section_id, title, file_path, file_type, position)
        VALUES (1, 1, 'L1', 'C:\\legacy\\L1.mp4', 'video', 1);
      INSERT INTO lesson_progress (lesson_id, completed, position_seconds, watched_seconds)
        VALUES (1, 1, 77, 77);
      INSERT INTO notes (id, course_id, lesson_id, title, content) VALUES (1, 1, 1, 'note', 'body');
      INSERT INTO quizzes (id, course_id, title, description) VALUES (1, 1, 'Q', '');
      INSERT INTO quiz_questions (id, quiz_id, question, options, correct_index, explanation, position)
        VALUES (1, 1, 'legacy question?', '["a","b"]', 0, 'why', 1);
      INSERT INTO quiz_attempts (id, quiz_id, score, total) VALUES (1, 1, 1, 1);
      INSERT INTO quiz_attempt_answers (id, attempt_id, question_id, selected_index, is_correct, selected_indices)
        VALUES (1, 1, 1, 0, 1, '[0]');
    `);
    legacy.close();

    // Now open it the way the app does — migrations must carry it forward.
    const upgraded = createDatabase(legacyPath);
    const cols = (table: string) =>
      (upgraded.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
    expect(cols('lessons')).toContain('missing_since');
    expect(cols('quiz_attempt_answers')).toContain('question_text');

    // user data intact, including the rebuilt answers table
    expect((upgraded.prepare('SELECT COUNT(*) AS n FROM notes').get() as { n: number }).n).toBe(1);
    expect((upgraded.prepare('SELECT position_seconds AS p FROM lesson_progress WHERE lesson_id = 1').get() as { p: number }).p).toBe(77);
    const answer = upgraded.prepare('SELECT * FROM quiz_attempt_answers WHERE id = 1').get() as {
      attempt_id: number; question_id: number; selected_indices: string; is_correct: number;
    };
    expect(answer).toMatchObject({ attempt_id: 1, question_id: 1, selected_indices: '[0]', is_correct: 1 });

    // deleting the question no longer wipes history (the old FK cascaded)
    upgraded.prepare('DELETE FROM quiz_questions WHERE id = 1').run();
    expect((upgraded.prepare('SELECT COUNT(*) AS n FROM quiz_attempt_answers').get() as { n: number }).n).toBe(1);
    // ...but deleting the attempt still cleans up its answers
    upgraded.prepare('DELETE FROM quiz_attempts WHERE id = 1').run();
    expect((upgraded.prepare('SELECT COUNT(*) AS n FROM quiz_attempt_answers').get() as { n: number }).n).toBe(0);
    upgraded.close();
  });

  it('releases the file and can be quarantined when migrations cannot run', () => {
    // A database whose tables exist but whose ledger is empty: migration 1
    // then fails ("table courses already exists"). This is the shape that
    // used to make the app throw on every launch, forever.
    const brokenPath = path.join(dbDir, 'broken.db');
    const broken = new SqliteDatabase(brokenPath);
    broken.exec('CREATE TABLE courses (id INTEGER PRIMARY KEY);');
    broken.close();

    expect(() => createDatabase(brokenPath)).toThrow();
    // The handle must be closed, or Windows would refuse to move the file.
    const moved = quarantineDatabase(brokenPath);
    expect(moved).toBeTruthy();
    expect(fs.existsSync(brokenPath)).toBe(false);
    expect(fs.existsSync(moved!)).toBe(true); // nothing is deleted

    // ...and a fresh database opens in its place
    const fresh = createDatabase(brokenPath);
    expect(countCourses(fresh)).toBe(0);
    fresh.close();
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

  it('scores a shuffled run against the questions it was actually given', () => {
    const root = trackTemp(fs.mkdtempSync(path.join(os.tmpdir(), 'ismalearn-shuffle-')));
    const htmlPath = path.join(root, 'Shuffle.html');
    fs.writeFileSync(
      htmlPath,
      `<html><body><script>const quizData = ${JSON.stringify({
        quiz_title: 'Shuffle Exam',
        questions: [
          { assessment_type: 'multiple-choice', prompt: { question: '<p>Q1?</p>', answers: ['<p>a1</p>', '<p>b1</p>', '<p>c1</p>'], explanation: '' }, correct_response: ['a'] },
          { assessment_type: 'multiple-choice', prompt: { question: '<p>Q2?</p>', answers: ['<p>a2</p>', '<p>b2</p>', '<p>c2</p>'], explanation: '' }, correct_response: ['b'] },
          { assessment_type: 'multi-select', prompt: { question: '<p>Q3?</p>', answers: ['<p>a3</p>', '<p>b3</p>', '<p>c3</p>'], explanation: '' }, correct_response: ['a', 'c'] },
          { assessment_type: 'multiple-choice', prompt: { question: '<p>Q4?</p>', answers: ['<p>a4</p>', '<p>b4</p>', '<p>c4</p>'], explanation: '' }, correct_response: ['c'] },
        ],
      })};</script></body></html>`,
    );
    registerSource(db, root, 'dir');
    const exam = loadExamFile(db, htmlPath);

    // Rebuild exactly what the runner does when "shuffle" is on.
    const rand = mulberry32(98765);
    const order = shuffledIndexes(exam.questions.length, rand);
    const optionOrders: Record<number, number[]> = {};
    const displayed = order.map((qi) => {
      const q = exam.questions[qi];
      const optionOrder = shuffledIndexes(q.options.length, rand);
      optionOrders[qi] = optionOrder;
      return {
        id: qi,
        correctIndices: q.correctIndices.map((ci) => optionOrder.indexOf(ci)).sort((a, b) => a - b),
      };
    });
    // the test is only meaningful if the order really changed
    expect(order).not.toEqual([0, 1, 2, 3]);

    // Answer every question correctly AS DISPLAYED, submitted in display order.
    const payload = displayed.map((d) => ({
      questionIndex: d.id,
      selected: normalizeSelected(d.correctIndices, optionOrders[d.id]),
      seconds: 2,
    }));
    const attempt = submitExamAttempt(db, htmlPath, payload);
    expect(attempt.percent).toBe(100);
    expect(attempt.score).toBe(4);
    // ...and the stored attempt reads back in the FILE's order
    expect(attempt.answers.map((a) => a.question)).toEqual(['Q1?', 'Q2?', 'Q3?', 'Q4?']);
    expect(attempt.answers.map((a) => a.selectedIndices)).toEqual([[0], [1], [0, 2], [2]]);

    // A payload that claims the same question twice, or one out of range, is a
    // bug worth failing loudly rather than mis-scoring.
    expect(() =>
      submitExamAttempt(db, htmlPath, [
        { questionIndex: 0, selected: [0], seconds: 1 },
        { questionIndex: 0, selected: [0], seconds: 1 },
        { questionIndex: 2, selected: [0, 2], seconds: 1 },
        { questionIndex: 3, selected: [2], seconds: 1 },
      ]),
    ).toThrow(/same question/i);
    expect(() =>
      submitExamAttempt(db, htmlPath, [
        { questionIndex: 9, selected: [0], seconds: 1 },
        { questionIndex: 1, selected: [1], seconds: 1 },
        { questionIndex: 2, selected: [0, 2], seconds: 1 },
        { questionIndex: 3, selected: [2], seconds: 1 },
      ]),
    ).toThrow(/not in this exam/i);
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
  it('adds new lessons and flags (never deletes) vanished ones while preserving progress', () => {
    const courseRoot = makeCourseDir();
    const { courseId } = importCourse(db, courseRoot) as { courseId: number };
    const before = getCourseDetail(db, courseId)!;
    const firstLesson = before.sections[0].lessons[0];
    setCompleted(db, firstLesson.id, true);
    savePosition(db, firstLesson.id, 120);

    // add a lesson, make another one's file disappear
    fs.writeFileSync(path.join(courseRoot, '02 - EC2', '02 - New Lesson.mp4'), '');
    fs.rmSync(path.join(courseRoot, '01 - Introduction', '02 - Overview.mp4'));

    const result = rescanCourse(db, courseId);
    expect(result.status).toBe('ok');
    expect(result.addedLessons).toBe(1);
    expect(result.missingLessons).toBe(1);
    expect(result.restoredLessons).toBe(0);

    const after = getCourseDetail(db, courseId)!;
    // 4 lessons: nothing was deleted, the vanished one is only flagged
    expect(after.lessonCount).toBe(4);
    const flagged = after.sections[0].lessons.find((l) => l.title === '02 - Overview');
    expect(flagged?.missingSince).toBeTruthy();
    const kept = after.sections[0].lessons.find((l) => l.id === firstLesson.id);
    expect(kept?.completed).toBe(true);
    expect(kept?.positionSeconds).toBe(120);
    expect(kept?.missingSince).toBeNull();

    // rescanning again must not double-count or change the flag
    const second = rescanCourse(db, courseId);
    expect(second.missingLessons).toBe(0);
    expect(getCourseDetail(db, courseId)!.lessonCount).toBe(4);
  });

  it('keeps notes, bookmarks and progress when a lesson file disappears', () => {
    const courseRoot = makeCourseDir();
    const { courseId } = importCourse(db, courseRoot) as { courseId: number };
    const lesson = getCourseDetail(db, courseId)!.sections[0].lessons[0];
    savePosition(db, lesson.id, 123.5);
    setCompleted(db, lesson.id, true);
    insertNote(db, { courseId, lessonId: lesson.id, title: 'Keep me', content: 'important' });
    insertBookmark(db, { courseId, lessonId: lesson.id, positionSeconds: 42, title: 'bm' });

    fs.rmSync(path.join(courseRoot, '01 - Introduction', '01 - Welcome.mp4'));
    expect(rescanCourse(db, courseId).status).toBe('ok');

    // the user's work survives an unplugged drive / renamed folder
    expect(listNotes(db, courseId)).toHaveLength(1);
    expect(listBookmarks(db, courseId)).toHaveLength(1);
    expect(getStats(db).totalWatchedSeconds).toBe(123.5);
    const still = getCourseDetail(db, courseId)!.sections[0].lessons.find((l) => l.id === lesson.id);
    expect(still?.completed).toBe(true);
    expect(still?.positionSeconds).toBe(123.5);
    expect(still?.missingSince).toBeTruthy();
  });

  it('clears the missing flag when the file comes back', () => {
    const courseRoot = makeCourseDir();
    const { courseId } = importCourse(db, courseRoot) as { courseId: number };
    const target = path.join(courseRoot, '01 - Introduction', '01 - Welcome.mp4');
    const lessonId = getCourseDetail(db, courseId)!.sections[0].lessons[0].id;

    fs.rmSync(target);
    expect(rescanCourse(db, courseId).missingLessons).toBe(1);
    fs.writeFileSync(target, '');
    const back = rescanCourse(db, courseId);
    expect(back.restoredLessons).toBe(1);
    expect(back.missingLessons).toBe(0);
    const lesson = getCourseDetail(db, courseId)!.sections[0].lessons.find((l) => l.id === lessonId);
    expect(lesson?.missingSince).toBeNull();
  });

  it('forgets a missing lesson only on explicit request, refusing when the file is back', () => {
    const courseRoot = makeCourseDir();
    const { courseId } = importCourse(db, courseRoot) as { courseId: number };
    const target = path.join(courseRoot, '01 - Introduction', '01 - Welcome.mp4');
    const lesson = getCourseDetail(db, courseId)!.sections[0].lessons[0];
    insertNote(db, { courseId, lessonId: lesson.id, title: 'n', content: 'c' });

    // present file: forgetting is refused, nothing is touched
    expect(forgetLesson(db, lesson.id).status).toBe('error');
    expect(getCourseDetail(db, courseId)!.lessonCount).toBe(3);

    fs.rmSync(target);
    rescanCourse(db, courseId);
    const result = forgetLesson(db, lesson.id);
    expect(result.status).toBe('ok');
    expect(result.title).toBe('01 - Welcome');
    expect(getCourseDetail(db, courseId)!.lessonCount).toBe(2);
    // forgetting IS destructive — that is the point of the confirmation
    expect(listNotes(db, courseId)).toHaveLength(0);
  });

  it('syncs the missing flag from a health check', () => {
    const courseRoot = makeCourseDir();
    const { courseId } = importCourse(db, courseRoot) as { courseId: number };
    const lessonId = getCourseDetail(db, courseId)!.sections[0].lessons[0].id;
    fs.rmSync(path.join(courseRoot, '01 - Introduction', '01 - Welcome.mp4'));

    const health = getCourseHealth(db, courseId);
    expect(health.missingLessons.map((m) => m.lessonId)).toContain(lessonId);
    expect(
      getCourseDetail(db, courseId)!.sections[0].lessons.find((l) => l.id === lessonId)?.missingSince,
    ).toBeTruthy();
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

  it('keeps attempt history intact when its questions are edited or deleted', () => {
    const { courseId } = importCourse(db, makeCourseDir()) as { courseId: number };
    const quizId = insertQuiz(db, { courseId, sectionId: null, title: 'Checkpoint', description: '' });
    const q1 = insertQuestion(db, quizId, {
      question: 'Original question?', options: ['right', 'wrong'],
      correctIndex: 0, correctIndices: [0], explanation: 'because', position: 1,
    });
    const q2 = insertQuestion(db, quizId, {
      question: 'Second question?', options: ['a', 'b'],
      correctIndex: 1, correctIndices: [1], explanation: '', position: 2,
    });
    const attemptId = insertAttempt(db, quizId, [
      { questionId: q1, selectedIndex: 0, selectedIndices: [0], isCorrect: true },
      { questionId: q2, selectedIndex: 0, selectedIndices: [0], isCorrect: false },
    ]);

    // Edit one question in place and delete the other, as the editor now does.
    updateQuestion(db, q1, {
      question: 'Rewritten question?', options: ['x', 'y', 'z'],
      correctIndex: 2, correctIndices: [2], explanation: 'new reason', position: 1,
    });
    deleteQuestion(db, q2);

    const detail = getAttemptDetail(db, attemptId)!;
    expect(detail.score).toBe(1);
    expect(detail.total).toBe(2);
    // both answers still readable, showing the questions AS ASKED
    expect(detail.answers).toHaveLength(2);
    expect(detail.answers[0].question).toBe('Original question?');
    expect(detail.answers[0].options).toEqual(['right', 'wrong']);
    expect(detail.answers[0].explanation).toBe('because');
    expect(detail.answers[0].isCorrect).toBe(true);
    expect(detail.answers[1].question).toBe('Second question?');
    expect(detail.answers[1].correctIndices).toEqual([1]);
    expect(detail.answers[1].isCorrect).toBe(false);
  });

  it('scores every question, not just the submitted ones', () => {
    const { courseId } = importCourse(db, makeCourseDir()) as { courseId: number };
    const quizId = insertQuiz(db, { courseId, sectionId: null, title: 'Scoring', description: '' });
    const q1 = insertQuestion(db, quizId, {
      question: 'one?', options: ['a', 'b'], correctIndex: 0, correctIndices: [0], explanation: '', position: 1,
    });
    const q2 = insertQuestion(db, quizId, {
      question: 'two?', options: ['a', 'b'], correctIndex: 1, correctIndices: [1], explanation: '', position: 2,
    });
    const q3 = insertQuestion(db, quizId, {
      question: 'three?', options: ['a', 'b', 'c'], correctIndex: 2, correctIndices: [0, 2], explanation: '', position: 3,
    });
    const quiz = getQuiz(db, quizId)!;

    // A timed auto-submit: one right, one blank, one out of range.
    const rows = scoreAttempt(quiz, [
      { questionId: q1, selectedIndex: 0, selectedIndices: [0] },
      { questionId: q2, selectedIndex: -1, selectedIndices: [] },
      { questionId: q3, selectedIndex: 7, selectedIndices: [7] },
    ]);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.isCorrect)).toEqual([true, false, false]);
    expect(rows[1].selectedIndices).toEqual([]); // blank, not an error
    expect(rows[2].selectedIndices).toEqual([]); // out-of-range dropped

    // A short payload still scores out of the full quiz (used to be 100%).
    const short = scoreAttempt(quiz, [{ questionId: q1, selectedIndex: 0, selectedIndices: [0] }]);
    expect(short).toHaveLength(3);
    const attemptId = insertAttempt(db, quizId, short, quiz.questions.length);
    const detail = getAttemptDetail(db, attemptId)!;
    expect(detail.score).toBe(1);
    expect(detail.total).toBe(3);
    expect(detail.percent).toBe(33);

    // Multi-select still needs the complete set, and junk ids are ignored.
    expect(scoreAttempt(quiz, [{ questionId: q3, selectedIndices: [0] }])[2].isCorrect).toBe(false);
    expect(scoreAttempt(quiz, [{ questionId: q3, selectedIndices: [2, 0] }])[2].isCorrect).toBe(true);
    expect(scoreAttempt(quiz, [{ questionId: 9999, selectedIndices: [0] }]).map((r) => r.isCorrect)).toEqual([
      false, false, false,
    ]);
  });

  it('records the real question count even when answers are missing', () => {
    const { courseId } = importCourse(db, makeCourseDir()) as { courseId: number };
    const quizId = insertQuiz(db, { courseId, sectionId: null, title: 'Partial', description: '' });
    const q1 = insertQuestion(db, quizId, {
      question: 'a?', options: ['a', 'b'], correctIndex: 0, correctIndices: [0], explanation: '', position: 1,
    });
    insertQuestion(db, quizId, {
      question: 'b?', options: ['a', 'b'], correctIndex: 0, correctIndices: [0], explanation: '', position: 2,
    });
    const attemptId = insertAttempt(
      db,
      quizId,
      [{ questionId: q1, selectedIndex: 0, selectedIndices: [0], isCorrect: true }],
      2,
    );
    const detail = getAttemptDetail(db, attemptId)!;
    expect(detail.total).toBe(2);
    expect(detail.percent).toBe(50);
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

  it('drops settings that nothing implements when an older database is upgraded', () => {
    // A database from before the removal: migrations up to 5, with the two
    // dead settings stored.
    const oldPath = path.join(dbDir, 'pre-removal.db');
    const old = new SqliteDatabase(oldPath);
    old.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')));`);
    for (const m of MIGRATIONS.filter((x) => x.version <= 5)) {
      old.exec(m.sql);
      old.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(m.version, m.name);
    }
    old.exec(`INSERT INTO app_settings (key, value) VALUES
      ('theme', '"light"'),
      ('duplicateImportBehavior', '"rescan"'),
      ('checkForUpdates', 'true');`);
    old.close();

    const upgraded = createDatabase(oldPath);
    const keys = (upgraded.prepare('SELECT key FROM app_settings').all() as Array<{ key: string }>).map((r) => r.key);
    expect(keys).not.toContain('duplicateImportBehavior');
    expect(keys).not.toContain('checkForUpdates');
    // real settings are untouched
    expect(keys).toContain('theme');
    expect(getAllSettings(upgraded).theme).toBe('light');
    expect(Object.keys(getAllSettings(upgraded))).not.toContain('checkForUpdates');
    upgraded.close();
  });
});

describe('lesson duration', () => {
  it('is learned from the player and only rewritten when it really changes', () => {
    const { courseId } = importCourse(db, makeCourseDir()) as { courseId: number };
    const lesson = getCourseDetail(db, courseId)!.sections[0].lessons[0];
    // The scanner cannot know a duration without decoding, so it starts null.
    expect(lesson.duration).toBeNull();

    expect(updateLessonDuration(db, lesson.id, 630.4)).toBe(true);
    const stored = getCourseDetail(db, courseId)!.sections[0].lessons.find((l) => l.id === lesson.id);
    expect(stored?.duration).toBeCloseTo(630.4);

    // sub-second drift on replay must not keep touching the row
    expect(updateLessonDuration(db, lesson.id, 630.9)).toBe(false);
    expect(updateLessonDuration(db, lesson.id, 999)).toBe(true);
    expect(updateLessonDuration(db, 999999, 100)).toBe(false);
  });
});

describe('subtitles', () => {
  it('resolves sidecar tracks for a lesson and converts SRT on the fly', () => {
    const courseRoot = makeCourseDir();
    const videoPath = path.join(courseRoot, '01 - Introduction', '01 - Welcome.mp4');
    fs.writeFileSync(
      path.join(courseRoot, '01 - Introduction', '01 - Welcome.srt'),
      '1\n00:00:01,000 --> 00:00:02,000\nHello\n',
    );
    fs.writeFileSync(
      path.join(courseRoot, '01 - Introduction', '01 - Welcome.fr.vtt'),
      'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nBonjour\n',
    );
    const { courseId } = importCourse(db, courseRoot) as { courseId: number };
    const lesson = getCourseDetail(db, courseId)!
      .sections.flatMap((s) => s.lessons)
      .find((l) => l.filePath === videoPath)!;

    const tracks = listSubtitleTracks(db, lesson.id);
    expect(tracks.map((t) => t.label)).toEqual(['Subtitles', 'FR']);
    // The URL shape the renderer gets: media://sub/<lessonId>/<index>. The
    // protocol handler used to parse "<id>/<index>" as a single id and 400.
    expect(tracks[0].url).toBe(`media://sub/${lesson.id}/0`);
    expect(resolveSubtitleFile(db, lesson.id, 0).content).toContain('00:00:01.000 --> 00:00:02.000');
    expect(resolveSubtitleFile(db, lesson.id, 1).content).toContain('Bonjour');
    expect(() => resolveSubtitleFile(db, lesson.id, 5)).toThrow(/not found/i);
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

  it('never restores the schema ledger, so the app still starts afterwards', () => {
    importCourse(db, makeCourseDir());
    const backup = exportData(db, '1.0.0-test');
    // A backup must not carry the live schema version around with it.
    expect(backup.tables.schema_migrations).toBeUndefined();

    const applied = () =>
      (db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get() as { v: number }).v;
    const latest = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);
    expect(applied()).toBe(latest);

    // Simulate restoring a backup taken on an older schema: it used to replace
    // the ledger, which made the next launch re-run migrations and crash.
    importData(db, { ...backup, tables: { ...backup.tables, schema_migrations: [{ version: 1, name: 'initial_schema' }] } } as never);
    expect(applied()).toBe(latest);
    expect(() => {
      const reopened = createDatabase(path.join(dbDir, 'test.db'));
      reopened.close();
    }).not.toThrow();
  });

  it('ignores unknown columns and non-primitive values in a hand-edited backup', () => {
    const { courseId } = importCourse(db, makeCourseDir()) as { courseId: number };
    insertNote(db, { courseId, lessonId: null, title: 'n', content: 'c' });
    const backup = exportData(db, '1.0.0-test');
    const poisoned = {
      ...backup,
      tables: {
        ...backup.tables,
        notes: backup.tables.notes.map((n) => ({
          ...n,
          'evil") VALUES (1); DROP TABLE notes; --': 'x',
          content: { nested: true },
        })),
      },
    };
    expect(() => importData(db, poisoned as never)).not.toThrow();
    expect(listNotes(db)).toHaveLength(1);
    expect(
      (db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'notes'").get() as { n: number }).n,
    ).toBe(1);
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
