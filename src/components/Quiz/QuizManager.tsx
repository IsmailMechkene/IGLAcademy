import { useEffect, useRef, useState } from 'react';
import { History, Layers, ListChecks, Pencil, PlayCircle, Plus, Trash2 } from 'lucide-react';
import type { Quiz, QuizDetail } from '../../types';
import { api } from '../../services/api';
import { useApp } from '../../App';
import QuizEditor from './QuizEditor';
import QuizTaker from './QuizTaker';
import QuizHistory from './QuizHistory';
import LoadError from '../LoadError/LoadError';
import ConfirmDialog from '../Modal/ConfirmDialog';
import Modal from '../Modal/Modal';
import { answeredCount, EMPTY_SNAPSHOT, parseSession, type ExamSession, type RunSnapshot } from '../../utils/examSession';
import { timeAgo } from '../../utils/format';
import styles from './Quiz.module.css';

interface Props {
  courseId: number;
}

/**
 * Identifies the exact quiz a saved run was answered against; editing the
 * quiz changes it (the main process also drops the run on edit).
 */
function quizVersion(quiz: QuizDetail): string {
  return `${quiz.updatedAt}|${quiz.questions.map((q) => q.id).join(',')}`;
}

function readSession(raw: unknown, quiz: QuizDetail): ExamSession | null {
  return parseSession(raw, quizVersion(quiz), quiz.questions.length, new Set(quiz.questions.map((q) => q.id)));
}

type View = 'list' | 'editor' | 'taker' | 'history';

