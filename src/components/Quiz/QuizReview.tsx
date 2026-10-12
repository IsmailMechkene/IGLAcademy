import { useState } from 'react';
import { CheckCircle2, XCircle, ArrowLeft, Clock, Layers } from 'lucide-react';
import { useApp } from '../../App';
import type { QuizAttemptDetail } from '../../types';
import ExplanationBlock from './ExplanationBlock';
import styles from './Quiz.module.css';

type ReviewFilter = 'all' | 'incorrect' | 'flagged';

interface Props {
  attempt: QuizAttemptDetail;
  quizTitle: string;
  onClose: () => void;
  /** Pass mark percent (default 70). */
  passPercent?: number;
  /** Pre-select a review filter (e.g. from exam analytics). */
  initialFilter?: ReviewFilter;
}

export default function QuizReview({ attempt, quizTitle, onClose, passPercent = 70, initialFilter = 'all' }: Props) {
  const passed = attempt.percent >= passPercent;
  const flaggedIds = new Set(attempt.flagged ?? []);
  const incorrectCount = attempt.answers.filter((a) => !a.isCorrect).length;
  const [filter, setFilter] = useState<ReviewFilter>(initialFilter);
  const showFilters = incorrectCount > 0 || flaggedIds.size > 0;

  const visible = attempt.answers.filter((a, i) => {
    if (filter === 'incorrect' && a.isCorrect) return false;
    if (filter === 'flagged' && !flaggedIds.has(a.questionId) && !flaggedIds.has(i)) return false;
    return true;
  });

  const filterBtn = (value: ReviewFilter, label: string, count: number | null) => (
    <button
      key={value}
      type="button"
      className={`btn btn-sm ${filter === value ? 'btn-primary' : 'btn-ghost'}`}
      aria-pressed={filter === value}
      onClick={() => setFilter(value)}
    >
      {label}
      {count !== null && <span className="muted"> {count}</span>}
    </button>
  );

  return (
    <div className={styles.reviewWrap}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          <ArrowLeft size={14} /> Back
        </button>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{quizTitle}</h1>
      </div>

      <div className={`card ${styles.scoreCard}`}>
        <div className={`${styles.scoreCircle} ${passed ? styles.pass : styles.fail}`}>
          {attempt.percent}%
        </div>
        <div className={styles.scoreInfo}>
          <h2>{passed ? 'Well done!' : 'Keep practicing'}</h2>
          <p className="secondary" style={{ margin: 0 }}>
            You answered {attempt.score} of {attempt.total} questions correctly.
            Passing score is {passPercent}%.
          </p>
        </div>
      </div>

      {(attempt.mistakesAdded ?? 0) > 0 && <MistakesNotice count={attempt.mistakesAdded ?? 0} />}

      {showFilters && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }} role="group" aria-label="Filter reviewed questions">
          {filterBtn('all', 'All', attempt.answers.length)}
          {filterBtn('incorrect', 'Incorrect', incorrectCount)}
          {flaggedIds.size > 0 && filterBtn('flagged', 'Flagged', flaggedIds.size)}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {visible.map((a) => {
          const i = attempt.answers.indexOf(a);
          return (
          <div key={a.questionId} className={`card ${styles.reviewQuestion} ${a.isCorrect ? styles.correct : styles.incorrect}`}>
            <div className={styles.reviewQuestionText}>
              {i + 1}. {a.question}
              {typeof a.seconds === 'number' && a.seconds > 0 && (
                <span className={styles.timeChip} title="Time spent on this question">
                  <Clock size={12} /> {a.seconds < 60 ? `${Math.round(a.seconds)}s` : `${Math.floor(a.seconds / 60)}m ${Math.round(a.seconds % 60)}s`}
                </span>
              )}
            </div>
            <div className={styles.answerRow}>
              {a.isCorrect ? (
                <CheckCircle2 size={15} color="var(--success)" style={{ flexShrink: 0, marginTop: 2 }} />
              ) : (
                <XCircle size={15} color="var(--danger)" style={{ flexShrink: 0, marginTop: 2 }} />
              )}
              <div>
                <div className={styles.answerLabel}>
                  {a.selectedIndices.length > 1 ? 'Your answers' : 'Your answer'}
                </div>
                <div style={{ color: a.isCorrect ? 'var(--success)' : 'var(--danger)' }}>
                  {a.selectedIndices.length > 0
                    ? a.selectedIndices.map((i) => a.options[i] ?? '(no answer)').join(' · ')
                    : '(no answer)'}
                </div>
              </div>
            </div>
            {!a.isCorrect && (
              <div className={styles.answerRow}>
                <CheckCircle2 size={15} color="var(--success)" style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <div className={styles.answerLabel}>
                    {a.correctIndices.length > 1 ? 'Correct answers' : 'Correct answer'}
                  </div>
                  <div style={{ color: 'var(--success)' }}>
                    {a.correctIndices.map((i) => a.options[i]).join(' · ')}
                  </div>
                </div>
              </div>
            )}
            {a.explanation && <ExplanationBlock text={a.explanation} />}
          </div>
          );
        })}
        {visible.length === 0 && (
          <div className="card muted" style={{ padding: 24, textAlign: 'center' }}>
            No questions match this filter.
          </div>
        )}
      </div>
    </div>
  );
}

/** After a file exam: wrong answers were turned into flashcards. */
function MistakesNotice({ count }: { count: number }) {
  const { navigate } = useApp();
  return (
    <div className={`card ${styles.mistakesNotice}`} role="status">
      <span className={styles.mistakesIcon}><Layers size={20} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className={styles.mistakesTitle}>
          {count} question{count === 1 ? '' : 's'} added to your mistakes deck
        </div>
        <div className={styles.mistakesText}>
          Spaced repetition will bring {count === 1 ? 'it' : 'them'} back until you know {count === 1 ? 'it' : 'them'}.
        </div>
      </div>
      <button className="btn btn-primary" onClick={() => navigate({ name: 'review' })}>
        Review now
      </button>
    </div>
  );
}
