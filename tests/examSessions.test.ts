import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../electron/database/connection';
import {
  registerSource,
  unregisterSource,
  loadExamFile,
  submitExamAttempt,
  getExamSession,
  saveExamSession,
  clearExamSession,
} from '../electron/services/practiceLibraryService';
import { listSources } from '../electron/database/repositories/practice';
import { ValidationError } from '../electron/services/validate';

const tmpRoots: string[] = [];
let db: Database.Database;

function tmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

function writeExam(dir: string): string {
  const file = path.join(dir, 'Exam.html');
  fs.writeFileSync(
    file,
    `<html><body><script>const quizData = ${JSON.stringify({
      quiz_title: 'Exam',
      questions: [
        { assessment_type: 'multiple-choice', prompt: { question: '<p>Q1?</p>', answers: ['<p>A</p>', '<p>B</p>'], explanation: '' }, correct_response: ['a'] },
        { assessment_type: 'multiple-choice', prompt: { question: '<p>Q2?</p>', answers: ['<p>A</p>', '<p>B</p>'], explanation: '' }, correct_response: ['b'] },
      ],
    })};</script></body></html>`,
  );
  return file;
}

beforeEach(() => {
  db = createDatabase(path.join(tmp('ismalearn-db-'), 'test.db'));
});

afterEach(() => {
  db.close();
  for (const dir of tmpRoots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('exam sessions (resume after closing the app)', () => {
  it('saves, reads back and clears an in-progress run', () => {
    const root = tmp('ismalearn-sess-');
    const file = writeExam(root);
    registerSource(db, root, 'dir');
    expect(getExamSession(db, file)).toBeNull();

    const state = { mode: 'exam', current: 1, answers: [[0, [0]]], deadlineAt: Date.now() + 60_000 };
    saveExamSession(db, file, state);
    expect(getExamSession(db, file)).toEqual(state);

    saveExamSession(db, file, { ...state, current: 0 });
    expect((getExamSession(db, file) as { current: number }).current).toBe(0);

    clearExamSession(db, file);
    expect(getExamSession(db, file)).toBeNull();
  });

  it('is cleared when the exam is submitted', () => {
    const root = tmp('ismalearn-sess-');
    const file = writeExam(root);
    registerSource(db, root, 'dir');
    saveExamSession(db, file, { mode: 'exam', current: 1 });
    submitExamAttempt(db, file, [[0], [1]], [], loadExamFile(db, file).contentHash);
    expect(getExamSession(db, file)).toBeNull();
  });

  it('is dropped with its source, and refused for unregistered files', () => {
    const root = tmp('ismalearn-sess-');
    const file = writeExam(root);
    registerSource(db, root, 'dir');
    saveExamSession(db, file, { mode: 'practice' });
    unregisterSource(db, listSources(db)[0].id);
    expect((db.prepare('SELECT COUNT(*) AS n FROM exam_sessions').get() as { n: number }).n).toBe(0);
    expect(() => saveExamSession(db, file, { mode: 'practice' })).toThrow(/registered/i);
  });

  it('rejects non-object and oversized state', () => {
    const root = tmp('ismalearn-sess-');
    const file = writeExam(root);
    registerSource(db, root, 'dir');
    expect(() => saveExamSession(db, file, 'nope')).toThrow(ValidationError);
    expect(() => saveExamSession(db, file, [1, 2])).toThrow(ValidationError);
    expect(() => saveExamSession(db, file, { blob: 'x'.repeat(600 * 1024) })).toThrow(/too large/);
  });
});
