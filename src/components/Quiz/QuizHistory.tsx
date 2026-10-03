import { useEffect, useState } from 'react';
import { ArrowLeft, History } from 'lucide-react';
import type { Quiz, QuizAttemptSummary } from '../../types';
import { api } from '../../services/api';
import { formatDateTime } from '../../utils/format';
import styles from './Quiz.module.css';

interface Props {
  quiz: Quiz;
  onClose: () => void;
}

export default function QuizHistory({ quiz, onClose }: Props) {
  const [attempts, setAttempts] = useState<QuizAttemptSummary[]>([]);

  useEffect(() => {
    api()
      .quizzes.attempts(quiz.id)
      .then(setAttempts)
      .catch(() => undefined);
  }, [quiz.id]);

  const best = attempts.length > 0 ? Math.max(...attempts.map((a) => a.percent)) : 0;

  return (
    <div className={styles.reviewWrap}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          <ArrowLeft size={14} /> Back
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <History size={18} /> {quiz.title} — History
        </h1>
      </div>

      {attempts.length > 0 && (
        <div className="card" style={{ padding: '14px 18px', display: 'flex', gap: 24 }}>
          <div>
            <div className="muted" style={{ fontSize: 11.5 }}>Attempts</div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>{attempts.length}</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 11.5 }}>Best score</div>
            <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--accent)' }}>{best}%</div>
          </div>
          <div>
            <div className="muted" style={{ fontSize: 11.5 }}>Average</div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>
              {Math.round(attempts.reduce((s, a) => s + a.percent, 0) / attempts.length)}%
            </div>
          </div>
        </div>
      )}

      {attempts.length === 0 ? (
        <div className="card" style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
          No attempts yet. Take the quiz to see your history here.
        </div>
      ) : (
        <div className={styles.historyList}>
          {attempts.map((a) => (
            <div key={a.id} className={`card ${styles.historyRow}`}>
              <span
                className={styles.historyScore}
                style={{ color: a.percent >= 70 ? 'var(--success)' : 'var(--danger)' }}
              >
                {a.percent}%
              </span>
              <span className="secondary" style={{ fontSize: 13 }}>
                {a.score}/{a.total} correct
              </span>
              <span className={styles.historyDate}>{formatDateTime(a.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
