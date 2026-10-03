import type Database from 'better-sqlite3';
import type { Quiz, QuizDetail, QuizAttemptSummary, QuizAttemptDetail, QuizAttemptAnswer } from '../../../src/types';

interface QuizRow {
  id: number;
  course_id: number;
  section_id: number | null;
  title: string;
  description: string;
  created_at: string;
  updated_at: string;
  question_count: number;
  section_title: string | null;
}

function toQuiz(row: QuizRow): Quiz {
  return {
    id: row.id,
    courseId: row.course_id,
    sectionId: row.section_id,
    sectionTitle: row.section_title,
    title: row.title,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    questionCount: row.question_count,
  };
}

const SELECT_SQL = `
  SELECT q.*,
    (SELECT COUNT(*) FROM quiz_questions qq WHERE qq.quiz_id = q.id) AS question_count,
    s.title AS section_title
  FROM quizzes q
  LEFT JOIN sections s ON s.id = q.section_id`;

export function listQuizzesForCourse(db: Database.Database, courseId: number): Quiz[] {
  return (db.prepare(`${SELECT_SQL} WHERE q.course_id = ? ORDER BY q.created_at DESC`).all(courseId) as QuizRow[]).map(toQuiz);
}

export function getQuiz(db: Database.Database, id: number): QuizDetail | null {
  const row = db.prepare(`${SELECT_SQL} WHERE q.id = ?`).get(id) as QuizRow | undefined;
  if (!row) return null;
  const questions = (db
    .prepare('SELECT * FROM quiz_questions WHERE quiz_id = ? ORDER BY position')
    .all(id) as Array<{
    id: number; quiz_id: number; question: string; options: string;
    correct_index: number; explanation: string; position: number;
  }>)
    .map((q) => ({
      id: q.id,
      quizId: q.quiz_id,
      question: q.question,
      options: JSON.parse(q.options) as string[],
      correctIndex: q.correct_index,
      explanation: q.explanation,
      position: q.position,
    }));
  return { ...toQuiz(row), questions };
}

export function insertQuiz(
  db: Database.Database,
  data: { courseId: number; sectionId: number | null; title: string; description: string },
): number {
  const info = db
    .prepare('INSERT INTO quizzes (course_id, section_id, title, description) VALUES (?, ?, ?, ?)')
    .run(data.courseId, data.sectionId, data.title, data.description);
  return Number(info.lastInsertRowid);
}

export function updateQuiz(
  db: Database.Database,
  id: number,
  data: { title: string; description: string },
): void {
  db.prepare("UPDATE quizzes SET title = ?, description = ?, updated_at = datetime('now') WHERE id = ?").run(
    data.title,
    data.description,
    id,
  );
}

export function deleteQuiz(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM quizzes WHERE id = ?').run(id);
}

export function insertQuestion(
  db: Database.Database,
  quizId: number,
  data: { question: string; options: string[]; correctIndex: number; explanation: string; position: number },
): number {
  const info = db
    .prepare('INSERT INTO quiz_questions (quiz_id, question, options, correct_index, explanation, position) VALUES (?, ?, ?, ?, ?, ?)')
    .run(quizId, data.question, JSON.stringify(data.options), data.correctIndex, data.explanation, data.position);
  return Number(info.lastInsertRowid);
}

export function updateQuestion(
  db: Database.Database,
  questionId: number,
  data: { question: string; options: string[]; correctIndex: number; explanation: string },
): void {
  db.prepare('UPDATE quiz_questions SET question = ?, options = ?, correct_index = ?, explanation = ? WHERE id = ?').run(
    data.question,
    JSON.stringify(data.options),
    data.correctIndex,
    data.explanation,
    questionId,
  );
}

export function deleteQuestion(db: Database.Database, questionId: number): void {
  db.prepare('DELETE FROM quiz_questions WHERE id = ?').run(questionId);
}

export function listAttempts(db: Database.Database, quizId: number): QuizAttemptSummary[] {
  return (db
    .prepare('SELECT * FROM quiz_attempts WHERE quiz_id = ? ORDER BY created_at DESC')
    .all(quizId) as Array<{ id: number; quiz_id: number; score: number; total: number; created_at: string }>)
    .map((a) => ({
      id: a.id,
      quizId: a.quiz_id,
      score: a.score,
      total: a.total,
      percent: a.total > 0 ? Math.round((a.score / a.total) * 100) : 0,
      createdAt: a.created_at,
    }));
}

export function getAttemptDetail(db: Database.Database, attemptId: number): QuizAttemptDetail | null {
  const attempt = db
    .prepare('SELECT * FROM quiz_attempts WHERE id = ?')
    .get(attemptId) as { id: number; quiz_id: number; score: number; total: number; created_at: string } | undefined;
  if (!attempt) return null;

  const answers = (db
    .prepare(
      `SELECT qa.question_id, qa.selected_index, qa.is_correct,
              qq.question, qq.options, qq.correct_index, qq.explanation
       FROM quiz_attempt_answers qa
       JOIN quiz_questions qq ON qq.id = qa.question_id
       WHERE qa.attempt_id = ?
       ORDER BY qq.position`,
    )
    .all(attemptId) as Array<{
    question_id: number; selected_index: number; is_correct: number;
    question: string; options: string; correct_index: number; explanation: string;
  }>)
    .map((a): QuizAttemptAnswer => ({
      questionId: a.question_id,
      question: a.question,
      options: JSON.parse(a.options) as string[],
      correctIndex: a.correct_index,
      selectedIndex: a.selected_index,
      isCorrect: a.is_correct === 1,
      explanation: a.explanation,
    }));

  return {
    id: attempt.id,
    quizId: attempt.quiz_id,
    score: attempt.score,
    total: attempt.total,
    percent: attempt.total > 0 ? Math.round((attempt.score / attempt.total) * 100) : 0,
    createdAt: attempt.created_at,
    answers,
  };
}

export function insertAttempt(
  db: Database.Database,
  quizId: number,
  answers: Array<{ questionId: number; selectedIndex: number; isCorrect: boolean }>,
): number {
  const score = answers.filter((a) => a.isCorrect).length;
  const tx = db.transaction(() => {
    const info = db
      .prepare('INSERT INTO quiz_attempts (quiz_id, score, total) VALUES (?, ?, ?)')
      .run(quizId, score, answers.length);
    const attemptId = Number(info.lastInsertRowid);
    const stmt = db.prepare(
      'INSERT INTO quiz_attempt_answers (attempt_id, question_id, selected_index, is_correct) VALUES (?, ?, ?, ?)',
    );
    for (const a of answers) {
      stmt.run(attemptId, a.questionId, a.selectedIndex, a.isCorrect ? 1 : 0);
    }
    return attemptId;
  });
  return tx();
}
