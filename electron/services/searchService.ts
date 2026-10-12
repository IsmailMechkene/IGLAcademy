import type Database from 'better-sqlite3';
import type { GlobalSearchResults } from '../../src/types';
import { searchNotes } from '../database/repositories/notes';
import { scanLibrary } from './practiceLibraryService';

/**
 * One query across courses, lessons, notes and practice exams, for the Ctrl+K
 * palette. Case-insensitive substring match; within a group, titles that
 * start with the query rank first, then earlier matches.
 */

const PER_GROUP = 6;
const LESSONS = 8;

/** Practice-exam titles change only when files do; a short cache keeps typing cheap. */
let examCache: { at: number; files: Array<{ filePath: string; title: string; questionCount: number }> } | null = null;
const EXAM_CACHE_MS = 30_000;

export function invalidateSearchCache(): void {
  examCache = null;
}

function rank(title: string, q: string): number {
  // "02 - Versioning basics" starts with "versioning": ignore lesson numbers.
  const i = title.replace(/^\d{1,4}\s*[-–—._:)]\s*/, '').toLowerCase().indexOf(q);
  return i < 0 ? Number.POSITIVE_INFINITY : i;
}

function byRank<T>(items: T[], title: (t: T) => string, q: string, limit: number): T[] {
  return items
    .map((item) => ({ item, r: rank(title(item), q) }))
    .sort((a, b) => a.r - b.r)
    .slice(0, limit)
    .map((x) => x.item);
}

function like(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
}

export function globalSearch(db: Database.Database, query: string): GlobalSearchResults {
  const q = query.trim().toLowerCase();
  if (!q) return { courses: [], lessons: [], notes: [], exams: [] };
  const pattern = like(q);

  const courses = db
    .prepare(
      `SELECT c.id, c.title,
         (SELECT COUNT(*) FROM lessons l JOIN sections s ON s.id = l.section_id
          WHERE s.course_id = c.id AND l.file_type IN ('video', 'practice')) AS lesson_count
       FROM courses c WHERE c.title LIKE ? ESCAPE '\\' LIMIT 50`,
    )
    .all(pattern) as Array<{ id: number; title: string; lesson_count: number }>;

  const lessons = db
    .prepare(
      `SELECT l.id, l.title, l.file_type, s.title AS section_title, c.id AS course_id, c.title AS course_title
       FROM lessons l
       JOIN sections s ON s.id = l.section_id
       JOIN courses c ON c.id = s.course_id
       WHERE l.file_type IN ('video', 'practice') AND l.title LIKE ? ESCAPE '\\'
       ORDER BY c.last_opened_at DESC, s.position, l.position
       LIMIT 200`,
    )
    .all(pattern) as Array<{
    id: number; title: string; file_type: string; section_title: string; course_id: number; course_title: string;
  }>;

  const notes = searchNotes(db, q).slice(0, 50);

  if (!examCache || Date.now() - examCache.at > EXAM_CACHE_MS) {
    examCache = {
      at: Date.now(),
      files: scanLibrary(db)
        .filter((f) => !f.error)
        .map((f) => ({ filePath: f.filePath, title: f.title, questionCount: f.questionCount })),
    };
  }
  const exams = examCache.files.filter((f) => f.title.toLowerCase().includes(q));

  return {
    courses: byRank(courses, (c) => c.title, q, PER_GROUP).map((c) => ({
      id: c.id,
      title: c.title,
      lessonCount: c.lesson_count,
    })),
    lessons: byRank(lessons, (l) => l.title, q, LESSONS).map((l) => ({
      id: l.id,
      title: l.title,
      kind: l.file_type === 'practice' ? 'practice' : 'video',
      sectionTitle: l.section_title,
      courseId: l.course_id,
      courseTitle: l.course_title,
    })),
    notes: byRank(notes, (n) => n.title || n.content, q, PER_GROUP).map((n) => {
      const text = n.content.replace(/\s+/g, ' ');
      const at = text.toLowerCase().indexOf(q);
      const snippet = at < 0 ? text.slice(0, 90) : `${at > 30 ? '…' : ''}${text.slice(Math.max(0, at - 30), at + 60)}`;
      return {
        id: n.id,
        title: n.title || 'Untitled note',
        snippet,
        courseId: n.courseId,
        courseTitle: n.courseTitle,
        lessonId: n.lessonId,
      };
    }),
    exams: byRank(exams, (e) => e.title, q, PER_GROUP),
  };
}
