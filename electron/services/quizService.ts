import type Database from 'better-sqlite3';
import type { QuizDetail, QuizSubmitResult } from '../../src/types';
import { getQuiz, insertAttempt } from '../database/repositories/quizzes';
import {
  deleteExamSession,
  getExamSession,
  QUIZ_SESSION_PREFIX,
  saveExamSession,
} from '../database/repositories/practice';
import { getAllSettings } from '../database/repositories/settings';
import { recordActivity } from '../database/repositories/activity';
import { addMistakes, MISTAKES_SOURCE_PREFIX } from './mistakesService';
import { requireId, ValidationError } from './validate';

/**
 * Course quizzes (the ones written in the app): submission with its side
 * effects, and in-progress runs saved so a quiz survives closing the app.
 */

function setsEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort((x, y) => x - y);
  const sortedB = [...b].sort((x, y) => x - y);
  return sortedA.every((v, i) => v === sortedB[i]);
}

export interface ScoredAnswer {
  questionId: number;
  selectedIndex: number;
  selectedIndices: number[];
  isCorrect: boolean;
}

/**
 * Scores a submission against the QUIZ rather than against the payload: one
 * row per question, in the quiz's own order, regardless of what the client
 * sent. A short or partly-empty submission therefore cannot inflate the
 * percentage (the total used to be `answers.length`) and cannot be rejected
 * outright (a timed auto-submit legitimately contains unanswered questions,
 * which simply count as incorrect).
 */
export function scoreAttempt(quiz: QuizDetail, answers: unknown[]): ScoredAnswer[] {
  const submitted = new Map<number, number[]>();
  answers.forEach((a: unknown, i: number) => {
    const data = a as { questionId?: unknown; selectedIndex?: unknown; selectedIndices?: unknown };
    const questionId = requireId(data.questionId, `answer ${i + 1} questionId`);
    const raw = Array.isArray(data.selectedIndices)
      ? data.selectedIndices
      : data.selectedIndex === undefined || data.selectedIndex === null
        ? []
        : [data.selectedIndex];
    const selectedIndices = [...new Set(raw)].filter(
      (n): n is number => Number.isInteger(n) && (n as number) >= 0,
    );
    // Entries for questions that no longer exist are ignored rather than
    // thrown on: losing the whole attempt would be the worse outcome.
    if (quiz.questions.some((q) => q.id === questionId)) {
      submitted.set(questionId, selectedIndices.sort((x, y) => x - y));
    }
  });

  return quiz.questions.map((question) => {
    // Out-of-range options are dropped; an empty set means "unanswered".
    const selectedIndices = (submitted.get(question.id) ?? []).filter((n) => n < question.options.length);
    return {
      questionId: question.id,
      selectedIndex: selectedIndices[0] ?? -1,
      selectedIndices,
      isCorrect: selectedIndices.length > 0 && setsEqual(selectedIndices, question.correctIndices),
    };
  });
}

const sessionKey = (quizId: number) => `${QUIZ_SESSION_PREFIX}${quizId}`;
const MAX_SESSION_BYTES = 512 * 1024;


export function submitQuizAttempt(db: Database.Database, quizId: number, answers: unknown[]): QuizSubmitResult {
  const quiz = getQuiz(db, quizId);
  if (!quiz) throw new ValidationError('Quiz not found');
  const scored = scoreAttempt(quiz, answers);
  const attemptId = db.transaction(() => {
    const id = insertAttempt(db, quizId, scored, quiz.questions.length);
    deleteExamSession(db, sessionKey(quizId)); // the run is over
    return id;
  })();
  recordActivity(db, { questionsAnswered: scored.filter((a) => a.selectedIndices.length > 0).length });

  const result: QuizSubmitResult = { attemptId };
  if (getAllSettings(db).examMistakesToFlashcards) {
    try {
      const correctById = new Map(scored.map((a) => [a.questionId, a.isCorrect]));
      const wrong = quiz.questions.flatMap((q, i) => (correctById.get(q.id) ? [] : [i]));
      const added = addMistakes(db, quizMistakesDeck(quiz), quiz.questions.map(toCardQuestion), wrong);
      result.mistakesAdded = added.added;
      if (added.deckId !== null) result.mistakesDeckId = added.deckId;
    } catch {
      // the attempt is stored; flashcards are a convenience on top
    }
  }
  return result;
}

function quizMistakesDeck(quiz: QuizDetail) {
  return {
    source: `${MISTAKES_SOURCE_PREFIX}${QUIZ_SESSION_PREFIX}${quiz.id}`,
    title: `Mistakes · ${quiz.title}`,
    courseId: quiz.courseId,
  };
}

function toCardQuestion(q: QuizDetail['questions'][number]) {
  return {
    question: q.question,
    options: q.options,
    correctIndices: q.correctIndices,
    explanation: q.explanation,
    topic: '',
  };
}

export function getQuizSession(db: Database.Database, quizId: number): unknown {
  const row = getExamSession(db, sessionKey(quizId));
  if (!row) return null;
  if (!getQuiz(db, quizId)) {
    deleteExamSession(db, sessionKey(quizId));
    return null;
  }
  try {
    return JSON.parse(row.state) as unknown;
  } catch {
    deleteExamSession(db, sessionKey(quizId));
    return null;
  }
}

export function saveQuizSession(db: Database.Database, quizId: number, state: unknown): void {
  if (!getQuiz(db, quizId)) throw new ValidationError('Quiz not found');
  if (typeof state !== 'object' || state === null || Array.isArray(state)) {
    throw new ValidationError('Quiz session must be an object.');
  }
  const json = JSON.stringify(state);
  if (json.length > MAX_SESSION_BYTES) throw new ValidationError('Quiz session is too large.');
  saveExamSession(db, sessionKey(quizId), json);
}

/** Also used when a quiz is edited or deleted: its saved run no longer fits. */
export function clearQuizSession(db: Database.Database, quizId: number): void {
  deleteExamSession(db, sessionKey(quizId));
}
