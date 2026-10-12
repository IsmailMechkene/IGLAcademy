import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../electron/database/connection';
import { importCourse } from '../electron/services/courseImportService';
import { getQuiz, insertQuestion, insertQuiz } from '../electron/database/repositories/quizzes';
import { listDecks, listFlashcards } from '../electron/database/repositories/study';
import { setSetting } from '../electron/database/repositories/settings';
import { listSources } from '../electron/database/repositories/practice';
import {
  clearQuizSession,
  getQuizSession,
  saveQuizSession,
  submitQuizAttempt,
} from '../electron/services/quizService';
import { registerSource, unregisterSource } from '../electron/services/practiceLibraryService';
import { parseSession } from '../src/utils/examSession';

const tmpRoots: string[] = [];
let db: Database.Database;
let courseId: number;

function tmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

beforeEach(() => {
  db = createDatabase(path.join(tmp('ismalearn-db-'), 'test.db'));
  const root = path.join(tmp('ismalearn-course-'), 'Course');
  fs.mkdirSync(path.join(root, 'A'), { recursive: true });
  fs.writeFileSync(path.join(root, 'A', '01 - Intro.mp4'), '');
  courseId = (importCourse(db, root) as { courseId: number }).courseId;
});

afterEach(() => {
  db.close();
  for (const dir of tmpRoots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function makeQuiz(): number {
  const quizId = insertQuiz(db, { courseId, sectionId: null, title: 'IAM basics', description: '' });
  insertQuestion(db, quizId, {
    question: 'Who should use the root account?', options: ['Nobody day to day', 'Every admin'],
    correctIndex: 0, correctIndices: [0], explanation: 'Lock it away; use IAM users.', position: 1,
  });
  insertQuestion(db, quizId, {
    question: 'Pick two identity types.', options: ['Users', 'Buckets', 'Roles'],
    correctIndex: 0, correctIndices: [0, 2], explanation: '', position: 2,
  });
  return quizId;
}

const answersFor = (quizId: number, picks: number[][]) =>
  getQuiz(db, quizId)!.questions.map((q, i) => ({ questionId: q.id, selectedIndices: picks[i] }));

describe('course quiz mistakes', () => {
  it('adds wrong answers to a mistakes deck that belongs to the course', () => {
    const quizId = makeQuiz();
    const result = submitQuizAttempt(db, quizId, answersFor(quizId, [[1], [0, 2]]));
    expect(result.attemptId).toBeGreaterThan(0);
    expect(result.mistakesAdded).toBe(1);

    const deck = listDecks(db).find((d) => d.id === result.mistakesDeckId)!;
    expect(deck).toMatchObject({ courseId, title: 'Mistakes · IAM basics', cardCount: 1 });
    const card = listFlashcards(db, deck.id)[0];
    expect(card.front).toBe('Who should use the root account?\nA. Nobody day to day\nB. Every admin');
    expect(card.back).toBe('Correct answer:\n**A. Nobody day to day**\nLock it away; use IAM users.');

    // a retake with the same mistake adds nothing new
    expect(submitQuizAttempt(db, quizId, answersFor(quizId, [[1], [0, 2]])).mistakesAdded).toBe(0);
  });

  it('respects the setting', () => {
    const quizId = makeQuiz();
    setSetting(db, 'examMistakesToFlashcards', false);
    const result = submitQuizAttempt(db, quizId, answersFor(quizId, [[1], [1]]));
    expect(result.mistakesAdded).toBeUndefined();
    expect(listDecks(db)).toHaveLength(0);
  });
});

describe('course quiz sessions', () => {
  it('saves, reads back, and clears on submit', () => {
    const quizId = makeQuiz();
    expect(getQuizSession(db, quizId)).toBeNull();
    saveQuizSession(db, quizId, { current: 1 });
    expect(getQuizSession(db, quizId)).toEqual({ current: 1 });
    submitQuizAttempt(db, quizId, answersFor(quizId, [[0], [0, 2]]));
    expect(getQuizSession(db, quizId)).toBeNull();
  });

  it('is not pruned when a practice-exam source is removed', () => {
    const quizId = makeQuiz();
    saveQuizSession(db, quizId, { current: 0 });
    const examDir = tmp('ismalearn-exams-');
    registerSource(db, examDir, 'dir');
    unregisterSource(db, listSources(db)[0].id);
    expect(getQuizSession(db, quizId)).toEqual({ current: 0 });
    clearQuizSession(db, quizId);
    expect(getQuizSession(db, quizId)).toBeNull();
  });

  it('refuses sessions for quizzes that do not exist', () => {
    expect(() => saveQuizSession(db, 999, { current: 0 })).toThrow(/Quiz not found/);
  });

  it('validates saved runs against the quiz question ids', () => {
    const quizId = makeQuiz();
    const ids = getQuiz(db, quizId)!.questions.map((q) => q.id);
    const session = {
      version: 1, mode: 'practice', seed: null, deadlineAt: null, contentHash: 'v1',
      startedAt: 1, savedAt: 2, current: 1, answers: [[ids[1], [0, 2]]], flagged: [], revealed: [], timings: [],
    };
    expect(parseSession(session, 'v1', 2, new Set(ids))).not.toBeNull();
    // database ids are not 0..count-1, so the index rule alone would reject them
    expect(parseSession(session, 'v1', 2)).toBeNull();
    expect(parseSession({ ...session, answers: [[ids[1] + 100, [0]]] }, 'v1', 2, new Set(ids))).toBeNull();
  });
});
