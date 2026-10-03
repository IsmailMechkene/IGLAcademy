import { CheckCircle2, XCircle, ArrowLeft, Lightbulb } from 'lucide-react';
import type { QuizAttemptDetail } from '../../types';
import styles from './Quiz.module.css';

interface Props {
  attempt: QuizAttemptDetail;
  quizTitle: string;
  onClose: () => void;
}

export default function QuizReview({ attempt, quizTitle, onClose }: Props) {
  const passed = attempt.percent >= 70;

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
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {attempt.answers.map((a, i) => (
          <div key={a.questionId} className={`card ${styles.reviewQuestion} ${a.isCorrect ? styles.correct : styles.incorrect}`}>
            <div className={styles.reviewQuestionText}>
              {i + 1}. {a.question}
            </div>
            <div className={styles.answerRow}>
              {a.isCorrect ? (
                <CheckCircle2 size={15} color="var(--success)" style={{ flexShrink: 0, marginTop: 2 }} />
              ) : (
                <XCircle size={15} color="var(--danger)" style={{ flexShrink: 0, marginTop: 2 }} />
              )}
              <div>
                <div className={styles.answerLabel}>Your answer</div>
                <div style={{ color: a.isCorrect ? 'var(--success)' : 'var(--danger)' }}>
                  {a.options[a.selectedIndex] ?? '(no answer)'}
                </div>
              </div>
            </div>
            {!a.isCorrect && (
              <div className={styles.answerRow}>
                <CheckCircle2 size={15} color="var(--success)" style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <div className={styles.answerLabel}>Correct answer</div>
                  <div style={{ color: 'var(--success)' }}>{a.options[a.correctIndex]}</div>
                </div>
              </div>
            )}
            {a.explanation && (
              <div className={styles.explanation}>
                <Lightbulb size={13} style={{ display: 'vertical-align', marginRight: 5 }} />
                {a.explanation}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
