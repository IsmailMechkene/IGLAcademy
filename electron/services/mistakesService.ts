import type Database from 'better-sqlite3';
import type { PracticeExamQuestion } from '../../src/types';
import { findDeckBySource, insertDeck, insertFlashcard, listCardFronts } from '../database/repositories/study';

/**
 * Turns the questions answered wrongly in a practice exam into flashcards, so
 * spaced repetition keeps bringing them back until they are known. Each exam
 * file gets one "Mistakes" deck (identified by its `source`); a question that
 * is already in the deck is not added again on a retake.
 */

export const MISTAKES_SOURCE_PREFIX = 'mistakes:';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Question plus lettered options — what the learner must recall from. */
export function mistakeCardFront(q: PracticeExamQuestion): string {
  const options = q.options.map((o, i) => `${LETTERS[i] ?? '?'}. ${o}`);
  const hint = q.correctIndices.length > 1 ? [`(Choose ${q.correctIndices.length})`] : [];
  return [q.question, ...options, ...hint].join('\n');
}

/** The answer first, then the explanation (with the parser's inline markers). */
export function mistakeCardBack(q: PracticeExamQuestion): string {
  const answers = q.correctIndices
    .map((i) => `**${LETTERS[i] ?? '?'}. ${q.options[i] ?? ''}**`)
    .join('\n');
  const label = q.correctIndices.length > 1 ? 'Correct answers:' : 'Correct answer:';
  return [label, answers, q.explanation].filter((part) => part.trim()).join('\n');
}

export interface MistakesDeck {
  /** Stable identity of the deck (e.g. "mistakes:<exam path>"). */
  source: string;
  title: string;
  /** The owning course, or null for practice-exam files. */
  courseId: number | null;
}

/** Practice-exam file: one course-less deck per file. */
export function addExamMistakes(
  db: Database.Database,
  sourcePath: string,
  examTitle: string,
  questions: PracticeExamQuestion[],
  wrongIndices: number[],
): { deckId: number | null; added: number } {
  return addMistakes(
    db,
    { source: MISTAKES_SOURCE_PREFIX + sourcePath, title: `Mistakes · ${examTitle}`, courseId: null },
    questions,
    wrongIndices,
  );
}

export function addMistakes(
  db: Database.Database,
  deck: MistakesDeck,
  questions: PracticeExamQuestion[],
  wrongIndices: number[],
): { deckId: number | null; added: number } {
  const wrong = wrongIndices.filter((i) => questions[i]);
  if (wrong.length === 0) return { deckId: findDeckBySource(db, deck.source)?.id ?? null, added: 0 };

  return db.transaction(() => {
    const source = deck.source;
    const deckId =
      findDeckBySource(db, source)?.id ??
      insertDeck(db, { courseId: deck.courseId, title: deck.title, source });
    const existing = new Set(listCardFronts(db, deckId));
    let position = existing.size;
    let added = 0;
    for (const i of wrong) {
      const front = mistakeCardFront(questions[i]);
      if (existing.has(front)) continue;
      existing.add(front);
      insertFlashcard(db, deckId, { front, back: mistakeCardBack(questions[i]), position: ++position });
      added++;
    }
    return { deckId, added };
  })();
}
