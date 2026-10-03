import styles from './ProgressBar.module.css';

interface Props {
  percent: number;
  large?: boolean;
}

export default function ProgressBar({ percent, large }: Props) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className={`${styles.progress} ${large ? styles.lg : ''}`} role="progressbar" aria-valuenow={clamped} aria-valuemin={0} aria-valuemax={100}>
      <div
        className={`${styles.bar} ${clamped === 100 ? styles.complete : ''}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
