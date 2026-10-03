import { useEffect, useState } from 'react';
import { History, ListChecks, Pencil, PlayCircle, Plus, Trash2 } from 'lucide-react';
import type { Quiz, QuizDetail } from '../../types';
import { api } from '../../services/api';
import { useApp } from '../../App';
import QuizEditor from './QuizEditor';
import QuizTaker from './QuizTaker';
import QuizHistory from './QuizHistory';
import styles from './Quiz.module.css';

interface Props {
  courseId: number;
}

type View = 'list' | 'editor' | 'taker' | 'history';

export default function QuizManager({ courseId }: Props) {
  const { refreshKey } = useApp();
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [view, setView] = useState<View>('list');
  const [editingQuiz, setEditingQuiz] = useState<QuizDetail | null>(null);
  const [takingQuiz, setTakingQuiz] = useState<QuizDetail | null>(null);
  const [historyQuiz, setHistoryQuiz] = useState<Quiz | null>(null);

  useEffect(() => {
    api()
      .quizzes.listForCourse(courseId)
      .then(setQuizzes)
      .catch(() => undefined);
  }, [courseId, refreshKey]);

  const refresh = () => {
    api()
      .quizzes.listForCourse(courseId)
      .then(setQuizzes)
      .catch(() => undefined);
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

  const openTaker = async (quiz: Quiz) => {
    const detail = await api().quizzes.get(quiz.id);
    if (detail) {
      setTakingQuiz(detail);
      setView('taker');
    }
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
        onClose={() => {
          setTakingQuiz(null);
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
      {quizzes.length === 0 ? (
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
                <div className={styles.quizTitle}>{quiz.title}</div>
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
                  title="Edit quiz"
                  onClick={() => void openEditor(quiz)}
                >
                  <Pencil size={14} />
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  title="Delete quiz"
                  onClick={async () => {
                    await api().quizzes.remove(quiz.id);
                    refresh();
                  }}
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
    </div>
  );
}
