import { Lightbulb } from 'lucide-react';
import styles from './Quiz.module.css';

/** Prominent, consistently styled answer explanation. */
export default function ExplanationBlock({ text }: { text: string }) {
  const paragraphs = text
    .split('\n')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return (
    <div className={styles.explanation}>
      <div className={styles.explanationHeader}>
        <Lightbulb size={14} aria-hidden="true" />
        <span>Explanation</span>
      </div>
      <div className={styles.explanationBody}>
        {paragraphs.length > 0 ? paragraphs.map((p, i) => <p key={i}>{p}</p>) : text}
      </div>
    </div>
  );
}
