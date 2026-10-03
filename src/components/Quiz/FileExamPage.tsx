import { useEffect, useMemo, useState } from 'react';
import type { AnswerInput, PracticeExamContent, QuizAttemptDetail, QuizDetail } from '../../types';
import { api } from '../../services/api';
import { useApp } from '../../App';
import QuizTaker from './QuizTaker';
import PracticeRunner from './PracticeRunner';
import ModePicker, { type ExamMode } from './ModePicker';

/** AWS-style pacing: 2 minutes per question (65 questions = 130 minutes). */
export const EXAM_SECONDS_PER_QUESTION = 120;

interface Props {
  filePath: string;
}

/** Full-page native exam runner for a practice file (parsed live, never imported). */
export default function FileExamPage({ filePath }: Props) {
  const { navigate } = useApp();
  const [content, setContent] = useState<PracticeExamContent | null>(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<ExamMode | null>(null);

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setError('');
    setMode(null);
    api()
      .practice.load(filePath)
      .then((c) => {
        if (!cancelled) setContent(c);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load this exam.');
      });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const backToLibrary = () => navigate({ name: 'practice' });

  const quiz: QuizDetail | null = useMemo(() => {
    if (!content) return null;
    return {
      id: -1,
      courseId: -1,
      sectionId: null,
      sectionTitle: null,
      sourceLessonId: null,
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
  }, [content]);

  const submitAnswers = async (answers: AnswerInput[]): Promise<QuizAttemptDetail | null> => {
    if (!quiz) return null;
    const selections = quiz.questions.map(
      (q) => answers.find((a) => a.questionId === q.id)?.selectedIndices ?? [],
    );
    return api().practice.submit(filePath, selections);
  };

  if (error) {
    return (
      <div style={{ padding: 48, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>Could not load this exam</h1>
        <p className="secondary" style={{ margin: 0 }}>{error}</p>
        <button className="btn btn-ghost" onClick={backToLibrary}>
          Back to Practice Exams
        </button>
      </div>
    );
  }

  if (!quiz) {
    return <div className="muted" style={{ padding: 48 }}>Loading exam...</div>;
  }

  if (mode === 'practice') {
    return (
      <div className="fade-in">
        <PracticeRunner quiz={quiz} onClose={() => setMode(null)} submitAnswers={submitAnswers} />
      </div>
    );
  }

  if (mode === 'exam') {
    return (
      <div className="fade-in">
        <QuizTaker
          quiz={quiz}
          onClose={() => setMode(null)}
          timeLimitSeconds={quiz.questions.length * EXAM_SECONDS_PER_QUESTION}
          submitAnswers={submitAnswers}
        />
      </div>
    );
  }

  return (
    <ModePicker
      title={quiz.title}
      description={quiz.description}
      questionCount={quiz.questions.length}
      multiCount={quiz.questions.filter((q) => q.correctIndices.length > 1).length}
      timeLimitMinutes={Math.round((quiz.questions.length * EXAM_SECONDS_PER_QUESTION) / 60)}
      onPick={setMode}
      onBack={backToLibrary}
    />
  );
}
