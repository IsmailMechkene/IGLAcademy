import { ipcMain } from 'electron';
import { getDb } from '../database/connection';
import {
  listQuizzesForCourse, getQuiz, insertQuiz, updateQuiz, deleteQuiz,
  insertQuestion, deleteQuestion, listAttempts, getAttemptDetail, insertAttempt,
} from '../database/repositories/quizzes';
import { requireId, requireString, optionalId, optionalString, ValidationError } from '../services/validate';
import type { QuizQuestionInput, AnswerInput } from '../../src/types';

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

    updateQuiz(db, quizId, { title, description });
    // Replace questions wholesale (simplest correct approach for an editor)
    const existing = getQuiz(db, quizId);
    existing?.questions.forEach((q) => deleteQuestion(db, q.id));
    questions.forEach((q, i) => {
      insertQuestion(db, quizId, { ...q, position: i + 1 });
    });
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

    const parsed: AnswerInput[] = (answers as unknown[]).map((a: unknown, i: number) => {
      const data = a as { questionId?: unknown; selectedIndex?: unknown; selectedIndices?: unknown };
      const questionId = requireId(data.questionId, `answer ${i + 1} questionId`);
      let selectedIndices: number[];
      if (Array.isArray(data.selectedIndices)) {
        // May be empty (unanswered on auto-submit) — counts as incorrect.
        selectedIndices = [...new Set(data.selectedIndices)].filter(
          (n): n is number => Number.isInteger(n) && (n as number) >= 0,
        ) as number[];
      } else {
        selectedIndices = [requireId(data.selectedIndex, `answer ${i + 1} selectedIndex`)];
      }
      return { questionId, selectedIndex: selectedIndices[0] ?? -1, selectedIndices };
    });

    const answerRows = parsed.map((a) => {
      const question = quiz.questions.find((q) => q.id === a.questionId);
      if (!question) throw new ValidationError(`Unknown question id ${a.questionId}`);
      const selectedIndices = (a.selectedIndices ?? [a.selectedIndex]).filter(
        (n) => Number.isInteger(n) && n >= 0 && n < question.options.length,
      );
      if (selectedIndices.length === 0) {
        throw new ValidationError(`Invalid option selected for question ${a.questionId}`);
      }
      return {
        questionId: a.questionId,
        selectedIndex: selectedIndices[0],
        selectedIndices,
        isCorrect: setsEqual(selectedIndices, question.correctIndices),
      };
    });

    return insertAttempt(db, qid, answerRows);
  });

  ipcMain.handle('quizzes:attempts', (_e, quizId: unknown) => {
    return listAttempts(db, requireId(quizId, 'quizId'));
  });

  ipcMain.handle('quizzes:attemptDetail', (_e, attemptId: unknown) => {
    return getAttemptDetail(db, requireId(attemptId, 'attemptId'));
  });
}

export { ValidationError };
