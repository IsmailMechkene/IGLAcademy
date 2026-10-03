import { ipcMain } from 'electron';
import { getDb } from '../database/connection';
import {
  listQuizzesForCourse, getQuiz, insertQuiz, updateQuiz, deleteQuiz,
  insertQuestion, deleteQuestion, listAttempts, getAttemptDetail, insertAttempt,
} from '../database/repositories/quizzes';
import { requireId, requireString, optionalId, optionalString, ValidationError } from '../services/validate';
import type { QuizQuestionInput, AnswerInput } from '../../src/types';

export function validateQuestionInput(q: unknown, index: number): QuizQuestionInput {
  const data = q as { question?: unknown; options?: unknown; correctIndex?: unknown; explanation?: unknown };
  const question = requireString(data.question, `question ${index + 1}`, 1000);
  if (!Array.isArray(data.options)) throw new ValidationError(`question ${index + 1}: options must be an array`);
  const options = data.options.map((o, i) => requireString(o, `question ${index + 1} option ${i + 1}`, 500));
  if (options.length < 2) throw new ValidationError(`question ${index + 1}: at least 2 options are required`);
  if (options.length > 6) throw new ValidationError(`question ${index + 1}: at most 6 options are allowed`);
  const ci = typeof data.correctIndex === 'number' ? data.correctIndex : -1;
  if (!Number.isInteger(ci) || ci < 0 || ci >= options.length) {
    throw new ValidationError(`question ${index + 1}: correctIndex must be a valid option index`);
  }
  return {
    question,
    options,
    correctIndex: ci,
    explanation: optionalString(data.explanation, `question ${index + 1} explanation`, 2000),
  };
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

    const parsed: AnswerInput[] = answers.map((a, i) => {
      const data = a as { questionId?: unknown; selectedIndex?: unknown };
      return {
        questionId: requireId(data.questionId, `answer ${i + 1} questionId`),
        selectedIndex: requireId(data.selectedIndex, `answer ${i + 1} selectedIndex`),
      };
    });

    const answerRows = parsed.map((a) => {
      const question = quiz.questions.find((q) => q.id === a.questionId);
      if (!question) throw new ValidationError(`Unknown question id ${a.questionId}`);
      if (a.selectedIndex < 0 || a.selectedIndex >= question.options.length) {
        throw new ValidationError(`Invalid option selected for question ${a.questionId}`);
      }
      return { questionId: a.questionId, selectedIndex: a.selectedIndex, isCorrect: a.selectedIndex === question.correctIndex };
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
