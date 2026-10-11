import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AnswerInput, PracticeExamContent, QuizAttemptDetail, QuizDetail } from '../../types';
import { api } from '../../services/api';
import { useApp, useCrumbs } from '../../App';
import { mulberry32, normalizeSelected, shuffledIndexes } from '../../utils/examAnalytics';
import QuizTaker from './QuizTaker';
import PracticeRunner from './PracticeRunner';
import ModePicker, { type ExamMode } from './ModePicker';
import { answeredCount, EMPTY_SNAPSHOT, parseSession, type ExamSession, type RunSnapshot } from '../../utils/examSession';
import LoadError from '../LoadError/LoadError';
import ConfirmDialog from '../Modal/ConfirmDialog';

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
  const [retryKey, setRetryKey] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [secondsPerQuestion, setSecondsPerQuestion] = useState(settings.examSecondsPerQuestion);
  // The active run (null = mode picker) and an interrupted one to offer.
  const [run, setRun] = useState<ExamSession | null>(null);
  const [saved, setSaved] = useState<ExamSession | null>(null);
  const mode: ExamMode | null = run?.mode ?? null;
  const runRef = useRef<ExamSession | null>(null);
  // A new run requested while another is saved: confirm before replacing it.
  const [pendingStart, setPendingStart] = useState<ExamMode | null>(null);
  runRef.current = run;

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setError('');
    setRun(null);
    setSaved(null);
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
  useCrumbs(content ? [{ label: 'Practice Exams', route: { name: 'practice' } }, { label: content.title }] : null);

  // Offer to resume an interrupted run of this exact file version.
  const loadSaved = useCallback(async () => {
    if (!content) return;
    const raw = await api().practice.sessionGet(filePath).catch(() => null);
    if (raw === null) {
      setSaved(null);
      return;
    }
    const session = parseSession(raw, content.contentHash, content.questions.length);
    if (!session) void api().practice.sessionClear(filePath).catch(() => undefined);
    setSaved(session);
  }, [content, filePath]);

  useEffect(() => {
    void loadSaved();
  }, [loadSaved]);

  // The shuffle is derived from the run's seed, so a resumed run gets the
  // exact question and option order it was answered in.
  const seed = run?.seed ?? null;
  const shuffled = useMemo(() => {
    if (!content || seed === null) return null;
    return buildShuffled(content, seed);
  }, [content, seed]);

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
    return api().practice.submit(filePath, payload, flagged, content?.contentHash);
  };

  const persist = (session: ExamSession) => {
    void api().practice.sessionSave(filePath, session).catch(() => undefined);
  };

  const requestStart = (nextMode: ExamMode) => {
    if (saved) setPendingStart(nextMode);
    else startRun(nextMode);
  };

  const startRun = (nextMode: ExamMode) => {
    if (!content) return;
    setPendingStart(null);
    const now = Date.now();
    const session: ExamSession = {
      version: 1,
      mode: nextMode,
      seed: shuffle ? (Math.floor(Math.random() * 0xffffffff) >>> 0) : null,
      deadlineAt: nextMode === 'exam' ? now + content.questions.length * secondsPerQuestion * 1000 : null,
      contentHash: content.contentHash,
      startedAt: now,
      savedAt: now,
      ...EMPTY_SNAPSHOT,
    };
    // Starting afresh replaces any interrupted run of this exam.
    setSaved(null);
    setRun(session);
    persist(session);
  };

  const resumeRun = () => {
    if (!saved) return;
    setShuffle(saved.seed !== null);
    setRun(saved);
    setSaved(null);
  };

  const discardSaved = () => {
    setSaved(null);
    void api().practice.sessionClear(filePath).catch(() => undefined);
  };

  const handleProgress = (snapshot: RunSnapshot) => {
    const current = runRef.current;
    if (!current) return;
    persist({ ...current, ...snapshot, savedAt: Date.now() });
  };

  // Leaving the run (Exit, or closing the results) returns to the picker,
  // which re-reads whatever is still resumable (nothing, after a submit).
  const leaveRun = () => {
    setRun(null);
    void loadSaved();
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
          onClose={leaveRun}
          submitAnswers={submitAnswers}
          passPercent={settings.examPassPercent}
          initial={run ?? undefined}
          onProgress={handleProgress}
        />
      </div>
    );
  }

  if (mode === 'exam') {
    return (
      <div className="fade-in">
        <QuizTaker
          quiz={quiz}
          onClose={leaveRun}
          timeLimitSeconds={quiz.questions.length * secondsPerQuestion}
          deadlineAt={run?.deadlineAt ?? undefined}
          submitAnswers={submitAnswers}
          enableFlags
          passPercent={settings.examPassPercent}
          initial={run ?? undefined}
          onProgress={handleProgress}
        />
      </div>
    );
  }

  const multiCount = content.questions.filter((q) => q.correctIndices.length > 1).length;
  return (
    <>
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
        onPick={requestStart}
        onBack={backToLibrary}
        passPercent={settings.examPassPercent}
        resume={
          saved
            ? {
                mode: saved.mode,
                answered: answeredCount(saved),
                total: content.questions.length,
                deadlineAt: saved.deadlineAt,
                savedAt: saved.savedAt,
              }
            : null
        }
        onResume={resumeRun}
        onDiscard={discardSaved}
      />
      {pendingStart && saved && (
        <ConfirmDialog
          title="Start over?"
          confirmLabel={pendingStart === 'exam' ? 'Discard and start exam' : 'Discard and start practice'}
          onCancel={() => setPendingStart(null)}
          onConfirm={() => startRun(pendingStart)}
        >
          <p>
            You have {saved.mode === 'exam' ? 'an exam' : 'a practice run'} in progress with{' '}
            {answeredCount(saved)} of {content.questions.length} questions answered. Starting a new run
            discards it.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
