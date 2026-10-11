import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCircle2, MinusCircle, XCircle } from 'lucide-react';
import type { QuizDetail, QuizAttemptDetail, AnswerInput } from '../../types';
import { api } from '../../services/api';
import QuizReview from './QuizReview';
import ExplanationBlock from './ExplanationBlock';
import styles from './Quiz.module.css';

interface Props {
  quiz: QuizDetail;
  onClose: () => void;
  /** Overrides the default submit pipeline (used for file-based exams). */
  submitAnswers?: (
    answers: AnswerInput[],
    timings: Record<number, number>,
    flagged: number[],
  ) => Promise<QuizAttemptDetail | null>;
  /** Pass mark percent shown in review (default 70). */
  passPercent?: number;
}

function setsEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.every((v, i) => v === sb[i]);
}

/**
 * Practice mode: every answer is checked immediately with the explanation
 * shown, then the whole run is submitted for review + history at the end.
 */
export default function PracticeRunner({ quiz, onClose, submitAnswers, passPercent = 70 }: Props) {
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Map<number, number[]>>(new Map());
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<QuizAttemptDetail | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const timingsRef = useRef(new Map<number, number>());
  const activeRef = useRef<{ id: number; start: number } | null>(null);

  const question = quiz.questions[current];
  const total = quiz.questions.length;
  const multi = question.correctIndices.length > 1;
  const selected = answers.get(question.id) ?? [];
  const isRevealed = revealed.has(question.id);
  const isLast = current === total - 1;

  const correctCount = quiz.questions.filter((q) => {
    if (!revealed.has(q.id)) return false;
    return setsEqual(answers.get(q.id) ?? [], q.correctIndices);
  }).length;
  const answeredCount = revealed.size;

  const toggle = (optionIndex: number) => {
    if (isRevealed) return;
    if (!multi) {
      // Single-choice reveals immediately on selection.
      setAnswers((prev) => new Map(prev).set(question.id, [optionIndex]));
      setRevealed((prev) => new Set(prev).add(question.id));
      return;
    }
    setAnswers((prev) => {
      const next = new Map(prev);
      const cur = next.get(question.id) ?? [];
      next.set(
        question.id,
        cur.includes(optionIndex) ? cur.filter((x) => x !== optionIndex) : [...cur, optionIndex],
      );
      return next;
    });
  };

  const checkMulti = () => {
    if (selected.length === 0) return;
    setRevealed((prev) => new Set(prev).add(question.id));
  };

  const skip = () => {
    setAnswers((prev) => {
      if (prev.has(question.id)) return prev;
      return new Map(prev).set(question.id, []);
    });
    setRevealed((prev) => new Set(prev).add(question.id));
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
      const detail = submitAnswers
        ? await submitAnswers(payload, timings, [])
        : await api()
          .quizzes.submitAttempt(quiz.id, payload)
          .then((attemptId) => api().quizzes.attemptDetail(attemptId));
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

  if (result) {
    return <QuizReview attempt={result} quizTitle={quiz.title} onClose={onClose} passPercent={passPercent} />;
  }

  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
  const showCheckButton = multi && !isRevealed;
  const answerLetters = question.correctIndices.map((i) => letters[i] ?? '?').join(', ');
  const verdict: 'correct' | 'wrong' | 'skipped' | null = !isRevealed
    ? null
    : selected.length === 0
      ? 'skipped'
      : setsEqual(selected, question.correctIndices)
        ? 'correct'
        : 'wrong';

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
      <p className="secondary" style={{ margin: 0, fontSize: 13 }}>
        Practice mode · Correct {correctCount} of {answeredCount} answered
        {multi && !isRevealed ? ' · Select all that apply' : ''}
      </p>

      <div className={`card ${styles.questionCard}`}>
        <div className={styles.questionMeta}>
          <span>Question {current + 1} of {total}</span>
          {multi && <span className="badge">Select all that apply</span>}
        </div>
        <div className={styles.questionText}>{question.question}</div>
        <div className={styles.options}>
          {question.options.map((opt, oi) => {
            const isSelected = selected.includes(oi);
            const isAnswer = question.correctIndices.includes(oi);
            let cls = styles.optionBtn;
            if (isRevealed) {
              if (isAnswer) cls += ` ${styles.revealCorrect}`;
              else if (isSelected) cls += ` ${styles.revealWrong}`;
            } else if (isSelected) {
              cls += ` ${styles.selected}`;
            }
            return (
              <button
                key={oi}
                className={cls}
                aria-pressed={isSelected}
                disabled={isRevealed}
                onClick={() => toggle(oi)}
              >
                <span className={styles.optionLetter}>{letters[oi]}</span>
                <span style={{ flex: 1 }}>{opt}</span>
                {isRevealed && isAnswer && <Check size={16} color="var(--success)" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
        {verdict && (
          <div className={`${styles.verdict} ${styles[`verdict_${verdict}`]}`} role="status">
            {verdict === 'correct' ? <CheckCircle2 size={20} /> : verdict === 'wrong' ? <XCircle size={20} /> : <MinusCircle size={20} />}
            <div>
              <div className={styles.verdictTitle}>
                {verdict === 'correct' ? 'Correct' : verdict === 'wrong' ? 'Not quite' : 'Skipped'}
              </div>
              {verdict !== 'correct' && (
                <div className={styles.verdictText}>
                  {question.correctIndices.length > 1 ? 'The correct answers are' : 'The correct answer is'} <strong>{answerLetters}</strong>.
                </div>
              )}
            </div>
          </div>
        )}
        {isRevealed && question.explanation && (
          <ExplanationBlock text={question.explanation} />
        )}
      </div>

      <div className={styles.takerNav}>
        <button
          className="btn btn-ghost"
          disabled={current === 0}
          onClick={() => setCurrent((c) => c - 1)}
        >
          <ArrowLeft size={15} /> Previous
        </button>
        {showCheckButton ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" onClick={skip}>
              Skip
            </button>
            <button className="btn btn-primary" disabled={selected.length === 0} onClick={checkMulti}>
              <CheckCircle2 size={16} /> Check answer
            </button>
          </div>
        ) : isLast ? (
          <button className="btn btn-primary" disabled={!isRevealed || submitting} onClick={submit}>
            <CheckCircle2 size={16} />
            {submitting ? 'Submitting...' : 'See results'}
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 8 }}>
            {!isRevealed && (
              <button className="btn btn-ghost" onClick={skip}>
                Skip
              </button>
            )}
            <button
              className="btn btn-primary"
              disabled={!isRevealed}
              onClick={() => setCurrent((c) => c + 1)}
            >
              Next <ArrowRight size={15} />
            </button>
          </div>
        )}
      </div>
      {submitError && (
        <p role="alert" style={{ fontSize: 12.5, textAlign: 'center', margin: 0, color: 'var(--danger)' }}>
          Couldn't save your attempt. Check the database and try submitting again.
        </p>
      )}
    </div>
  );
}
