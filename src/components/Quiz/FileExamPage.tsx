import { useEffect, useMemo, useState } from 'react';
import type { AnswerInput, PracticeExamContent, QuizAttemptDetail, QuizDetail } from '../../types';
import { api } from '../../services/api';
import { useApp } from '../../App';
import { mulberry32, normalizeSelected, shuffledIndexes } from '../../utils/examAnalytics';
import QuizTaker from './QuizTaker';
import PracticeRunner from './PracticeRunner';
import ModePicker, { type ExamMode } from './ModePicker';
import LoadError from '../LoadError/LoadError';

interface Props {
  filePath: string;
}

/** Builds a shuffled run: display order + per-question display→original maps. */
function buildShuffled(content: PracticeExamContent, seed: number): {
  questions: QuizDetail['questions'];
  optionOrders: Record<number, number[]>;
} {
  const rand = mulberry32(seed);
  const order = shuffledIndexes(content.questions.length, rand);
  const optionOrders: Record<number, number[]> = {};
  const questions = order.map((qi, position) => {
    const q = content.questions[qi];
    const optionOrder = shuffledIndexes(q.options.length, rand);
    optionOrders[qi] = optionOrder;
    return {
      id: qi,
      quizId: -1,
      question: q.question,
      options: optionOrder.map((o) => q.options[o]),
      correctIndex: optionOrder.indexOf(q.correctIndices[0] ?? 0),
      correctIndices: q.correctIndices.map((ci) => optionOrder.indexOf(ci)).sort((a, b) => a - b),
      explanation: q.explanation,
      position: position + 1,
    };
  });
  return { questions, optionOrders };
}

/** Full-page native exam runner for a practice file (parsed live, never imported). */
export default function FileExamPage({ filePath }: Props) {
  const { navigate, settings } = useApp();
  const [content, setContent] = useState<PracticeExamContent | null>(null);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<ExamMode | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [secondsPerQuestion, setSecondsPerQuestion] = useState(settings.examSecondsPerQuestion);
  const [runSeed, setRunSeed] = useState(0);

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
  }, [filePath, retryKey]);

  const backToLibrary = () => navigate({ name: 'practice' });

  const shuffled = useMemo(() => {
    if (!content) return null;
    if (!shuffle) return null;
    return buildShuffled(content, (Date.now() ^ runSeed) >>> 0);
  }, [content, shuffle, runSeed]);

  const quiz: QuizDetail | null = useMemo(() => {
    if (!content) return null;
    const questions = shuffled ? shuffled.questions : content.questions.map((q, i) => ({
      id: i,
      quizId: -1,
      question: q.question,
      options: q.options,
      correctIndex: q.correctIndices[0] ?? 0,
      correctIndices: q.correctIndices,
      explanation: q.explanation,
      position: i + 1,
    }));
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
      questions,
    };
  }, [content, shuffled]);

  const submitAnswers = async (
    answers: AnswerInput[],
    timings: Record<number, number>,
    flagged: number[],
  ): Promise<QuizAttemptDetail | null> => {
    if (!quiz) return null;
    // `q.id` is the question's index in the FILE, which survives shuffling —
    // both the option remapping and `questionIndex` are keyed on it, so the
    // main process scores every answer against the question it belongs to.
    const payload = quiz.questions.map((q) => {
      const ans = answers.find((a) => a.questionId === q.id);
      const displaySel = ans?.selectedIndices ?? [];
      const order = shuffled?.optionOrders[q.id];
      const selected = order ? normalizeSelected(displaySel, order) : [...displaySel].sort((a, b) => a - b);
      return { questionIndex: q.id, selected, seconds: timings[q.id] ?? 0 };
    });
    return api().practice.submit(filePath, payload, flagged);
  };

  const startRun = (nextMode: ExamMode) => {
    setRunSeed((s) => s + 1);
    setMode(nextMode);
  };

  if (error) {
    return (
      <div style={{ padding: 48, maxWidth: 560, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
        <LoadError message={`Could not load this exam. ${error}`} onRetry={() => setRetryKey((k) => k + 1)} />
        <button className="btn btn-ghost" onClick={backToLibrary}>
          Back to Practice Exams
        </button>
      </div>
    );
  }

  if (!quiz || !content) {
    return <div className="muted" style={{ padding: 48 }}>Loading exam...</div>;
  }

  if (mode === 'practice') {
    return (
      <div className="fade-in">
        <PracticeRunner
          quiz={quiz}
          onClose={() => setMode(null)}
          submitAnswers={submitAnswers}
          passPercent={settings.examPassPercent}
        />
      </div>
    );
  }

  if (mode === 'exam') {
    return (
      <div className="fade-in">
        <QuizTaker
          quiz={quiz}
          onClose={() => setMode(null)}
          timeLimitSeconds={quiz.questions.length * secondsPerQuestion}
          submitAnswers={submitAnswers}
          enableFlags
          passPercent={settings.examPassPercent}
        />
      </div>
    );
  }

  const multiCount = content.questions.filter((q) => q.correctIndices.length > 1).length;
  return (
    <ModePicker
      title={content.title}
      description={content.description}
      questionCount={content.questions.length}
      multiCount={multiCount}
      timeLimitMinutes={Math.round((content.questions.length * secondsPerQuestion) / 60)}
      shuffle={shuffle}
      onToggleShuffle={() => setShuffle((s) => !s)}
      secondsPerQuestion={secondsPerQuestion}
      onPickDuration={setSecondsPerQuestion}
      onPick={startRun}
      onBack={backToLibrary}
      passPercent={settings.examPassPercent}
    />
  );
}
