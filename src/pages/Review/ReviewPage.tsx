import { useEffect, useState } from 'react';
import {
  Bookmark, Brain, CheckCircle2, Clock, Layers, PlayCircle, Plus, StickyNote, Trash2, X,
} from 'lucide-react';
import type { Bookmark as BookmarkType, CourseWithProgress, FlashcardDeck, Quiz, ReviewItem } from '../../types';
import { api } from '../../services/api';
import { useApp } from '../../App';
import { formatDateTime } from '../../utils/format';
import FlashSession from '../../components/Flashcards/FlashSession';
import Modal from '../../components/Modal/Modal';
import LoadError from '../../components/LoadError/LoadError';
import ConfirmDialog from '../../components/Modal/ConfirmDialog';
import styles from './ReviewPage.module.css';

export default function ReviewPage() {
  const { navigate, refreshKey, refreshAll } = useApp();
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [decks, setDecks] = useState<FlashcardDeck[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkType[]>([]);
  const [due, setDue] = useState<{ itemsDue: number; cardsDue: number }>({ itemsDue: 0, cardsDue: 0 });
  const [loading, setLoading] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<
    | { kind: 'deck'; id: number; title: string; cardCount: number }
    | { kind: 'card'; id: number; deckId: number; title: string }
    | null
  >(null);
  const [loadError, setLoadError] = useState(false);
  const [courses, setCourses] = useState<CourseWithProgress[]>([]);
  const [session, setSession] = useState<{ deckId: number; title: string; all: boolean } | null>(null);

  // deck creation form
  const [newDeckCourse, setNewDeckCourse] = useState('');
  const [newDeckTitle, setNewDeckTitle] = useState('');
  const [newDeckSource, setNewDeckSource] = useState<'manual' | 'quiz' | 'notes'>('manual');
  const [newDeckQuiz, setNewDeckQuiz] = useState('');
  const [quizzesForCourse, setQuizzesForCourse] = useState<Quiz[]>([]);
  const [managingDeck, setManagingDeck] = useState<number | null>(null);
  const [deckCards, setDeckCards] = useState<Array<{ id: number; front: string; back: string }>>([]);
  const [cardFront, setCardFront] = useState('');
  const [cardBack, setCardBack] = useState('');

  const load = () => {
    setLoading(true);
    setLoadError(false);
    Promise.all([
      api().review.list(),
      api().flashcards.decks(),
      api().bookmarks.list(),
      api().review.dueCounts(),
      api().courses.list(),
    ])
      .then(([ri, d, b, counts, c]) => {
        setItems(ri);
        setDecks(d);
        setBookmarks(b);
        setDue(counts);
        setCourses(c);
        if (!newDeckCourse && c.length > 0) setNewDeckCourse(String(c[0].id));
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps -- reload on refresh only; load() reads current state when it runs
  useEffect(load, [refreshKey]);

  useEffect(() => {
    if (!newDeckCourse) {
      setQuizzesForCourse([]);
      return;
    }
    api()
      .quizzes.listForCourse(Number(newDeckCourse))
      .then((q) => {
        setQuizzesForCourse(q);
        setNewDeckQuiz('');
      })
      .catch(() => setQuizzesForCourse([]));
  }, [newDeckCourse]);

  const openManage = async (deckId: number) => {
    setManagingDeck(deckId);
    try {
      const cards = await api().flashcards.cards(deckId);
      setDeckCards(cards.map((c) => ({ id: c.id, front: c.front, back: c.back })));
    } catch {
      setDeckCards([]);
    }
  };

  const createDeck = async () => {
    const courseId = Number(newDeckCourse);
    if (!courseId || !newDeckTitle.trim()) return;
    try {
      if (newDeckSource === 'quiz' && newDeckQuiz) {
        await api().flashcards.fromQuiz({ courseId, quizId: Number(newDeckQuiz) });
      } else if (newDeckSource === 'notes') {
        await api().flashcards.fromNotes(courseId);
      } else {
        await api().flashcards.createDeck({ courseId, title: newDeckTitle.trim(), source: 'manual' });
      }
      setNewDeckTitle('');
      load();
    } catch (err) {
      await api().app.showError('Could not create deck', err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const jumpToItem = (item: ReviewItem) => {
    if (item.kind === 'exam') {
      navigate({ name: 'examfile', filePath: item.refId });
      return;
    }
    if (item.courseId === null) return;
    if (item.kind === 'lesson') {
      navigate({ name: 'player', courseId: item.courseId, lessonId: Number(item.refId) });
    } else if (item.kind === 'note') {
      navigate({ name: 'notes' });
    } else {
      navigate({ name: 'course', courseId: item.courseId });
    }
  };

  const kindIcon = (kind: ReviewItem['kind']) => {
    switch (kind) {
      case 'lesson': return <PlayCircle size={15} />;
      case 'note': return <StickyNote size={15} />;
      case 'quiz': return <CheckCircle2 size={15} />;
      default: return <Brain size={15} />;
    }
  };

  const pendingItems = items.filter((i) => !i.done);
  const doneItems = items.filter((i) => i.done);

  return (
    <div className={`fade-in ${styles.page}`}>
      <div className={styles.header}>
        <h1>Review</h1>
        <p>Bookmarks, review-later queue, and spaced-repetition flashcards.</p>
      </div>

      {loading ? (
        <div className="muted">Loading review space...</div>
      ) : loadError ? (
        <LoadError message="Could not load your review space." onRetry={load} />
      ) : (
        <>
          {(due.itemsDue > 0 || due.cardsDue > 0) && (
            <div className={`card ${styles.dueBanner}`}>
              <Brain size={22} color="var(--accent)" />
              <div className={styles.dueInfo}>
                <div className={styles.dueTitle}>Up for review</div>
                <div className={styles.dueMeta}>
                  {due.cardsDue > 0 && `${due.cardsDue} flashcard${due.cardsDue === 1 ? '' : 's'} due`}
                  {due.cardsDue > 0 && due.itemsDue > 0 && ' · '}
                  {due.itemsDue > 0 && `${due.itemsDue} queued item${due.itemsDue === 1 ? '' : 's'} due`}
                </div>
              </div>
            </div>
          )}

          <section className={styles.section} aria-label="Flashcards">
            <div className={styles.sectionHeader}>
              <h2>Flashcards</h2>
            </div>
            <div className={styles.form}>
              <select
                className="input"
                aria-label="Deck course"
                value={newDeckCourse}
                onChange={(e) => setNewDeckCourse(e.target.value)}
              >
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
              <input
                className="input"
                placeholder="New deck title"
                aria-label="New deck title"
                value={newDeckTitle}
                onChange={(e) => setNewDeckTitle(e.target.value)}
              />
              <select
                className="input"
                aria-label="Deck source"
                value={newDeckSource}
                onChange={(e) => setNewDeckSource(e.target.value as 'manual' | 'quiz' | 'notes')}
              >
                <option value="manual">Blank deck</option>
                <option value="quiz">From a quiz</option>
                <option value="notes">From course notes</option>
              </select>
              {newDeckSource === 'quiz' && (
                <select
                  className="input"
                  aria-label="Source quiz"
                  value={newDeckQuiz}
                  onChange={(e) => setNewDeckQuiz(e.target.value)}
                >
                  <option value="">Choose a quiz...</option>
                  {quizzesForCourse.map((q) => (
                    <option key={q.id} value={q.id}>{q.title}</option>
                  ))}
                </select>
              )}
              <button
                className="btn btn-primary btn-sm"
                disabled={
                  !newDeckCourse ||
                  (newDeckSource === 'manual' && !newDeckTitle.trim()) ||
                  (newDeckSource === 'quiz' && !newDeckQuiz)
                }
                onClick={createDeck}
              >
                <Plus size={14} /> Create deck
              </button>
            </div>
            {decks.length === 0 ? (
              <div className={styles.empty}>No flashcard decks yet. Create one above.</div>
            ) : (
              <div className={styles.list}>
                {decks.map((deck) => (
                  <div key={deck.id}>
                    <div className={`card ${styles.row}`}>
                      <span className={styles.resourceIconLike}>
                        <Layers size={16} />
                      </span>
                      <div className={styles.rowMain}>
                        <div className={styles.rowTitle}>{deck.title}</div>
                        <div className={styles.rowMeta}>
                          <span>{deck.courseTitle}</span>
                          <span>·</span>
                          <span>{deck.cardCount} cards</span>
                          {deck.dueCount > 0 && (
                            <>
                              <span>·</span>
                              <span className={styles.dueChip}>{deck.dueCount} due</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className={styles.rowActions}>
                        <button
                          className="btn btn-primary btn-sm"
                          disabled={deck.cardCount === 0}
                          onClick={() => setSession({ deckId: deck.id, title: deck.title, all: deck.dueCount === 0 })}
                        >
                          <PlayCircle size={14} /> Review
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => openManage(deck.id)}>
                          Cards
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          aria-label={`Delete deck ${deck.title}`}
                          onClick={() =>
                            setPendingDelete({ kind: 'deck', id: deck.id, title: deck.title, cardCount: deck.cardCount })
                          }
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    {managingDeck === deck.id && (
                      <div className={styles.cardList}>
                        {deckCards.map((card) => (
                          <div key={card.id} className={styles.miniCard}>
                            <span title={card.back}><strong>{card.front}</strong> — {card.back.slice(0, 80)}</span>
                            <button
                              className="btn btn-ghost btn-sm"
                              aria-label="Delete card"
                              onClick={() =>
                                setPendingDelete({ kind: 'card', id: card.id, deckId: deck.id, title: card.front })
                              }
                            >
                              <X size={13} />
                            </button>
                          </div>
                        ))}
                        <div className={styles.form}>
                          <input
                            className="input"
                            placeholder="Front (prompt)"
                            aria-label="Card front"
                            value={cardFront}
                            onChange={(e) => setCardFront(e.target.value)}
                          />
                          <input
                            className="input"
                            placeholder="Back (answer)"
                            aria-label="Card back"
                            value={cardBack}
                            onChange={(e) => setCardBack(e.target.value)}
                          />
                          <button
                            className="btn btn-ghost btn-sm"
                            disabled={!cardFront.trim() || !cardBack.trim()}
                            onClick={() => {
                              void api()
                                .flashcards.addCard({ deckId: deck.id, front: cardFront.trim(), back: cardBack.trim() })
                                .then(() => {
                                  setCardFront('');
                                  setCardBack('');
                                  openManage(deck.id);
                                  load();
                                });
                            }}
                          >
                            <Plus size={14} /> Add card
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className={styles.section} aria-label="Review later queue">
            <div className={styles.sectionHeader}>
              <h2>Review later</h2>
              <span className="muted" style={{ fontSize: 12.5 }}>{pendingItems.length} open</span>
            </div>
            {pendingItems.length === 0 && doneItems.length === 0 ? (
              <div className={styles.empty}>Nothing queued. Use "Later" on lessons, notes, or exams to queue them here.</div>
            ) : (
              <div className={styles.list}>
                {pendingItems.map((item) => (
                  <div key={item.id} className={`card ${styles.row}`}>
                    <span className={styles.resourceIconLike}>{kindIcon(item.kind)}</span>
                    <div className={styles.rowMain}>
                      <div className={styles.rowTitle}>{item.title}</div>
                      <div className={styles.rowMeta}>
                        {item.courseTitle && (
                          <>
                            <span>{item.courseTitle}</span>
                            <span>·</span>
                          </>
                        )}
                        <span>due {formatDateTime(item.dueAt)}</span>
                      </div>
                    </div>
                    <div className={styles.rowActions}>
                      <button className="btn btn-ghost btn-sm" onClick={() => jumpToItem(item)}>
                        Open
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        aria-label={`Mark ${item.title} done`}
                        onClick={() => {
                          void api().review.setDone(item.id, true).then(load);
                        }}
                      >
                        <CheckCircle2 size={14} />
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        aria-label={`Remove ${item.title} from queue`}
                        onClick={() => {
                          void api().review.remove(item.id).then(load);
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
                {doneItems.map((item) => (
                  <div key={item.id} className={`card ${styles.row} ${styles.done}`}>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked
                      aria-label={`Reopen ${item.title}`}
                      onChange={() => {
                        void api().review.setDone(item.id, false).then(load);
                      }}
                    />
                    <div className={styles.rowMain}>
                      <div className={styles.rowTitle}>{item.title}</div>
                    </div>
                    <div className={styles.rowActions}>
                      <button
                        className="btn btn-ghost btn-sm"
                        aria-label={`Remove ${item.title} from queue`}
                        onClick={() => {
                          void api().review.remove(item.id).then(load);
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className={styles.section} aria-label="Bookmarks">
            <div className={styles.sectionHeader}>
              <h2>Bookmarks</h2>
              <span className="muted" style={{ fontSize: 12.5 }}>{bookmarks.length} saved</span>
            </div>
            {bookmarks.length === 0 ? (
              <div className={styles.empty}>No bookmarks yet. Press B while watching to bookmark a moment.</div>
            ) : (
              <div className={styles.list}>
                {bookmarks.map((b) => (
                  <div key={b.id} className={`card ${styles.row}`}>
                    <span className={styles.resourceIconLike}>
                      <Bookmark size={15} />
                    </span>
                    <div className={styles.rowMain}>
                      <div className={styles.rowTitle}>{b.title}</div>
                      <div className={styles.rowMeta}>
                        <span>{b.courseTitle}</span>
                        {b.lessonTitle && (
                          <>
                            <span>·</span>
                            <span>{b.lessonTitle}</span>
                          </>
                        )}
                        <span>·</span>
                        <span><Clock size={11} /> {formatDateTime(b.createdAt)}</span>
                      </div>
                    </div>
                    <div className={styles.rowActions}>
                      {b.lessonId !== null && (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => navigate({
                            name: 'player',
                            courseId: b.courseId,
                            lessonId: b.lessonId as number,
                            startAt: Math.floor(b.positionSeconds),
                          })}
                        >
                          <PlayCircle size={14} /> Jump
                        </button>
                      )}
                      <button
                        className="btn btn-ghost btn-sm"
                        aria-label={`Delete bookmark ${b.title}`}
                        onClick={() => {
                          void api().bookmarks.remove(b.id).then(load);
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {session && (
        <Modal label={`Review ${session.title}`} onClose={() => { setSession(null); load(); refreshAll(); }}>
          <FlashSession
            deckId={session.deckId}
            deckTitle={session.title}
            reviewAll={session.all}
            onClose={() => { setSession(null); load(); refreshAll(); }}
          />
        </Modal>
      )}
      {pendingDelete && (
        <ConfirmDialog
          title={pendingDelete.kind === 'deck' ? 'Delete deck?' : 'Delete card?'}
          confirmLabel={pendingDelete.kind === 'deck' ? 'Delete deck' : 'Delete card'}
          onCancel={() => setPendingDelete(null)}
          onConfirm={async () => {
            if (pendingDelete.kind === 'deck') {
              await api().flashcards.removeDeck(pendingDelete.id);
              setPendingDelete(null);
              load();
              refreshAll();
            } else {
              await api().flashcards.removeCard(pendingDelete.id);
              setPendingDelete(null);
              openManage(pendingDelete.deckId);
            }
          }}
        >
          {pendingDelete.kind === 'deck' ? (
            <p>
              <strong>{pendingDelete.title}</strong> and its {pendingDelete.cardCount} card
              {pendingDelete.cardCount === 1 ? '' : 's'}, including their review schedule, will be
              deleted. This cannot be undone.
            </p>
          ) : (
            <p>
              The card <strong>{pendingDelete.title}</strong> and its review schedule will be deleted.
              This cannot be undone.
            </p>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}
