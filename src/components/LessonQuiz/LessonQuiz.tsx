import { useEffect, useMemo, useState } from 'react';
import type { AnswerInput, PracticeExamContent, QuizAttemptDetail, QuizDetail } from '../../types';
import { api } from '../../services/api';
import PracticeRunner from '../Quiz/PracticeRunner';
import PracticeViewer from '../PracticeViewer/PracticeViewer';
import styles from './LessonQuiz.module.css';

interface Props {
  lessonId: number;
  /** media:// URL of the page, for the plain preview when it is not a quiz. */
  src: string;
  title: string;
  /** Called once the quiz is finished (the lesson is then marked complete). */
  onFinished: () => void;
}

function toQuizDetail(content: PracticeExamContent, lessonId: number): QuizDetail {
  return {
    id: -1,
    courseId: 0,
    sectionId: null,
    sectionTitle: null,
    sourceLessonId: lessonId,
    title: content.title,
    description: content.description,
    createdAt: '',
    updatedAt: '',
    questionCount: content.questions.length,
    questions: content.questions.map((q, i) => ({
      id: i,
      quizId: -1,
      question: q.question,
      options: q.options,
      correctIndex: q.correctIndices[0] ?? 0,
      correctIndices: q.correctIndices,
      explanation: q.explanation,
      position: i + 1,
    })),
  };
}

function sameSet(a: number[], b: number[]): boolean {
  const sb = [...b].sort((x, y) => x - y);
  return a.length === b.length && [...a].sort((x, y) => x - y).every((v, i) => v === sb[i]);
}

/** Scores a run in the renderer: lecture quizzes keep no attempt history. */
function scoreRun(quiz: QuizDetail, answers: AnswerInput[]): QuizAttemptDetail {
  const byId = new Map(answers.map((a) => [a.questionId, a]));
  const graded = quiz.questions.map((q) => {
    const selectedIndices = byId.get(q.id)?.selectedIndices ?? [];
    return {
      questionId: q.id,
      question: q.question,
      options: q.options,
      correctIndex: q.correctIndex,
      correctIndices: q.correctIndices,
      selectedIndex: selectedIndices[0] ?? -1,
      selectedIndices,
      isCorrect: sameSet(selectedIndices, q.correctIndices),
      explanation: q.explanation,
    };
  });
  const score = graded.filter((a) => a.isCorrect).length;
  return {
    id: -1,
    quizId: -1,
    score,
    total: graded.length,
    percent: graded.length > 0 ? Math.round((score / graded.length) * 100) : 0,
    createdAt: new Date().toISOString(),
    answers: graded,
  };
}

/**
 * A lecture quiz (an HTML page embedding quizData) run natively, with the
 * same instant-feedback flow as practice mode. Any other HTML page falls back
 * to the sandboxed preview.
 */
export default function LessonQuiz({ lessonId, src, title, onFinished }: Props) {
  const [content, setContent] = useState<PracticeExamContent | null | undefined>(undefined);
  // Bumped to restart the quiz from the first question.
  const [run, setRun] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setContent(undefined);
    api()
      .media.lessonQuiz(lessonId)
      .then((c) => !cancelled && setContent(c))
      .catch(() => !cancelled && setContent(null));
    return () => {
      cancelled = true;
    };
  }, [lessonId]);

  const quiz = useMemo(() => (content ? toQuizDetail(content, lessonId) : null), [content, lessonId]);

  if (content === undefined) return <div className={styles.wrap} aria-busy="true" />;
  if (!quiz) return <PracticeViewer src={src} title={title} lessonId={lessonId} />;

  return (
    <div className={styles.wrap}>
      <PracticeRunner
        key={run}
        quiz={quiz}
        onClose={() => setRun((r) => r + 1)}
        submitAnswers={async (answers) => {
          onFinished();
          return scoreRun(quiz, answers);
        }}
      />
    </div>
  );
}