export default function QuizManager({ courseId }: Props) {
  const { refreshKey, settings } = useApp();
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [view, setView] = useState<View>('list');
  const [editingQuiz, setEditingQuiz] = useState<QuizDetail | null>(null);
  const [takingQuiz, setTakingQuiz] = useState<QuizDetail | null>(null);
  const [historyQuiz, setHistoryQuiz] = useState<Quiz | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Quiz | null>(null);
  // Saved, unfinished runs: which quizzes have one, and the one being offered.
  const [inProgress, setInProgress] = useState<Set<number>>(new Set());
  const [offer, setOffer] = useState<{ quiz: QuizDetail; session: ExamSession } | null>(null);
  const [run, setRun] = useState<ExamSession | null>(null);
  const runRef = useRef<ExamSession | null>(null);
  runRef.current = run;

  const loadQuizzes = () => {
    setLoadError(false);
    api()
      .quizzes.listForCourse(courseId)
      .then((q) => setQuizzes(q))
      .catch(() => setLoadError(true));
  };

  useEffect(loadQuizzes, [courseId, refreshKey]);

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      quizzes.map((q) => api().quizzes.sessionGet(q.id).then((raw) => (raw ? q.id : null)).catch(() => null)),
    ).then((ids) => {
      if (!cancelled) setInProgress(new Set(ids.filter((id): id is number => id !== null)));
    });
    return () => {
      cancelled = true;
    };
  }, [quizzes]);

  const refresh = () => {
    setLoadError(false);
    api()
      .quizzes.listForCourse(courseId)
      .then((q) => setQuizzes(q))
      .catch(() => setLoadError(true));
  };

  const openEditor = async (quiz: Quiz | null) => {
    if (!quiz) {
      setEditingQuiz(null);
      setView('editor');
      return;
    }
    const detail = await api().quizzes.get(quiz.id);
    if (detail) {
      setEditingQuiz(detail);
      setView('editor');
    }
  };

  const startQuiz = (detail: QuizDetail, session: ExamSession | null) => {
    const now = Date.now();
    const next: ExamSession = session ?? {
      version: 1,
      // Course quizzes are untimed: stored as a "practice" run with no deadline.
      mode: 'practice',
      seed: null,
      deadlineAt: null,
      contentHash: quizVersion(detail),
      startedAt: now,
      savedAt: now,
      ...EMPTY_SNAPSHOT,
    };
    setOffer(null);
    setRun(next);
    setTakingQuiz(detail);
    setView('taker');
  };

  const openTaker = async (quiz: Quiz) => {
    const detail = await api().quizzes.get(quiz.id);
    if (!detail) return;
    const raw = await api().quizzes.sessionGet(quiz.id).catch(() => null);
    const session = raw ? readSession(raw, detail) : null;
    if (raw && !session) void api().quizzes.sessionClear(quiz.id).catch(() => undefined);
    if (session && answeredCount(session) > 0) setOffer({ quiz: detail, session });
    else startQuiz(detail, null);
  };

  const handleProgress = (snapshot: RunSnapshot) => {
    const current = runRef.current;
    if (!current || !takingQuiz) return;
    void api()
      .quizzes.sessionSave(takingQuiz.id, { ...current, ...snapshot, savedAt: Date.now() })
      .catch(() => undefined);
  };

  if (view === 'editor') {
    return (
      <QuizEditor
        courseId={courseId}
        quiz={editingQuiz}
        onClose={() => {
          setEditingQuiz(null);
          setView('list');
          refresh();
        }}
      />
    );
  }

  if (view === 'taker' && takingQuiz) {
    return (
      <QuizTaker
        quiz={takingQuiz}
        passPercent={settings.examPassPercent}
        initial={run ?? undefined}
        onProgress={handleProgress}
        onClose={() => {
          setTakingQuiz(null);
          setRun(null);
          setView('list');
          refresh();
        }}
      />
    );
  }

  if (view === 'history' && historyQuiz) {
    return (
      <QuizHistory
        quiz={historyQuiz}
        onClose={() => {
          setHistoryQuiz(null);
          setView('list');
        }}
      />
    );
  }

  return (
    <div className={styles.quizList}>
      {loadError ? (
        <LoadError message="Could not load quizzes." onRetry={loadQuizzes} />
      ) : quizzes.length === 0 ? (
        <div className={styles.emptyQuizzes}>
          <ListChecks size={22} style={{ opacity: 0.4, marginBottom: 4 }} />
          <div>No quizzes for this course yet.</div>
          <div style={{ marginTop: 10 }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => void openEditor(null)}
            >
              <Plus size={14} /> Create the first quiz
            </button>
          </div>
        </div>
      ) : (
        <>
          {quizzes.map((quiz) => (
            <div key={quiz.id} className={`card ${styles.quizRow}`}>
              <div className={styles.quizInfo}>
                <div className={styles.quizTitle}>
                  {quiz.title}
                  {inProgress.has(quiz.id) && <span className="badge" style={{ marginLeft: 8 }}>In progress</span>}
                </div>
                <div className={styles.quizMeta}>
                  <span>{quiz.questionCount} questions</span>
                  {quiz.sectionTitle && (
                    <>
                      <span>·</span>
                      <span>{quiz.sectionTitle}</span>
                    </>
                  )}
                </div>
              </div>
              <div className={styles.quizActions}>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => void openTaker(quiz)}
                >
                  <PlayCircle size={14} /> Take
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  title="Quiz history"
                  onClick={() => {
                    setHistoryQuiz(quiz);
                    setView('history');
                  }}
                >
                  <History size={14} />
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  title="Make flashcards from this quiz"
                  aria-label={`Make flashcards from ${quiz.title}`}
                  onClick={async () => {
                    try {
                      await api().flashcards.fromQuiz({ courseId, quizId: quiz.id });
                      await api().app.showError('Flashcards created', `A deck was created from "${quiz.title}". Open it from the Review page.`);
                    } catch (err) {
                      await api().app.showError('Could not create deck', err instanceof Error ? err.message : 'Unknown error');
                    }
                  }}
                >
                  <Layers size={14} />
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  title="Edit quiz"
                  onClick={() => void openEditor(quiz)}
                >
                  <Pencil size={14} />
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  title="Delete quiz"
                  onClick={() => setConfirmDelete(quiz)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
          <div>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => void openEditor(null)}
            >
              <Plus size={14} /> New quiz
            </button>
          </div>
        </>
      )}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete quiz?"
          confirmLabel="Delete quiz"
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            await api().quizzes.remove(confirmDelete.id);
            setConfirmDelete(null);
            refresh();
          }}
        >
          <p>
            <strong>{confirmDelete.title}</strong> and its whole attempt history will be deleted.
            This cannot be undone.
          </p>
        </ConfirmDialog>
      )}
      {offer && (
        <Modal label="Resume quiz" onClose={() => setOffer(null)}>
          <h2>Resume this quiz?</h2>
          <p>
            You answered {answeredCount(offer.session)} of {offer.quiz.questions.length} questions in{' '}
            <strong>{offer.quiz.title}</strong> — saved {timeAgo(new Date(offer.session.savedAt).toISOString())}.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button
              className="btn btn-ghost"
              onClick={() => {
                void api().quizzes.sessionClear(offer.quiz.id).catch(() => undefined);
                startQuiz(offer.quiz, null);
              }}
            >
              Start over
            </button>
            <button className="btn btn-primary" data-autofocus onClick={() => startQuiz(offer.quiz, offer.session)}>
              Resume
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
