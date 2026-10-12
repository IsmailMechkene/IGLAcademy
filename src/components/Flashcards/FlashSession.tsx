import { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { Flashcard, FlashGrade } from '../../types';
import { api } from '../../services/api';
import { scheduleReview } from '../../utils/sm2';
import { CardBack, CardFront } from './CardFace';
import styles from './FlashSession.module.css';

interface Props {
  deckId: number;
  deckTitle: string;
  reviewAll: boolean;
  onClose: () => void;
}

const GRADES: Array<{ grade: FlashGrade; label: string; hint: string }> = [
  { grade: 'again', label: 'Again', hint: '<1 day' },
  { grade: 'hard', label: 'Hard', hint: 'soon' },
  { grade: 'good', label: 'Good', hint: 'later' },
  { grade: 'easy', label: 'Easy', hint: 'much later' },
];

export default function FlashSession({ deckId, deckTitle, reviewAll, onClose }: Props) {
  const [cards, setCards] = useState<Flashcard[] | null>(null);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [againCount, setAgainCount] = useState(0);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loader = reviewAll ? api().flashcards.cards(deckId) : api().flashcards.due(deckId);
    loader
      .then((c) => {
        if (!cancelled) setCards(c);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [deckId, reviewAll]);

  if (loadError) {
    return (
      <div className={styles.summary}>
        <p>Could not load flashcards.</p>
        <button className="btn btn-ghost" onClick={onClose}>Close</button>
      </div>
    );
  }

  if (!cards) {
    return <div className="muted" style={{ padding: 24 }}>Loading cards...</div>;
  }

  if (cards.length === 0) {
    return (
      <div className={styles.summary}>
        <CheckCircle2 size={32} color="var(--success)" />
        <h2 style={{ margin: 0, fontSize: 17 }}>All caught up!</h2>
        <p className="secondary" style={{ margin: 0 }}>No cards are due in "{deckTitle}" right now.</p>
        <button className="btn btn-primary" onClick={onClose}>Done</button>
      </div>
    );
  }

  if (index >= cards.length) {
    return (
      <div className={styles.summary}>
        <CheckCircle2 size={32} color="var(--success)" />
        <h2 style={{ margin: 0, fontSize: 17 }}>Session complete</h2>
        <p className="secondary" style={{ margin: 0 }}>
          Reviewed {cards.length} card{cards.length === 1 ? '' : 's'}
          {againCount > 0 ? ` · ${againCount} marked for tomorrow` : ' · everything remembered'}.
        </p>
        <button className="btn btn-primary" onClick={onClose}>Done</button>
      </div>
    );
  }

  const card = cards[index];

  const grade = (g: FlashGrade) => {
    const next = scheduleReview(
      { ease: card.ease, intervalDays: card.intervalDays, reps: card.reps },
      g,
    );
    if (g === 'again') setAgainCount((n) => n + 1);
    void api()
      .flashcards.grade({
        cardId: card.id,
        ease: next.ease,
        intervalDays: next.intervalDays,
        reps: next.reps,
        dueAt: next.dueAt,
      })
      .catch(() => undefined);
    setFlipped(false);
    setIndex((i) => i + 1);
  };

  return (
    <div className={styles.session}>
      <div className={styles.progress}>
        <span>
          Card {index + 1} of {cards.length} · {deckTitle}
        </span>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          End session
        </button>
      </div>
      <div
        className={`card ${styles.flashcard}`}
        onClick={() => !flipped && setFlipped(true)}
        role="button"
        tabIndex={0}
        aria-label={flipped ? 'Answer shown' : 'Show answer'}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !flipped) {
            e.preventDefault();
            setFlipped(true);
          }
        }}
      >
        {!flipped ? (
          <>
            <CardFront text={card.front} />
            <div className={styles.hint}>Click or press Enter to reveal</div>
          </>
        ) : (
          <div className={styles.back}>
            <CardFront text={card.front} compact />
            <CardBack text={card.back} />
          </div>
        )}
      </div>
      {flipped ? (
        <div className={styles.grades} role="group" aria-label="Grade your recall">
          {GRADES.map((g) => (
            <button key={g.grade} className={styles.gradeBtn} onClick={() => grade(g.grade)}>
              <span className={styles.gradeName}>{g.label}</span>
              <span className={styles.gradeSub}>{g.hint}</span>
            </button>
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <button className="btn btn-primary" onClick={() => setFlipped(true)}>
            Show answer
          </button>
        </div>
      )}
    </div>
  );
}
