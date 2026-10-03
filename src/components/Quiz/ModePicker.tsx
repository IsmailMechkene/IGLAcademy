import { ArrowLeft, Timer, Zap } from 'lucide-react';
import styles from './Quiz.module.css';

export type ExamMode = 'practice' | 'exam';

interface Props {
  title: string;
  description?: string;
  questionCount: number;
  multiCount: number;
  timeLimitMinutes: number;
  onPick: (mode: ExamMode) => void;
  onBack: () => void;
}

/** Choose between untimed practice (instant feedback) and a timed exam. */
export default function ModePicker({
  title,
  description,
  questionCount,
  multiCount,
  timeLimitMinutes,
  onPick,
  onBack,
}: Props) {
  return (
    <div className={`fade-in ${styles.modeWrap}`}>
      <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ alignSelf: 'flex-start' }}>
        <ArrowLeft size={14} /> Back
      </button>
      <h1 className={styles.modeTitle}>{title}</h1>
      <p className="secondary" style={{ margin: 0 }}>
        {questionCount} questions
        {multiCount > 0 ? ` (${multiCount} multi-select)` : ''} · 70% to pass
      </p>
      {description && (
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          {description}
        </p>
      )}
      <div className={styles.modeGrid}>
        <button type="button" className={`card ${styles.modeCard}`} onClick={() => onPick('practice')}>
          <span className={`${styles.modeIcon} ${styles.modeIconPractice}`}>
            <Zap size={22} />
          </span>
          <span className={styles.modeName}>Practice mode</span>
          <span className={styles.modeDesc}>
            Instant feedback after every question, with explanations. Untimed — learn at your own pace.
          </span>
        </button>
        <button type="button" className={`card ${styles.modeCard}`} onClick={() => onPick('exam')}>
          <span className={`${styles.modeIcon} ${styles.modeIconExam}`}>
            <Timer size={22} />
          </span>
          <span className={styles.modeName}>Exam mode</span>
          <span className={styles.modeDesc}>
            Real exam conditions: {timeLimitMinutes} minutes on the clock, answers revealed only at the end.
          </span>
        </button>
      </div>
    </div>
  );
}
