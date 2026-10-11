import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../electron/database/connection';
import { getAllSettings, setSetting } from '../electron/database/repositories/settings';
import { validateSetting } from '../electron/services/settingsSchema';
import { ValidationError } from '../electron/services/validate';
import {
  registerSource,
  loadExamFile,
  submitExamAttempt,
  getExamAttemptDetail,
  unregisterSource,
} from '../electron/services/practiceLibraryService';
import { listSources } from '../electron/database/repositories/practice';
import { DEFAULT_SETTINGS } from '../src/types';

const tmpRoots: string[] = [];
let db: Database.Database;

function tmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

beforeEach(() => {
  db = createDatabase(path.join(tmp('ismalearn-db-'), 'test.db'));
});

afterEach(() => {
  db.close();
  for (const dir of tmpRoots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('settings whitelist (M6)', () => {
  it('rejects unknown keys and illegal values', () => {
    expect(() => validateSetting('totallyMadeUpKey', { a: 1 })).toThrow(ValidationError);
    expect(() => validateSetting('__proto__', 1)).toThrow(ValidationError);
    expect(() => validateSetting('theme', 'neon')).toThrow(ValidationError);
    expect(() => validateSetting('defaultPlaybackSpeed', 3)).toThrow(ValidationError);
    expect(() => validateSetting('autoBackup', 'yes')).toThrow(ValidationError);
    expect(() => validateSetting('backupKeep', 0)).toThrow(ValidationError);
    expect(() => validateSetting('examPassPercent', 70.5)).toThrow(ValidationError);
  });

  it('accepts every default value', () => {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      expect(() => validateSetting(key, value)).not.toThrow();
    }
  });

  it('never returns stored rows that are unknown or invalid', () => {
    // Rows written by an older build, a restored backup or a hand edit.
    setSetting(db, 'totallyMadeUpKey', { a: 1 });
    setSetting(db, 'backupKeep', 9999);
    setSetting(db, 'theme', 'light');
    const all = getAllSettings(db) as unknown as Record<string, unknown>;
    expect(all).not.toHaveProperty('totallyMadeUpKey');
    expect(all.backupKeep).toBe(DEFAULT_SETTINGS.backupKeep);
    expect(all.theme).toBe('light');
  });
});

function examHtml(questions: Array<{ q: string; answers: string[]; correct: string[]; topic?: string }>): string {
  return `<html><body><script>const quizData = ${JSON.stringify({
    quiz_title: 'Exam',
    questions: questions.map((x) => ({
      assessment_type: x.correct.length > 1 ? 'multi-select' : 'multiple-choice',
      prompt: { question: `<p>${x.q}</p>`, answers: x.answers.map((a) => `<p>${a}</p>`), explanation: '' },
      correct_response: x.correct,
      section: x.topic ?? '',
    })),
  })};</script></body></html>`;
}

const V1 = [
  { q: 'Q1?', answers: ['A', 'B'], correct: ['a'] },
  { q: 'Q2?', answers: ['A', 'B'], correct: ['b'] },
];
const V2 = [
  { q: 'Rewritten Q1?', answers: ['X', 'Y', 'Z'], correct: ['c'] },
  { q: 'Q2?', answers: ['A', 'B'], correct: ['b'] },
  { q: 'Brand new Q3?', answers: ['A', 'B'], correct: ['a'] },
];

describe('exam files that change (M11)', () => {
  it('keeps old attempts reviewable after the file is edited', () => {
    const root = tmp('ismalearn-m11-');
    const file = path.join(root, 'Exam.html');
    fs.writeFileSync(file, examHtml(V1));
    registerSource(db, root, 'dir');

    const first = submitExamAttempt(db, file, [[0], [1]], [], loadExamFile(db, file).contentHash);
    expect(first.percent).toBe(100);

    fs.writeFileSync(file, examHtml(V2));
    const review = getExamAttemptDetail(db, first.id)!;
    // Used to be null ("Review" did nothing) once the question count changed.
    expect(review.unavailableReason).toBeUndefined();
    expect(review.answers.map((a) => a.question)).toEqual(['Q1?', 'Q2?']);
    expect(review.answers.every((a) => a.isCorrect)).toBe(true);
  });

  it('scores a run against the version that was answered when the file changes mid-exam', () => {
    const root = tmp('ismalearn-m11-');
    const file = path.join(root, 'Exam.html');
    fs.writeFileSync(file, examHtml(V1));
    registerSource(db, root, 'dir');
    const served = loadExamFile(db, file);

    fs.writeFileSync(file, examHtml(V2)); // re-downloaded while the user is answering
    const result = submitExamAttempt(db, file, [[0], [1]], [], served.contentHash);
    // Used to throw "Answer count does not match the exam" and lose the attempt.
    expect(result).toMatchObject({ score: 2, total: 2, percent: 100 });
    expect(getExamAttemptDetail(db, result.id)!.answers[0].question).toBe('Q1?');
  });

  it('refuses clearly when the answered version is unknown, instead of mis-scoring', () => {
    const root = tmp('ismalearn-m11-');
    const file = path.join(root, 'Exam.html');
    fs.writeFileSync(file, examHtml(V1));
    registerSource(db, root, 'dir');
    expect(() => submitExamAttempt(db, file, [[0], [1]], [], 'f'.repeat(64))).toThrow(/changed on disk/);
  });

  it('explains, rather than hides, a legacy attempt whose file changed', () => {
    const root = tmp('ismalearn-m11-');
    const file = path.join(root, 'Exam.html');
    fs.writeFileSync(file, examHtml(V1));
    registerSource(db, root, 'dir');
    const attempt = submitExamAttempt(db, file, [[0], [0]]);
    // Make it look like a pre-snapshot row.
    db.prepare('UPDATE practice_attempts SET content_hash = NULL WHERE id = ?').run(attempt.id);
    db.prepare('DELETE FROM practice_exam_snapshots').run();

    // Unchanged file: legacy fallback still works.
    expect(getExamAttemptDetail(db, attempt.id)!.answers).toHaveLength(2);

    fs.writeFileSync(file, examHtml(V2));
    const detail = getExamAttemptDetail(db, attempt.id)!;
    expect(detail.answers).toEqual([]);
    expect(detail.unavailableReason).toMatch(/changed/);
    expect(detail.percent).toBe(50); // the score is still real

    fs.rmSync(file);
    expect(getExamAttemptDetail(db, attempt.id)!.unavailableReason).toMatch(/can no longer be read/);
  });

  it('stores one snapshot per exam version and drops it with the source', () => {
    const root = tmp('ismalearn-m11-');
    const file = path.join(root, 'Exam.html');
    fs.writeFileSync(file, examHtml(V1));
    registerSource(db, root, 'dir');
    const hash = loadExamFile(db, file).contentHash;
    submitExamAttempt(db, file, [[0], [1]], [], hash);
    submitExamAttempt(db, file, [[1], [1]], [], hash);
    const count = () => (db.prepare('SELECT COUNT(*) AS n FROM practice_exam_snapshots').get() as { n: number }).n;
    expect(count()).toBe(1);

    unregisterSource(db, listSources(db)[0].id);
    expect(count()).toBe(0);
  });
});
