import { Check } from 'lucide-react';
import ExplanationBlock from '../Quiz/ExplanationBlock';
import styles from './FlashSession.module.css';

const OPTION = /^([A-Z])\.\s+(.*)$/;
const CHOOSE = /^\(Choose (\d+)\)$/;

/**
 * A card front: plain text for hand-made cards; for practice-exam mistake
 * cards ("question\nA. …\nB. …"), the question with its lettered options.
 */
export function CardFront({ text, compact }: { text: string; compact?: boolean }) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const options = lines.filter((l) => OPTION.test(l));
  if (options.length < 2) {
    return <div className={compact ? styles.frontCompact : styles.front}>{text}</div>;
  }
  const question = lines.filter((l) => !OPTION.test(l) && !CHOOSE.test(l)).join('\n');
  const choose = lines.map((l) => CHOOSE.exec(l)).find(Boolean);
  return (
    <div className={`${styles.question} ${compact ? styles.questionCompact : ''}`}>
      <div className={styles.questionText}>{question}</div>
      {choose && <span className="badge">Choose {choose[1]}</span>}
      {!compact && (
        <ol className={styles.optionList}>
          {options.map((o) => {
            const [, letter, body] = OPTION.exec(o) ?? [];
            return (
              <li key={o}>
                <span className={styles.optionLetter}>{letter}</span>
                <span>{body}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/**
 * A card back. Mistake cards start with "Correct answer(s):" and the answers
 * in **bold**; those are pulled into a green answer box and the rest is shown
 * as a structured explanation. Anything else renders as rich text.
 */
export function CardBack({ text }: { text: string }) {
  const lines = text.split('\n');
  if (!/^Correct answers?:$/.test(lines[0]?.trim() ?? '')) {
    return <ExplanationBlock text={text} bare />;
  }
  const answers: string[] = [];
  let i = 1;
  for (; i < lines.length; i++) {
    const m = /^\*\*(.+)\*\*$/.exec(lines[i].trim());
    if (!m) break;
    answers.push(m[1]);
  }
  const rest = lines.slice(i).join('\n').trim();
  return (
    <div className={styles.backBody}>
      <div className={styles.answerBox}>
        <span className={styles.answerLabel}>{answers.length > 1 ? 'Correct answers' : 'Correct answer'}</span>
        {answers.map((a) => (
          <div key={a} className={styles.answerLine}>
            <span className={styles.answerMark}><Check size={12} strokeWidth={3} /></span>
            {a}
          </div>
        ))}
      </div>
      {rest && <ExplanationBlock text={rest} bare />}
    </div>
  );
}
