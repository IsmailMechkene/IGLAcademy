import type Database from 'better-sqlite3';
import type { StudyStats } from '../../../src/types';

/**
 * Daily study activity, one row per LOCAL calendar day: real video watch time
 * (wall clock while playing, not position jumps), time spent on practice-exam
 * questions, lessons completed, questions answered and flashcards reviewed.
 * Drives the daily goal and the study streak.
 */

export interface ActivityDelta {
  watchSeconds?: number;
  examSeconds?: number;
  lessonsCompleted?: number;
  questionsAnswered?: number;
  cardsReviewed?: number;
}

/** "YYYY-MM-DD" for the user's local calendar day. */
export function localDay(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The local day `n` days before `day` ("YYYY-MM-DD"). */
export function dayBefore(day: string, n = 1): string {
  const [y, m, d] = day.split('-').map(Number);
  return localDay(new Date(y, m - 1, d - n));
}

export function recordActivity(db: Database.Database, delta: ActivityDelta, day = localDay()): void {
  const v = (n: number | undefined) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);
  const row = [
    v(delta.watchSeconds),
    v(delta.examSeconds),
    Math.floor(v(delta.lessonsCompleted)),
    Math.floor(v(delta.questionsAnswered)),
    Math.floor(v(delta.cardsReviewed)),
  ];
  if (row.every((x) => x === 0)) return;
  db.prepare(
    `INSERT INTO study_days (day, watch_seconds, exam_seconds, lessons_completed, questions_answered, cards_reviewed)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET
       watch_seconds = watch_seconds + excluded.watch_seconds,
       exam_seconds = exam_seconds + excluded.exam_seconds,
       lessons_completed = lessons_completed + excluded.lessons_completed,
       questions_answered = questions_answered + excluded.questions_answered,
       cards_reviewed = cards_reviewed + excluded.cards_reviewed`,
  ).run(day, ...row);
}

interface DayRow {
  day: string;
  watch_seconds: number;
  exam_seconds: number;
  lessons_completed: number;
  questions_answered: number;
  cards_reviewed: number;
}

/** A day counts towards the streak when some real studying happened. */
export function isActiveDay(row: Pick<DayRow, 'watch_seconds' | 'exam_seconds' | 'lessons_completed' | 'questions_answered' | 'cards_reviewed'>): boolean {
  return (
    row.watch_seconds + row.exam_seconds >= 60 ||
    row.lessons_completed > 0 ||
    row.questions_answered > 0 ||
    row.cards_reviewed > 0
  );
}

/**
 * Current and best streak of consecutive active days. The current streak is
 * still alive when today has no activity yet but yesterday did — it only
 * breaks once a whole day passes without studying.
 */
export function computeStreaks(activeDays: Iterable<string>, today: string): { current: number; best: number } {
  const set = new Set(activeDays);
  let current = 0;
  let cursor = set.has(today) ? today : dayBefore(today);
  while (set.has(cursor)) {
    current++;
    cursor = dayBefore(cursor);
  }
  let best = 0;
  for (const day of set) {
    if (set.has(dayBefore(day))) continue; // not the start of a run
    let length = 0;
    let d = day;
    while (set.has(d)) {
      length++;
      const [y, m, dd] = d.split('-').map(Number);
      d = localDay(new Date(y, m - 1, dd + 1));
    }
    best = Math.max(best, length);
  }
  return { current, best: Math.max(best, current) };
}

export function getStudyStats(db: Database.Database, goalMinutes: number, now = new Date()): StudyStats {
  const today = localDay(now);
  const rows = db.prepare('SELECT * FROM study_days ORDER BY day').all() as DayRow[];
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const studied = (r: DayRow | undefined) => (r ? r.watch_seconds + r.exam_seconds : 0);
  const t = byDay.get(today);
  const { current, best } = computeStreaks(rows.filter(isActiveDay).map((r) => r.day), today);

  const last7 = Array.from({ length: 7 }, (_, i) => {
    const day = dayBefore(today, 6 - i);
    const r = byDay.get(day);
    return { day, studiedSeconds: Math.round(studied(r)), active: r ? isActiveDay(r) : false };
  });

  return {
    today: {
      studiedSeconds: Math.round(studied(t)),
      goalSeconds: goalMinutes * 60,
      lessonsCompleted: t?.lessons_completed ?? 0,
      questionsAnswered: t?.questions_answered ?? 0,
      cardsReviewed: t?.cards_reviewed ?? 0,
    },
    activeToday: t ? isActiveDay(t) : false,
    currentStreak: current,
    bestStreak: best,
    last7,
    totalStudiedSeconds: Math.round(rows.reduce((n, r) => n + studied(r), 0)),
  };
}
