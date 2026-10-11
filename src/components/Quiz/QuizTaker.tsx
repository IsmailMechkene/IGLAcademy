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
  submitAnswers?: (
    answers: AnswerInput[],
    timings: Record<number, number>,
    flagged: number[],
  ) => Promise<QuizAttemptDetail | null>;
  /** Show flag-for-review controls even when untimed. */
  enableFlags?: boolean;
  /** Pass mark percent shown in review (default 70). */
  passPercent?: number;
}

export default function QuizTaker({ quiz, onClose, timeLimitSeconds, submitAnswers, enableFlags, passPercent = 70 }: Props) {
  const timed = timeLimitSeconds !== undefined && timeLimitSeconds > 0;
  const flaggable = timed || enableFlags === true;
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Map<number, number[]>>(new Map());
  const [flagged, setFlagged] = useState<Set<number>>(new Set());
  const [secondsLeft, setSecondsLeft] = useState(timeLimitSeconds ?? 0);
  const [result, setResult] = useState<QuizAttemptDetail | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  // Per-question dwell time (seconds), flushed on navigation and submit.
  const timingsRef = useRef(new Map<number, number>());
  const activeRef = useRef<{ id: number; start: number } | null>(null);

  const question = quiz.questions[current];
  const total = quiz.questions.length;
  const multi = question.correctIndices.length > 1;
  const selected = answers.get(question.id) ?? [];
  const isLast = current === total - 1;
  const unansweredCount = quiz.questions.filter((q) => (answers.get(q.id) ?? []).length === 0).length;
  const allAnswered = unansweredCount === 0;

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

  const flushTiming = () => {
    const active = activeRef.current;
    if (!active) return;
    const elapsed = (Date.now() - active.start) / 1000;
    timingsRef.current.set(active.id, (timingsRef.current.get(active.id) ?? 0) + elapsed);
    activeRef.current = { id: active.id, start: Date.now() };
  };

  useEffect(() => {
    flushTiming();
    activeRef.current = { id: question.id, start: Date.now() };
  }, [question.id]);

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setSubmitError(false);
    try {
      const payload = quiz.questions.map((q) => {
        const sel = answers.get(q.id) ?? [];
        return { questionId: q.id, selectedIndex: sel[0] ?? -1, selectedIndices: sel };
      });
      const timings: Record<number, number> = {};
      flushTiming();
      for (const [id, seconds] of timingsRef.current) timings[id] = Math.round(seconds * 10) / 10;
      const flaggedIds = [...flagged];
      const detail = submitAnswers
        ? await submitAnswers(payload, timings, flaggedIds)
        : await api()
          .quizzes.submitAttempt(quiz.id, payload)
          .then((attemptId) => api().quizzes.attemptDetail(attemptId));
      // A null detail is a failure, not a result: leaving it unhandled left
      // the button stuck on "Submitting..." with no way back.
      if (!detail) {
        setSubmitting(false);
        setSubmitError(true);
        return;
      }
      setResult(detail);
    } catch {
      setSubmitting(false);
      setSubmitError(true);
    }
  };

  const submitRef = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    submitRef.current = submit;
  });

  // Countdown for timed exams; auto-submits once at zero.
  //
  // The remaining time is derived from a wall-clock deadline rather than
  // counted down by the interval: Chromium throttles timers in a backgrounded
  // or occluded window and stops them across OS sleep, which handed the
  // candidate extra real time on a timed exam. Ticking twice a second also
  // means the display re-syncs immediately after a throttled period.
  useEffect(() => {
    if (!timed || timeLimitSeconds === undefined) return;
    const deadline = Date.now() + timeLimitSeconds * 1000;
    setSecondsLeft(timeLimitSeconds);
    let fired = false;
    const tick = () => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left === 0 && !fired) {
        fired = true;
        clearInterval(id);
        void submitRef.current();
      }
    };
    const id = setInterval(tick, 500);
    // Re-sync the moment the window becomes visible again after a sleep.
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
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
    return <QuizReview attempt={result} quizTitle={quiz.title} onClose={onClose} passPercent={passPercent} />;
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

      {(timed || flaggable) && (
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
          {flaggable && (
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
          // A timed exam may be submitted with questions left blank (they
          // score as incorrect) — the real exam works that way, and the
          // auto-submit at zero does the same thing.
          <button className="btn btn-primary" disabled={(!allAnswered && !timed) || submitting} onClick={submit}>
            <CheckCircle2 size={16} />
            {submitting ? 'Submitting...' : 'Submit quiz'}
          </button>
        ) : (
          <button
            className="btn btn-primary"
            disabled={!timed && selected.length === 0}
            onClick={() => setCurrent((c) => c + 1)}
          >
            Next <ArrowRight size={15} />
          </button>
        )}
      </div>
      {!allAnswered && isLast && (
        <p className="muted" style={{ fontSize: 12.5, textAlign: 'center', margin: 0 }}>
          {timed
            ? `${unansweredCount} question${unansweredCount === 1 ? '' : 's'} left blank — blank answers count as incorrect.`
            : 'Answer all questions to submit.'}
        </p>
      )}
      {submitError && (
        <p role="alert" style={{ fontSize: 12.5, textAlign: 'center', margin: 0, color: 'var(--danger)' }}>
          Couldn't save your attempt. Check the database and try submitting again.
        </p>
      )}
    </div>
  );
}
