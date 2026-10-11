import { useEffect, useRef, useState } from 'react';
import { Check, Clock3, FileText, FolderOpen, Pencil, PlayCircle, Plus, Search, StickyNote, Trash2 } from 'lucide-react';
import type { CourseWithProgress, Note } from '../../types';
import { api } from '../../services/api';
import { useApp } from '../../App';
import { formatDateTime } from '../../utils/format';
import { cleanTitle, splitOrdinal } from '../../utils/titles';
import { renderMarkdown } from '../../utils/markdown';
import LoadError from '../../components/LoadError/LoadError';
import Modal from '../../components/Modal/Modal';
import ConfirmDialog from '../../components/Modal/ConfirmDialog';
import { useNoteAutosave } from '../../utils/useNoteAutosave';
import styles from './NotesPage.module.css';

export default function NotesPage() {
  const { navigate, refreshKey } = useApp();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Note | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<Note | null>(null);
  // Choosing the course for a new note: null = closed.
  const [newNoteCourses, setNewNoteCourses] = useState<CourseWithProgress[] | null>(null);
  const [newNoteCourseId, setNewNoteCourseId] = useState<number | null>(null);
  // Search has its own timer — it used to share one with autosave, so typing
  // in either cancelled the other's pending work.
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { schedule: saveEdit, flush, discard, saving, savedFlash, failed: saveFailed } = useNoteAutosave(
    500,
    (updated) => {
      setNotes((prev) => prev.map((n) => (n.id === updated.id ? { ...n, ...updated } : n)));
      setEditing((prev) => (prev?.id === updated.id ? { ...prev, ...updated } : prev));
    },
  );

  const load = (query?: string) => {
    setLoading(true);
    setLoadError(false);
    const p = query ? api().notes.search(query) : api().notes.list();
    p.then(setNotes)
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load(search.trim() || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const handleSearch = (value: string) => {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => load(value.trim() || undefined), 300);
  };

  useEffect(() => () => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
  }, []);

  const openEditor = (note: Note) => {
    setEditing(note);
    setEditTitle(note.title);
    setEditContent(note.content);
  };

  const closeEditor = () => {
    flush();
    setEditing(null);
  };

  // A note belongs to exactly one course. It used to be attached silently to
  // whichever course sorted first; now the user picks (or, with a single
  // course, it is unambiguous).
  const createNote = () => {
    api()
      .courses.list()
      .then((courses) => {
        if (courses.length === 0) {
          void api().app.showError('No courses', 'Import a course first to create notes.');
          return;
        }
        if (courses.length === 1) {
          createNoteIn(courses[0].id);
          return;
        }
        setNewNoteCourses(courses);
        setNewNoteCourseId(courses[0].id);
      })
      .catch(() => undefined);
  };

  const createNoteIn = (courseId: number) => {
    setNewNoteCourses(null);
    api()
      .notes.create({ courseId, title: '', content: '' })
      .then((note) => {
        setNotes((prev) => [note, ...prev]);
        openEditor(note);
      })
      .catch(() => void api().app.showError('Note not created', 'The note could not be created. Please try again.'));
  };

  const deleteNote = async (noteId: number) => {
    discard(noteId);
    await api().notes.remove(noteId);
    setNotes((prev) => prev.filter((n) => n.id !== noteId));
    if (editing?.id === noteId) setEditing(null);
    setConfirmDelete(null);
  };

  const jumpToNote = (note: Note) => {
    if (note.lessonId) {
      navigate({ name: 'player', courseId: note.courseId, lessonId: note.lessonId });
    } else {
      navigate({ name: 'course', courseId: note.courseId });
    }
  };

  return (
    <div className="page fade-in">
      <div className="page-header">
        <div>
          <h1>Notes</h1>
          <p>Everything you have written while learning, searchable in one place.</p>
        </div>
        <div className="page-actions">
          <div className={styles.searchWrap}>
            <span className={styles.searchIcon}>
              <Search size={15} />
            </span>
            <input
              className="input"
              style={{ paddingLeft: 38, width: 280 }}
              placeholder="Search notes..."
              aria-label="Search notes"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
            />
          </div>
          <button className="btn btn-primary" onClick={createNote}>
            <Plus size={16} /> New note
          </button>
        </div>
      </div>

      {loading ? (
        <div className="muted">Loading notes...</div>
      ) : loadError ? (
        <LoadError message="Could not load your notes." onRetry={() => load(search.trim() || undefined)} />
      ) : notes.length === 0 ? (
        <div className={`card emptyState ${styles.empty}`}>
          <StickyNote size={32} style={{ opacity: 0.4, marginBottom: 4 }} />
          <h2>{search ? 'No notes match your search' : 'No notes yet'}</h2>
          <p>{search ? 'Try a different search term.' : 'Open a lesson and use the notes panel to write your first note.'}</p>
          {!search && (
            <button className="btn btn-primary" onClick={() => navigate({ name: 'library' })}>
              <FolderOpen size={16} />
              Browse courses
            </button>
          )}
        </div>
      ) : (
        <div className={styles.notesList}>
          {notes.map((note) => (
            <div key={note.id} className={`card ${styles.noteCard}`} onClick={() => jumpToNote(note)}>
              <div className={styles.noteTop}>
                <div className={styles.noteHeading}>
                  <div className={styles.noteTitle}>{note.title || 'Untitled note'}</div>
                  <div className={styles.noteContext}>
                    <span className={styles.contextChip} title={note.courseTitle}>
                      <FileText size={12} />
                      {cleanTitle(note.courseTitle)}
                    </span>
                    {note.lessonTitle && (
                      <span className={styles.contextChip} title={note.lessonTitle}>
                        <PlayCircle size={12} />
                        {splitOrdinal(note.lessonTitle).text}
                      </span>
                    )}
                  </div>
                </div>
                <div className={styles.noteActions} onClick={(e) => e.stopPropagation()}>
                  <button
                    className="iconBtn"
                    title="Review this note later"
                    aria-label="Review this note later"
                    onClick={() => {
                      void api().review.add({
                        courseId: note.courseId,
                        kind: 'note',
                        refId: String(note.id),
                        title: note.title || 'Untitled note',
                      });
                    }}
                  >
                    <Clock3 size={15} />
                  </button>
                  <button className="iconBtn" title="Edit note" aria-label="Edit note" onClick={() => openEditor(note)}>
                    <Pencil size={15} />
                  </button>
                  <button
                    className="iconBtn danger"
                    title="Delete note"
                    aria-label="Delete note"
                    onClick={() => setConfirmDelete(note)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
              {note.content.trim() && (
                <div className={styles.noteContent}>
                  {renderMarkdown(note.content, {
                    onTimestampClick: (seconds) => {
                      if (note.lessonId) {
                        // startAt is what makes the player actually seek —
                        // it used to be dropped, so the link just opened the
                        // lesson at its saved position.
                        navigate({
                          name: 'player',
                          courseId: note.courseId,
                          lessonId: note.lessonId,
                          startAt: Math.floor(seconds),
                        });
                      }
                    },
                  })}
                </div>
              )}
              <div className={styles.noteMeta}>
                <span>Edited {formatDateTime(note.updatedAt)}</span>
                {note.lessonId && <span className={styles.openLesson}>Open lesson →</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <Modal label="Edit note" onClose={closeEditor} wide>
          <h2>Edit note</h2>
          <div className={styles.noteContext} style={{ marginBottom: 10 }}>
            <FileText size={12} />
            {editing.courseTitle}
            {editing.lessonTitle && (
              <>
                <span>·</span>
                <PlayCircle size={12} />
                {editing.lessonTitle}
              </>
            )}
          </div>
          <input
            className={`input ${styles.editorTitle}`}
            value={editTitle}
            placeholder="Note title"
            aria-label="Note title"
            data-autofocus
            onChange={(e) => {
              setEditTitle(e.target.value);
              saveEdit(editing.id, e.target.value, editContent);
            }}
          />
          <textarea
            className={styles.editorTextarea}
            value={editContent}
            placeholder="Write your notes... Markdown supported."
            aria-label="Note content"
            onChange={(e) => {
              setEditContent(e.target.value);
              saveEdit(editing.id, editTitle, e.target.value);
            }}
          />
          <div className={styles.editorFooter}>
            <div className={styles.left}>
              <button className="btn btn-danger btn-sm" onClick={() => setConfirmDelete(editing)}>
                <Trash2 size={13} /> Delete
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className={styles.saveStatus}>
                {saving ? 'Saving...' : saveFailed ? (
                  <span style={{ color: 'var(--danger)' }}>Not saved — keep typing to retry</span>
                ) : savedFlash ? (
                  <span style={{ color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Check size={12} /> Saved
                  </span>
                ) : (
                  `Edited ${formatDateTime(editing.updatedAt)}`
                )}
              </span>
              <button className="btn btn-primary" onClick={closeEditor}>Done</button>
            </div>
          </div>
        </Modal>
      )}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete note?"
          confirmLabel="Delete note"
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => deleteNote(confirmDelete.id)}
        >
          <p>
            <strong>{confirmDelete.title || 'Untitled note'}</strong>
            {confirmDelete.courseTitle ? ` in ${confirmDelete.courseTitle}` : ''} will be deleted.
            This cannot be undone.
          </p>
        </ConfirmDialog>
      )}

      {newNoteCourses && (
        <Modal label="New note" onClose={() => setNewNoteCourses(null)}>
          <h2>New note</h2>
          <p className="muted">Which course is this note for?</p>
          <select
            className="input"
            aria-label="Course"
            data-autofocus
            value={newNoteCourseId ?? ''}
            onChange={(e) => setNewNoteCourseId(Number(e.target.value))}
            style={{ marginBottom: 16 }}
          >
            {newNoteCourses.map((c) => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button className="btn btn-ghost" onClick={() => setNewNoteCourses(null)}>Cancel</button>
            <button
              className="btn btn-primary"
              disabled={newNoteCourseId === null}
              onClick={() => newNoteCourseId !== null && createNoteIn(newNoteCourseId)}
            >
              <Plus size={15} /> Create note
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
