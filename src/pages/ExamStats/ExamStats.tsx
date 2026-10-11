import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, BarChart3, Clock, Flag, ListX, TrendingUp,
} from 'lucide-react';
import type { PracticeExamContent, QuizAttemptDetail, QuizAttemptSummary } from '../../types';
import { api } from '../../services/api';
import { useApp } from '../../App';
import { formatDateTime } from '../../utils/format';
import { compareAttempts, timingSummary, topicScores } from '../../utils/examAnalytics';
import QuizReview from '../../components/Quiz/QuizReview';
import Modal from '../../components/Modal/Modal';
import LoadError from '../../components/LoadError/LoadError';
import styles from './ExamStats.module.css';

interface Props {
  filePath: string;
}

function TrendChart({ attempts, passPercent }: { attempts: QuizAttemptSummary[]; passPercent: number }) {
  const points = [...attempts].sort((a, b) => a.id - b.id);
  if (points.length === 0) return null;
  const W = 560;
  const H = 120;
  const PAD = 10;
  const xs = (i: number) => (points.length === 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (points.length - 1));
  const ys = (p: number) => H - PAD - (Math.max(0, Math.min(100, p)) / 100) * (H - 2 * PAD);
  const line = points.map((a, i) => `${i === 0 ? 'M' : 'L'}${xs(i).toFixed(1)},${ys(a.percent).toFixed(1)}`).join(' ');
  return (
    <svg className={styles.trendSvg} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Score trend over ${points.length} attempts`}>
      {/* pass line follows the configured pass mark, not a hardcoded 70 */}
      <line x1={PAD} y1={ys(passPercent)} x2={W - PAD} y2={ys(passPercent)} stroke="var(--danger)" strokeWidth="1" strokeDasharray="4 4" opacity="0.7" />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" />
      {points.map((a, i) => (
        <circle key={a.id} cx={xs(i)} cy={ys(a.percent)} r="4" fill="var(--accent)">
          <title>{`${a.percent}% on ${formatDateTime(a.createdAt)}`}</title>
        </circle>
      ))}
    </svg>
  );
}

export default function ExamStats({ filePath }: Props) {
  const { navigate, settings } = useApp();
  const [content, setContent] = useState<PracticeExamContent | null>(null);
  const [attempts, setAttempts] = useState<QuizAttemptSummary[]>([]);
  const [details, setDetails] = useState<Map<number, QuizAttemptDetail>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [review, setReview] = useState<{ attempt: QuizAttemptDetail; filter: 'all' | 'incorrect' | 'flagged' } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    (async () => {
      try {
        const exam = await api().practice.load(filePath);
        if (cancelled) return;
        setContent(exam);
        const history = await api().practice.history(filePath);
        if (cancelled) return;
        setAttempts(history);
        // Load details for trend + compare + topics (latest attempts first).
        const map = new Map<number, QuizAttemptDetail>();
        for (const a of history.slice(0, 10)) {
          try {
            const detail = await api().practice.attemptDetail(a.id);
            if (cancelled) return;
            if (detail) map.set(a.id, detail);
          } catch {
            // one bad attempt must not break the whole page
          }
        }
        if (!cancelled) setDetails(map);
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const latest = useMemo(() => {
    if (attempts.length === 0) return null;
    const sorted = [...attempts].sort((a, b) => b.id - a.id);
    return details.get(sorted[0].id) ?? null;
  }, [attempts, details]);

  const topics = useMemo(() => {
    if (!content || !latest) return [];
    return topicScores(
      content.questions,
      latest.answers.map((a) => a.selectedIndices),
    );
  }, [content, latest]);

  const timing = useMemo(() => {
    if (!latest) return null;
    return timingSummary(latest.answers.map((a) => a.seconds ?? 0), latest.total);
  }, [latest]);

  const comparison = useMemo(() => compareAttempts(attempts), [attempts]);

  const missed = useMemo(() => latest?.answers.filter((a) => !a.isCorrect) ?? [], [latest]);

  const openReview = async (attemptId: number, filter: 'all' | 'incorrect' | 'flagged') => {
    try {
      const detail = details.get(attemptId) ?? (await api().practice.attemptDetail(attemptId));
      if (detail) setReview({ attempt: detail, filter });
    } catch {
      // stay on the page
    }
  };

  if (loading) {
    return <div className="muted" style={{ padding: 48 }}>Loading analytics...</div>;
  }

  if (loadError || !content) {
    return (
      <div className={styles.page}>
        <LoadError message="Could not load exam analytics." onRetry={() => navigate({ name: 'practice' })} />
      </div>
    );
  }

  return (
    <div className={`fade-in ${styles.page}`}>
      <div className={styles.backRow}>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate({ name: 'practice' })}>
          <ArrowLeft size={14} /> Practice Exams
        </button>
      </div>
      <div className={styles.header}>
        <h1>{content.title}</h1>
        <p>
          {content.questions.length} questions · {attempts.length} attempt{attempts.length === 1 ? '' : 's'}
        </p>
      </div>

      {attempts.length === 0 ? (
        <div className={`card ${styles.panel}`}>
          <p className="secondary" style={{ margin: 0 }}>
            No attempts yet. Take this exam to unlock score trends, weak topics, and timing stats.
          </p>
          <div>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => navigate({ name: 'examfile', filePath })}
            >
              Start exam
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className={styles.grid}>
            <div className={`card ${styles.panel}`}>
              <h2><TrendingUp size={15} /> Score trend</h2>
              <TrendChart attempts={attempts} passPercent={settings.examPassPercent} />
              {comparison && (
                <div className="secondary" style={{ fontSize: 13 }}>
                  Last attempt{' '}
                  <span
                    className={styles.compareDelta}
                    style={{ color: comparison.delta >= 0 ? 'var(--success)' : 'var(--danger)', fontSize: 15 }}
                  >
                    {comparison.delta >= 0 ? '+' : ''}{comparison.delta}%
                  </span>{' '}
                  vs previous ({comparison.previous.percent}% → {comparison.latest.percent}%)
                </div>
              )}
            </div>

            <div className={`card ${styles.panel}`}>
              <h2><BarChart3 size={15} /> Weak topics</h2>
              {topics.length === 0 || !latest ? (
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>Answer an exam to see per-topic scores.</p>
              ) : (
                topics.map((t) => (
                  <div key={t.topic} className={styles.topicRow}>
                    <div className={styles.topicTop}>
                      <span className={styles.topicName}>{t.topic}</span>
                      <span className="muted">{t.correct}/{t.total} · {t.percent}%</span>
                    </div>
                    <div className={styles.topicBar} role="img" aria-label={`${t.topic}: ${t.percent}% correct`}>
                      <div
                        className={`${styles.topicFill} ${t.percent < settings.examPassPercent ? styles.weak : ''}`}
                        style={{ width: `${t.percent}%` }}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className={`card ${styles.panel}`}>
              <h2><Clock size={15} /> Time per question</h2>
              {!timing ? (
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>No timing data yet.</p>
              ) : (
                <>
                  <div className="secondary" style={{ fontSize: 13 }}>
                    Average {timing.averageSeconds.toFixed(1)}s per question
                  </div>
                  {timing.slowest.filter((s) => s.seconds > 0).map((s) => {
                    const q = latest?.answers[s.index];
                    return (
                      <div key={s.index} className={styles.missedItem}>
                        <strong>Q{(s.index ?? 0) + 1}</strong> — {Math.round(s.seconds)}s
                        {q && <div className="muted">{q.question.slice(0, 120)}</div>}
                      </div>
                    );
                  })}
                </>
              )}
            </div>

            <div className={`card ${styles.panel}`}>
              <h2><ListX size={15} /> Missed questions {missed.length > 0 && `(${missed.length})`}</h2>
              {missed.length === 0 ? (
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                  {latest ? 'Nothing missed on the latest attempt. Excellent!' : 'No attempts yet.'}
                </p>
              ) : (
                <div className={styles.missedList}>
                  {missed.slice(0, 5).map((a) => (
                    <div key={a.questionId} className={styles.missedItem}>
                      {a.question.slice(0, 160)}
                    </div>
                  ))}
                  {missed.length > 5 && (
                    <div className="muted" style={{ fontSize: 12.5 }}>+ {missed.length - 5} more</div>
                  )}
                </div>
              )}
              {latest && (
                <div className={styles.reviewButtons}>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => latest && openReview(latest.id, 'incorrect')}
                  >
                    Review incorrect
                  </button>
                  {(latest.flagged?.length ?? 0) > 0 && (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => latest && openReview(latest.id, 'flagged')}
                    >
                      <Flag size={13} /> Review flagged
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {review && (
            <Modal label="Attempt review" onClose={() => setReview(null)}>
              <div className={styles.reviewDialog}>
                <QuizReview
                  attempt={review.attempt}
                  quizTitle={content.title}
                  onClose={() => setReview(null)}
                  passPercent={settings.examPassPercent}
                  initialFilter={review.filter}
                />
              </div>
            </Modal>
          )}
        </>
      )}
    </div>
  );
}
