import { ipcMain } from 'electron';
import { getDb } from '../database/connection';
import {
  listQuizzesForCourse, getQuiz, insertQuiz, updateQuiz, deleteQuiz,
  insertQuestion, updateQuestion, deleteQuestion, listAttempts, getAttemptDetail, insertAttempt,
} from '../database/repositories/quizzes';
import { requireId, requireString, optionalId, optionalString, ValidationError } from '../services/validate';
import type { QuizDetail, QuizQuestionInput } from '../../src/types';

export function validateQuestionInput(q: unknown, index: number): QuizQuestionInput {
  const data = q as { question?: unknown; options?: unknown; correctIndex?: unknown; correctIndices?: unknown; explanation?: unknown };
  const question = requireString(data.question, `question ${index + 1}`, 1000);
  if (!Array.isArray(data.options)) throw new ValidationError(`question ${index + 1}: options must be an array`);
  const options = data.options.map((o, i) => requireString(o, `question ${index + 1} option ${i + 1}`, 500));
  if (options.length < 2) throw new ValidationError(`question ${index + 1}: at least 2 options are required`);
  if (options.length > 6) throw new ValidationError(`question ${index + 1}: at most 6 options are allowed`);
  const ci = typeof data.correctIndex === 'number' ? data.correctIndex : -1;
  if (!Number.isInteger(ci) || ci < 0 || ci >= options.length) {
    throw new ValidationError(`question ${index + 1}: correctIndex must be a valid option index`);
  }
  // Optional full correct set (multi-select); defaults to the single index.
  let correctIndices: number[];
  if (Array.isArray(data.correctIndices) && data.correctIndices.length > 0) {
    correctIndices = [...new Set(data.correctIndices)].filter(
      (n): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) < options.length,
    ).sort((a, b) => (a as number) - (b as number)) as number[];
    if (correctIndices.length === 0) {
      throw new ValidationError(`question ${index + 1}: correctIndices must contain valid option indices`);
    }
  } else {
    correctIndices = [ci];
  }
  return {
    question,
    options,
    correctIndex: correctIndices[0],
    correctIndices,
    explanation: optionalString(data.explanation, `question ${index + 1} explanation`, 2000),
  };
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

/** Exact set match: a multi-select answer is correct only when complete. */
function setsEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort((x, y) => x - y);
  const sortedB = [...b].sort((x, y) => x - y);
  return sortedA.every((v, i) => v === sortedB[i]);
}

export function registerQuizIpc(): void {
  const db = getDb();

  ipcMain.handle('quizzes:listForCourse', (_e, courseId: unknown) => {
    return listQuizzesForCourse(db, requireId(courseId, 'courseId'));
  });

  ipcMain.handle('quizzes:get', (_e, id: unknown) => {
    return getQuiz(db, requireId(id, 'id'));
  });

  ipcMain.handle('quizzes:create', (_e, input: unknown) => {
    const data = input as { courseId?: unknown; sectionId?: unknown; title?: unknown; description?: unknown; questions?: unknown };
    const title = requireString(data.title, 'title', 200);
    const description = optionalString(data.description, 'description', 2000);
    if (!Array.isArray(data.questions)) throw new ValidationError('questions must be an array');
    const questions = data.questions.map(validateQuestionInput);
    if (questions.length === 0) throw new ValidationError('a quiz needs at least one question');

    const quizId = insertQuiz(db, {
      courseId: requireId(data.courseId, 'courseId'),
      sectionId: optionalId(data.sectionId, 'sectionId'),
      title,
      description,
    });
    questions.forEach((q, i) => {
      insertQuestion(db, quizId, { ...q, position: i + 1 });
    });
    return getQuiz(db, quizId);
  });

  ipcMain.handle('quizzes:update', (_e, id: unknown, input: unknown) => {
    const quizId = requireId(id, 'id');
    const data = input as { title?: unknown; description?: unknown; questions?: unknown };
    const title = requireString(data.title, 'title', 200);
    const description = optionalString(data.description, 'description', 2000);
    if (!Array.isArray(data.questions)) throw new ValidationError('questions must be an array');
    const questions = data.questions.map(validateQuestionInput);
    if (questions.length === 0) throw new ValidationError('a quiz needs at least one question');

    const existing = getQuiz(db, quizId);
    if (!existing) throw new ValidationError('Quiz not found');

    // Update questions in place, insert the new ones, and delete only the
    // ones that are really gone. Replacing them wholesale used to cascade
    // away every past attempt's answers (quiz_attempt_answers.question_id is
    // ON DELETE CASCADE) — history must survive an edit.
    const tx = db.transaction(() => {
      updateQuiz(db, quizId, { title, description });
      questions.forEach((q, i) => {
        const current = existing.questions[i];
        if (current) updateQuestion(db, current.id, { ...q, position: i + 1 });
        else insertQuestion(db, quizId, { ...q, position: i + 1 });
      });
      for (const surplus of existing.questions.slice(questions.length)) {
        deleteQuestion(db, surplus.id);
      }
    });
    tx();
    return getQuiz(db, quizId);
  });

  ipcMain.handle('quizzes:delete', (_e, id: unknown) => {
    deleteQuiz(db, requireId(id, 'id'));
  });

  ipcMain.handle('quizzes:submitAttempt', (_e, quizId: unknown, answers: unknown) => {
    const qid = requireId(quizId, 'quizId');
    const quiz = getQuiz(db, qid);
    if (!quiz) throw new ValidationError('Quiz not found');
    if (!Array.isArray(answers)) throw new ValidationError('answers must be an array');
    return insertAttempt(db, qid, scoreAttempt(quiz, answers as unknown[]), quiz.questions.length);
  });

  ipcMain.handle('quizzes:attempts', (_e, quizId: unknown) => {
    return listAttempts(db, requireId(quizId, 'quizId'));
  });

  ipcMain.handle('quizzes:attemptDetail', (_e, attemptId: unknown) => {
    return getAttemptDetail(db, requireId(attemptId, 'attemptId'));
  });
}

export { ValidationError };
