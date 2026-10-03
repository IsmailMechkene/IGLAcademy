import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Flag, Timer } from 'lucide-react';
import type { QuizDetail, QuizAttemptDetail, AnswerInput } from '../../types';
import { api } from '../../services/api';
import { formatCountdown } from '../../utils/format';
import QuizReview from './QuizReview';
import styles from './Quiz.module.css';

interface Props {
  quiz: QuizDetail;
  onClose: () => void;
  /** When set, the quiz runs as a timed exam with a navigator. */
  timeLimitSeconds?: number;
  /** Overrides the default submit pipeline (used for file-based exams). */
  submitAnswers?: (answers: AnswerInput[]) => Promise<QuizAttemptDetail | null>;
}

export default function QuizTaker({ quiz, onClose, timeLimitSeconds, submitAnswers }: Props) {
  const timed = timeLimitSeconds !== undefined && timeLimitSeconds > 0;
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Map<number, number[]>>(new Map());
  const [flagged, setFlagged] = useState<Set<number>>(new Set());
  const [secondsLeft, setSecondsLeft] = useState(timeLimitSeconds ?? 0);
  const [result, setResult] = useState<QuizAttemptDetail | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const question = quiz.questions[current];
  const total = quiz.questions.length;
  const multi = question.correctIndices.length > 1;
  const selected = answers.get(question.id) ?? [];
  const isLast = current === total - 1;
  const allAnswered = quiz.questions.every((q) => (answers.get(q.id) ?? []).length > 0);

  const toggle = (optionIndex: number) => {
    setAnswers((prev) => {
      const next = new Map(prev);
      const cur = next.get(question.id) ?? [];
      if (multi) {
        next.set(
          question.id,
          cur.includes(optionIndex) ? cur.filter((x) => x !== optionIndex) : [...cur, optionIndex],
        );
      } else {
        next.set(question.id, [optionIndex]);
      }
      return next;
    });
  };

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const payload = quiz.questions.map((q) => {
        const sel = answers.get(q.id) ?? [];
        return { questionId: q.id, selectedIndex: sel[0] ?? -1, selectedIndices: sel };
      });
      const detail = submitAnswers
        ? await submitAnswers(payload)
        : await api()
          .quizzes.submitAttempt(quiz.id, payload)
          .then((attemptId) => api().quizzes.attemptDetail(attemptId));
      setResult(detail);
    } catch {
      setSubmitting(false);
    }
  };

  const submitRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    submitRef.current = submit;
  });

  // Countdown for timed exams; auto-submits once at zero.
  useEffect(() => {
    if (!timed || timeLimitSeconds === undefined) return;
    setSecondsLeft(timeLimitSeconds);
    const id = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(id);
          void submitRef.current();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timed, timeLimitSeconds, quiz.id]);

  const toggleFlag = () => {
    setFlagged((prev) => {
      const next = new Set(prev);
      if (next.has(question.id)) next.delete(question.id);
      else next.add(question.id);
      return next;
    });
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

      {timed && (
        <div className={styles.examBar}>
          <span
            className={`${styles.timer} ${timeLimitSeconds !== undefined && secondsLeft < timeLimitSeconds * 0.1 ? styles.timerUrgent : ''}`}
            role="timer"
            aria-label={`Time remaining: ${formatCountdown(secondsLeft)}`}
          >
            <Timer size={15} />
            {formatCountdown(secondsLeft)}
          </span>
          <span className="muted" style={{ fontSize: 12.5 }}>
            {flagged.size > 0 ? `${flagged.size} flagged` : 'Answers hidden until submit'}
          </span>
        </div>
      )}

      {timed && (
        <div className={styles.navigator} role="group" aria-label="Question navigator">
          {quiz.questions.map((q, i) => {
            const answered = (answers.get(q.id) ?? []).length > 0;
            const isFlagged = flagged.has(q.id);
            const isCurrent = i === current;
            return (
              <button
                key={q.id}
                type="button"
                className={`${styles.navDot} ${answered ? styles.navAnswered : ''} ${isFlagged ? styles.navFlagged : ''} ${isCurrent ? styles.navCurrent : ''}`}
                aria-label={`Question ${i + 1}${answered ? ', answered' : ', unanswered'}${isFlagged ? ', flagged' : ''}`}
                aria-current={isCurrent}
                onClick={() => setCurrent(i)}
              >
                {isFlagged ? <Flag size={11} /> : <span>{i + 1}</span>}
              </button>
            );
          })}
        </div>
      )}

      <div className={`card ${styles.questionCard}`}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div className={styles.questionText}>{question.question}</div>
          {timed && (
            <button
              type="button"
              className={`btn btn-ghost btn-sm ${flagged.has(question.id) ? styles.flagActive : ''}`}
              aria-pressed={flagged.has(question.id)}
              onClick={toggleFlag}
              title={flagged.has(question.id) ? 'Remove flag' : 'Flag for review'}
            >
              <Flag size={14} />
              {flagged.has(question.id) ? 'Flagged' : 'Flag'}
            </button>
          )}
        </div>
        {multi && (
          <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
            Select all that apply — every correct option is required.
          </p>
        )}
        <div className={styles.options}>
          {question.options.map((opt, oi) => {
            const isSelected = selected.includes(oi);
            return (
              <button
                key={oi}
                className={`${styles.optionBtn} ${isSelected ? styles.selected : ''}`}
                aria-pressed={isSelected}
                onClick={() => toggle(oi)}
              >
                <span className={styles.optionLetter}>{letters[oi]}</span>
                <span style={{ flex: 1 }}>{opt}</span>
                {multi && isSelected && <Check size={16} aria-hidden="true" />}
              </button>
            );
          })}
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
            disabled={selected.length === 0}
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
