import { useEffect, useState } from 'react';
import { AlarmClockOff, ArrowLeft, ArrowRight, History, Timer, Zap } from 'lucide-react';
import { formatCountdown, timeAgo } from '../../utils/format';
import styles from './Quiz.module.css';

export type ExamMode = 'practice' | 'exam';

export interface ResumeInfo {
  mode: ExamMode;
  answered: number;
  total: number;
  /** Exam mode deadline (epoch ms); the clock kept running while closed. */
  deadlineAt: number | null;
  savedAt: number;
}

interface Props {
  title: string;
  /** Unused since the redesign (it repeated the file name); kept for callers. */
  description?: string;
  questionCount: number;
  multiCount: number;
  timeLimitMinutes: number;
  shuffle: boolean;
  onToggleShuffle: () => void;
  secondsPerQuestion: number;
  onPickDuration: (seconds: number) => void;
  onPick: (mode: ExamMode) => void;
  onBack: () => void;
  /** Pass mark from settings (the label used to claim a hardcoded 70%). */
  passPercent: number;
  /** An interrupted run of this exam that can be resumed, if any. */
  resume?: ResumeInfo | null;
  onResume?: () => void;
  onDiscard?: () => void;
}

/** Choose between untimed practice (instant feedback) and a timed exam. */
export default function ModePicker({
  title,
  questionCount,
  multiCount,
  timeLimitMinutes,
  shuffle,
  onToggleShuffle,
  secondsPerQuestion,
  onPickDuration,
  onPick,
  onBack,
  passPercent,
  resume,
  onResume,
  onDiscard,
}: Props) {
  return (
    <div className={`fade-in ${styles.modeWrap}`}>
      <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ alignSelf: 'flex-start' }}>
        <ArrowLeft size={14} /> All practice exams
      </button>
      <div className={styles.modeHeader}>
        <span className="eyebrow">Practice exam</span>
        <h1 className={styles.modeTitle}>{title}</h1>
        <div className={styles.modeChips}>
          <span className={styles.modeChip}>{questionCount} questions</span>
          {multiCount > 0 && <span className={styles.modeChip}>{multiCount} multi-select</span>}
          <span className={styles.modeChip}>{passPercent}% to pass</span>
          <span className={styles.modeChip}>{timeLimitMinutes} min in exam mode</span>
        </div>
      </div>

      {resume && <ResumeCard info={resume} onResume={onResume} onDiscard={onDiscard} />}

      <div className={styles.modeGrid}>
        <button type="button" className={`card ${styles.modeCard}`} onClick={() => onPick('practice')}>
          <span className={`${styles.modeIcon} ${styles.modeIconPractice}`}>
            <Zap size={22} />
          </span>
          <span className={styles.modeName}>Practice mode</span>
          <span className={styles.modeDesc}>
            Instant feedback after every question, with explanations. Untimed — learn at your own pace.
          </span>
          <span className={styles.modeCta}>Start practising <ArrowRight size={15} /></span>
        </button>
        <button type="button" className={`card ${styles.modeCard} ${styles.modeCardExam}`} onClick={() => onPick('exam')}>
          <span className={`${styles.modeIcon} ${styles.modeIconExam}`}>
            <Timer size={22} />
          </span>
          <span className={styles.modeName}>Exam mode</span>
          <span className={styles.modeDesc}>
            Real exam conditions: {timeLimitMinutes} minutes on the clock, answers revealed only at the end.
          </span>
          <span className={styles.modeCta}>Start the clock <ArrowRight size={15} /></span>
        </button>
      </div>

      <div className={`card ${styles.runOptions}`}>
        <div className={styles.runOption}>
          <div>
            <div className={styles.runLabel}>Shuffle</div>
            <div className={styles.runDesc}>Randomise question and answer order for this run.</div>
          </div>
          <label className={styles.switch}>
            <input type="checkbox" checked={shuffle} onChange={onToggleShuffle} aria-label="Shuffle questions and answer order" />
            <span />
          </label>
        </div>
        <div className={styles.runOption}>
          <div>
            <div className={styles.runLabel}>Exam pace</div>
            <div className={styles.runDesc}>Time allowed per question in exam mode ({timeLimitMinutes} min total).</div>
          </div>
          <div className={styles.durationRow} role="radiogroup" aria-label="Exam pace">
            {[60, 120, 180].map((sec) => (
              <button
                key={sec}
                type="button"
                role="radio"
                aria-checked={secondsPerQuestion === sec}
                className={`${styles.durationOption} ${secondsPerQuestion === sec ? styles.durationActive : ''}`}
                onClick={() => onPickDuration(sec)}
              >
                {sec / 60} min / q
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ResumeCard({ info, onResume, onDiscard }: { info: ResumeInfo; onResume?: () => void; onDiscard?: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (info.deadlineAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [info.deadlineAt]);

  const secondsLeft = info.deadlineAt === null ? null : Math.max(0, Math.ceil((info.deadlineAt - now) / 1000));
  const expired = secondsLeft === 0;
  const percent = info.total > 0 ? Math.round((info.answered / info.total) * 100) : 0;

  return (
    <div className={`card ${styles.resumeCard} ${expired ? styles.resumeExpired : ''}`} role="region" aria-label="Exam in progress">
      <span className={styles.resumeIcon}>{expired ? <AlarmClockOff size={22} /> : <History size={22} />}</span>
      <div className={styles.resumeBody}>
        <div className={styles.resumeTitle}>
          {expired
            ? 'Time ran out while you were away'
            : info.mode === 'exam'
              ? 'You have an exam in progress'
              : 'You have a practice run in progress'}
        </div>
        <div className={styles.resumeMeta}>
          {info.answered} of {info.total} answered
          {secondsLeft !== null && !expired && <> · <strong>{formatCountdown(secondsLeft)}</strong> left</>}
          {' · '}saved {timeAgo(new Date(info.savedAt).toISOString())}
        </div>
        <div className={styles.resumeBar}>
          <span style={{ width: `${percent}%` }} />
        </div>
      </div>
      <div className={styles.resumeActions}>
        <button className="btn btn-ghost" onClick={onDiscard}>Discard</button>
        <button className="btn btn-primary" onClick={onResume} data-autofocus>
          {expired ? 'Submit answers' : 'Resume'}
        </button>
      </div>
    </div>
  );
}
