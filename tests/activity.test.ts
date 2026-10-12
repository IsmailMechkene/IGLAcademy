import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../electron/database/connection';
import {
  computeStreaks,
  dayBefore,
  getStudyStats,
  isActiveDay,
  localDay,
  recordActivity,
} from '../electron/database/repositories/activity';
import { registerSource, loadExamFile, submitExamAttempt } from '../electron/services/practiceLibraryService';
import { exportData, importData } from '../electron/services/backupService';

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

describe('local days', () => {
  it('formats the local calendar day and steps back across months and years', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(dayBefore('2026-03-01')).toBe('2026-02-28');
    expect(dayBefore('2026-01-01')).toBe('2025-12-31');
    expect(dayBefore('2026-10-12', 7)).toBe('2026-10-05');
  });
});

describe('computeStreaks', () => {
  const today = '2026-10-12';

  it('counts consecutive days ending today', () => {
    expect(computeStreaks(['2026-10-10', '2026-10-11', '2026-10-12'], today)).toEqual({ current: 3, best: 3 });
  });

  it('keeps the streak alive until today is over', () => {
    expect(computeStreaks(['2026-10-10', '2026-10-11'], today)).toEqual({ current: 2, best: 2 });
  });

  it('breaks after a missed day but remembers the best run', () => {
    const days = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-10-09', '2026-10-12'];
    expect(computeStreaks(days, today)).toEqual({ current: 1, best: 4 });
    expect(computeStreaks([], today)).toEqual({ current: 0, best: 0 });
  });
});

describe('isActiveDay', () => {
  const zero = { watch_seconds: 0, exam_seconds: 0, lessons_completed: 0, questions_answered: 0, cards_reviewed: 0 };
  it('needs a minute of study, a finished lesson, an answered question or a reviewed card', () => {
    expect(isActiveDay(zero)).toBe(false);
    expect(isActiveDay({ ...zero, watch_seconds: 30 })).toBe(false);
    expect(isActiveDay({ ...zero, watch_seconds: 40, exam_seconds: 25 })).toBe(true);
    expect(isActiveDay({ ...zero, cards_reviewed: 1 })).toBe(true);
  });
});

describe('recordActivity and getStudyStats', () => {
  it('accumulates per day and reports today, the streak and the last week', () => {
    const now = new Date(2026, 9, 12, 10, 0);
    const today = localDay(now);
    recordActivity(db, { watchSeconds: 600 }, dayBefore(today, 2));
    recordActivity(db, { cardsReviewed: 3 }, dayBefore(today, 1));
    recordActivity(db, { watchSeconds: 300, lessonsCompleted: 1 }, today);
    recordActivity(db, { watchSeconds: 120.5, examSeconds: 60, questionsAnswered: 2 }, today);
    recordActivity(db, { watchSeconds: -50, examSeconds: Number.NaN }, today); // ignored

    const stats = getStudyStats(db, 20, now);
    expect(stats.today).toEqual({
      studiedSeconds: 481,
      goalSeconds: 1200,
      lessonsCompleted: 1,
      questionsAnswered: 2,
      cardsReviewed: 0,
    });
    expect(stats.activeToday).toBe(true);
    expect(stats.currentStreak).toBe(3);
    expect(stats.last7).toHaveLength(7);
    expect(stats.last7[6]).toEqual({ day: today, studiedSeconds: 481, active: true });
    expect(stats.last7[5]).toEqual({ day: dayBefore(today), studiedSeconds: 0, active: true });
    expect(stats.totalStudiedSeconds).toBe(1081);
  });

  it('counts a submitted practice exam as study', () => {
    const root = tmp('ismalearn-act-');
    const file = path.join(root, 'Exam.html');
    fs.writeFileSync(
      file,
      `<html><body><script>const quizData = ${JSON.stringify({
        quiz_title: 'Exam',
        questions: [
          { assessment_type: 'multiple-choice', prompt: { question: '<p>Q1</p>', answers: ['<p>A</p>', '<p>B</p>'], explanation: '' }, correct_response: ['a'] },
          { assessment_type: 'multiple-choice', prompt: { question: '<p>Q2</p>', answers: ['<p>A</p>', '<p>B</p>'], explanation: '' }, correct_response: ['b'] },
        ],
      })};</script></body></html>`,
    );
    registerSource(db, root, 'dir');
    submitExamAttempt(
      db,
      file,
      [
        { questionIndex: 0, selected: [0], seconds: 45 },
        { questionIndex: 1, selected: [], seconds: 5000 }, // capped at 10 minutes
      ],
      [],
      loadExamFile(db, file).contentHash,
    );
    const stats = getStudyStats(db, 20);
    expect(stats.today.questionsAnswered).toBe(1);
    expect(stats.today.studiedSeconds).toBe(645);
  });

  it('is included in backups', () => {
    recordActivity(db, { watchSeconds: 900 }, '2026-10-01');
    const data = exportData(db, 'test');
    expect(data.tables.study_days).toHaveLength(1);
    db.prepare('DELETE FROM study_days').run();
    importData(db, data);
    expect(getStudyStats(db, 20, new Date(2026, 9, 1)).today.studiedSeconds).toBe(900);
  });
});
