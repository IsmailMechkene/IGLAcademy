import { ArrowLeft, ArrowRight, Timer, Zap } from 'lucide-react';
import styles from './Quiz.module.css';

export type ExamMode = 'practice' | 'exam';

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
