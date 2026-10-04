import { ipcMain } from 'electron';
import { getDb } from '../database/connection';
import {
  listBookmarks, insertBookmark, deleteBookmark,
  listReviewItems, insertReviewItem, setReviewItemDone, deleteReviewItem,
  listDecks, insertDeck, deleteDeck, insertFlashcard, deleteFlashcard,
  listDueFlashcards, listFlashcards, updateFlashcardState, countDueReviews,
} from '../database/repositories/study';
import { getCourse } from '../database/repositories/courses';
import { listNotes } from '../database/repositories/notes';
import { getQuiz } from '../database/repositories/quizzes';
import { requireId, requireString, optionalString, optionalId, ValidationError } from '../services/validate';

const REVIEW_KINDS = ['lesson', 'note', 'quiz', 'exam'] as const;

export function registerStudyIpc(): void {
  const db = getDb();

  // ----- bookmarks -----
  ipcMain.handle('bookmarks:list', (_e, courseId?: unknown) => {
    return listBookmarks(db, courseId === undefined ? undefined : requireId(courseId, 'courseId'));
  });

  ipcMain.handle('bookmarks:create', (_e, input: unknown) => {
    const data = input as { courseId?: unknown; lessonId?: unknown; positionSeconds?: unknown; title?: unknown; note?: unknown };
    const courseId = requireId(data.courseId, 'courseId');
    if (!getCourse(db, courseId)) throw new ValidationError('Course not found');
    return insertBookmark(db, {
      courseId,
      lessonId: optionalId(data.lessonId, 'lessonId'),
      positionSeconds: typeof data.positionSeconds === 'number' && data.positionSeconds >= 0 ? data.positionSeconds : 0,
      title: requireString(data.title, 'title', 200),
      note: optionalString(data.note, 'note', 2000),
    });
  });

  ipcMain.handle('bookmarks:remove', (_e, id: unknown) => {
    deleteBookmark(db, requireId(id, 'id'));
  });

  // ----- review later -----
  ipcMain.handle('review:list', () => listReviewItems(db));

  ipcMain.handle('review:add', (_e, input: unknown) => {
    const data = input as { courseId?: unknown; kind?: unknown; refId?: unknown; title?: unknown; dueAt?: unknown };
    const courseId = data.courseId === undefined || data.courseId === null ? null : requireId(data.courseId, 'courseId');
    const kind = data.kind;
    if (typeof kind !== 'string' || !(REVIEW_KINDS as readonly string[]).includes(kind)) {
      throw new ValidationError('kind must be one of: lesson, note, quiz, exam');
    }
    if (courseId !== null && !getCourse(db, courseId)) throw new ValidationError('Course not found');
    if (courseId === null && kind !== 'exam') {
      throw new ValidationError('Only file-based exams may omit the course.');
    }
    return insertReviewItem(db, {
      courseId,
      kind: kind as 'lesson' | 'note' | 'quiz' | 'exam',
      refId: String(data.refId ?? ''),
      title: requireString(data.title, 'title', 200),
      dueAt: typeof data.dueAt === 'string' ? data.dueAt : undefined,
    });
  });

  ipcMain.handle('review:setDone', (_e, id: unknown, done: unknown) => {
    setReviewItemDone(db, requireId(id, 'id'), done === true);
  });

  ipcMain.handle('review:remove', (_e, id: unknown) => {
    deleteReviewItem(db, requireId(id, 'id'));
  });

  ipcMain.handle('review:dueCounts', () => {
    return countDueReviews(db, new Date().toISOString());
  });

  // ----- flashcards -----
  ipcMain.handle('flashcards:decks', (_e, courseId?: unknown) => {
    return listDecks(db, courseId === undefined ? undefined : requireId(courseId, 'courseId'));
  });

  ipcMain.handle('flashcards:createDeck', (_e, input: unknown) => {
    const data = input as { courseId?: unknown; title?: unknown; source?: unknown };
    const courseId = requireId(data.courseId, 'courseId');
    if (!getCourse(db, courseId)) throw new ValidationError('Course not found');
    return insertDeck(db, {
      courseId,
      title: requireString(data.title, 'title', 200),
      source: typeof data.source === 'string' ? data.source.slice(0, 100) : undefined,
    });
  });

  ipcMain.handle('flashcards:removeDeck', (_e, id: unknown) => {
    deleteDeck(db, requireId(id, 'id'));
  });

  ipcMain.handle('flashcards:cards', (_e, deckId: unknown) => {
    return listFlashcards(db, requireId(deckId, 'deckId'));
  });

  ipcMain.handle('flashcards:due', (_e, deckId: unknown) => {
    return listDueFlashcards(db, requireId(deckId, 'deckId'), new Date().toISOString());
  });

  ipcMain.handle('flashcards:addCard', (_e, input: unknown) => {
    const data = input as { deckId?: unknown; front?: unknown; back?: unknown };
    const deckId = requireId(data.deckId, 'deckId');
    const cards = listFlashcards(db, deckId);
    return insertFlashcard(db, deckId, {
      front: requireString(data.front, 'front', 2000),
      back: requireString(data.back, 'back', 5000),
      position: cards.length + 1,
    });
  });

  ipcMain.handle('flashcards:removeCard', (_e, id: unknown) => {
    deleteFlashcard(db, requireId(id, 'id'));
  });

  ipcMain.handle('flashcards:grade', (_e, input: unknown) => {
    const data = input as { cardId?: unknown; ease?: unknown; intervalDays?: unknown; reps?: unknown; dueAt?: unknown };
    const cardId = requireId(data.cardId, 'cardId');
    const ease = typeof data.ease === 'number' ? data.ease : 2.5;
    const intervalDays = typeof data.intervalDays === 'number' ? data.intervalDays : 0;
    const reps = typeof data.reps === 'number' ? Math.floor(data.reps) : 0;
    const dueAt = typeof data.dueAt === 'string' && data.dueAt ? data.dueAt : new Date().toISOString();
    if (!(ease >= 1.3 && ease <= 4) || !(intervalDays >= 0 && intervalDays <= 36500) || reps < 0) {
      throw new ValidationError('Invalid scheduling values');
    }
    updateFlashcardState(db, cardId, { ease, intervalDays, reps, dueAt });
  });

  // Generate a deck from a manual quiz's questions (front=question, back=answers).
  ipcMain.handle('flashcards:fromQuiz', (_e, input: unknown) => {
    const data = input as { courseId?: unknown; quizId?: unknown };
    const courseId = requireId(data.courseId, 'courseId');
    const quiz = getQuiz(db, requireId(data.quizId, 'quizId'));
    if (!quiz || quiz.courseId !== courseId) throw new ValidationError('Quiz not found');
    const deckId = insertDeck(db, { courseId, title: `${quiz.title} — flashcards`, source: `quiz:${quiz.id}` });
    quiz.questions.forEach((q, i) => {
      const correct = q.correctIndices.map((ci) => q.options[ci]).filter(Boolean).join('; ');
      insertFlashcard(db, deckId, {
        front: q.question,
        back: `${correct}${q.explanation ? `\n\n${q.explanation}` : ''}`,
        position: i + 1,
      });
    });
    return deckId;
  });

  // Generate a deck from course notes (one card per note).
  ipcMain.handle('flashcards:fromNotes', (_e, courseId: unknown) => {
    const cid = requireId(courseId, 'courseId');
    const course = getCourse(db, cid);
    if (!course) throw new ValidationError('Course not found');
    const notes = listNotes(db, cid);
    if (notes.length === 0) throw new ValidationError('No notes to build flashcards from.');
    const deckId = insertDeck(db, { courseId: cid, title: `${course.title} — note cards`, source: 'notes' });
    notes.forEach((n, i) => {
      const front = n.title.trim() || n.content.split('\n')[0]?.slice(0, 120) || 'Untitled note';
      insertFlashcard(db, deckId, { front, back: n.content, position: i + 1 });
    });
    return deckId;
  });
}
