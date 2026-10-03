import { useState } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react';
import type { QuizDetail, QuizAttemptDetail } from '../../types';
import { api } from '../../services/api';
import QuizReview from './QuizReview';
import styles from './Quiz.module.css';

interface Props {
  quiz: QuizDetail;
  onClose: () => void;
}

export default function QuizTaker({ quiz, onClose }: Props) {
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Map<number, number>>(new Map());
  const [result, setResult] = useState<QuizAttemptDetail | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const question = quiz.questions[current];
  const total = quiz.questions.length;
  const selected = answers.get(question.id);
  const isLast = current === total - 1;
  const allAnswered = quiz.questions.every((q) => answers.has(q.id));

  const select = (optionIndex: number) => {
    setAnswers((prev) => new Map(prev).set(question.id, optionIndex));
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const payload = quiz.questions.map((q) => ({
        questionId: q.id,
        selectedIndex: answers.get(q.id) ?? 0,
      }));
      const attemptId = await api().quizzes.submitAttempt(quiz.id, payload);
      const detail = await api().quizzes.attemptDetail(attemptId);
      setResult(detail);
    } catch {
      setSubmitting(false);
    }
  };

  if (result) {
    return <QuizReview attempt={result} quizTitle={quiz.title} onClose={onClose} />;
  }

  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];

  return (
    <div className={styles.takerWrap}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          <ArrowLeft size={14} /> Exit
        </button>
        <div style={{ flex: 1 }}>
          <div className={styles.progressBar}>
            <div
              className={styles.progressFill}
              style={{ width: `${((current + 1) / total) * 100}%` }}
            />
          </div>
        </div>
        <span className="muted" style={{ fontSize: 13 }}>
          {current + 1} / {total}
        </span>
      </div>

      <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{quiz.title}</h1>
      {quiz.description && <p className="secondary" style={{ margin: 0 }}>{quiz.description}</p>}

      <div className={`card ${styles.questionCard}`}>
        <div className={styles.questionText}>{question.question}</div>
        <div className={styles.options}>
          {question.options.map((opt, oi) => (
            <button
              key={oi}
              className={`${styles.optionBtn} ${selected === oi ? styles.selected : ''}`}
              onClick={() => select(oi)}
            >
              <span className={styles.optionLetter}>{letters[oi]}</span>
              {opt}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.takerNav}>
        <button
          className="btn btn-ghost"
          disabled={current === 0}
          onClick={() => setCurrent((c) => c - 1)}
        >
          <ArrowLeft size={15} /> Previous
        </button>
        {isLast ? (
          <button className="btn btn-primary" disabled={!allAnswered || submitting} onClick={submit}>
            <CheckCircle2 size={16} />
            {submitting ? 'Submitting...' : 'Submit quiz'}
          </button>
        ) : (
          <button
            className="btn btn-primary"
            disabled={selected === undefined}
            onClick={() => setCurrent((c) => c + 1)}
          >
            Next <ArrowRight size={15} />
          </button>
        )}
      </div>
      {!allAnswered && isLast && (
        <p className="muted" style={{ fontSize: 12.5, textAlign: 'center', margin: 0 }}>
          Answer all questions to submit.
        </p>
      )}
    </div>
  );
}
