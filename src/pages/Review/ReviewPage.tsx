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
  const [tab, setTab] = useState<'cards' | 'later' | 'bookmarks'>('cards');
  const [showNewDeck, setShowNewDeck] = useState(false);
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
    if (!courseId) return;
    if (newDeckSource === 'manual' && !newDeckTitle.trim()) return;
    try {
      if (newDeckSource === 'quiz' && newDeckQuiz) {
        await api().flashcards.fromQuiz({ courseId, quizId: Number(newDeckQuiz) });
      } else if (newDeckSource === 'notes') {
        await api().flashcards.fromNotes(courseId);
      } else {
        await api().flashcards.createDeck({ courseId, title: newDeckTitle.trim(), source: 'manual' });
      }
      setNewDeckTitle('');
      setShowNewDeck(false);
      setTab('cards');
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
  const canCreateDeck =
    Boolean(newDeckCourse) &&
    !(newDeckSource === 'manual' && !newDeckTitle.trim()) &&
    !(newDeckSource === 'quiz' && !newDeckQuiz);

  return (
    <div className="page fade-in">
      <div className="page-header">
        <div>
          <h1>Review</h1>
          <p>Spaced-repetition flashcards, your review-later queue and bookmarked moments.</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => setShowNewDeck(true)} disabled={courses.length === 0}>
            <Plus size={16} /> New deck
          </button>
        </div>
      </div>

      {loading ? (
        <div className="muted">Loading review space...</div>
      ) : loadError ? (
        <LoadError message="Could not load your review space." onRetry={load} />
      ) : (
        <>
          {(due.itemsDue > 0 || due.cardsDue > 0) && (
            <div className={`card ${styles.dueBanner}`}>
              <span className={styles.dueIcon}><Brain size={20} /></span>
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

          <div className="tabs" role="tablist" aria-label="Review sections">
            <button role="tab" className="tab" aria-selected={tab === 'cards'} onClick={() => setTab('cards')}>
              Flashcards <span className="count">{decks.length}</span>
            </button>
            <button role="tab" className="tab" aria-selected={tab === 'later'} onClick={() => setTab('later')}>
              Review later <span className="count">{pendingItems.length}</span>
            </button>
            <button role="tab" className="tab" aria-selected={tab === 'bookmarks'} onClick={() => setTab('bookmarks')}>
              Bookmarks <span className="count">{bookmarks.length}</span>
            </button>
          </div>

          {tab === 'cards' && (
          <section className={styles.section} aria-label="Flashcards">
            {decks.length === 0 ? (
              <div className={`card emptyState ${styles.emptyCard}`}>
                <div className="emptyIcon"><Layers size={24} /></div>
                <h2>No flashcard decks yet</h2>
                <p>Build a deck by hand, or generate one from a quiz or from your notes. Cards are scheduled with spaced repetition.</p>
                <button className="btn btn-primary" onClick={() => setShowNewDeck(true)} disabled={courses.length === 0}>
                  <Plus size={16} /> New deck
                </button>
              </div>
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
                          className={`btn btn-sm ${deck.dueCount > 0 ? 'btn-primary' : 'btn-soft'}`}
                          disabled={deck.cardCount === 0}
                          onClick={() => setSession({ deckId: deck.id, title: deck.title, all: deck.dueCount === 0 })}
                        >
                          <PlayCircle size={14} /> Review
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => openManage(deck.id)}>
                          Cards
                        </button>
                        <button
                          className="iconBtn danger"
                          title="Delete deck"
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
          )}

          {tab === 'later' && (
          <section className={styles.section} aria-label="Review later queue">
            {pendingItems.length === 0 && doneItems.length === 0 ? (
              <div className={`card emptyState ${styles.emptyCard}`}>
                <div className="emptyIcon"><Clock size={24} /></div>
                <h2>Nothing queued</h2>
                <p>Use the “review later” button on a lesson, note or practice exam to come back to it here.</p>
              </div>
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
          )}

          {tab === 'bookmarks' && (
          <section className={styles.section} aria-label="Bookmarks">
            {bookmarks.length === 0 ? (
              <div className={`card emptyState ${styles.emptyCard}`}>
                <div className="emptyIcon"><Bookmark size={24} /></div>
                <h2>No bookmarks yet</h2>
                <p>Press <kbd>B</kbd> while watching to bookmark a moment, then jump straight back to it from here.</p>
              </div>
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
          )}
        </>
      )}

      {showNewDeck && (
        <Modal label="New flashcard deck" onClose={() => setShowNewDeck(false)}>
          <h2>New flashcard deck</h2>
          <div className={styles.deckForm}>
            <label className={styles.field}>
              <span>Course</span>
              <select
                className="input"
                value={newDeckCourse}
                onChange={(e) => setNewDeckCourse(e.target.value)}
              >
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span>Start from</span>
              <select
                className="input"
                value={newDeckSource}
                onChange={(e) => setNewDeckSource(e.target.value as 'manual' | 'quiz' | 'notes')}
              >
                <option value="manual">A blank deck</option>
                <option value="quiz">A quiz (one card per question)</option>
                <option value="notes">This course's notes</option>
              </select>
            </label>
            {newDeckSource === 'manual' && (
              <label className={styles.field}>
                <span>Deck title</span>
                <input
                  className="input"
                  placeholder="e.g. IAM essentials"
                  value={newDeckTitle}
                  data-autofocus
                  onChange={(e) => setNewDeckTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && canCreateDeck) void createDeck();
                  }}
                />
              </label>
            )}
            {newDeckSource === 'quiz' && (
              <label className={styles.field}>
                <span>Quiz</span>
                <select
                  className="input"
                  value={newDeckQuiz}
                  onChange={(e) => setNewDeckQuiz(e.target.value)}
                >
                  <option value="">{quizzesForCourse.length === 0 ? 'This course has no quizzes' : 'Choose a quiz…'}</option>
                  {quizzesForCourse.map((q) => (
                    <option key={q.id} value={q.id}>{q.title}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button className="btn btn-ghost" onClick={() => setShowNewDeck(false)}>Cancel</button>
            <button className="btn btn-primary" disabled={!canCreateDeck} onClick={() => void createDeck()}>
              <Plus size={15} /> Create deck
            </button>
          </div>
        </Modal>
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
