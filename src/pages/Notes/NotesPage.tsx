import { useEffect, useRef, useState } from 'react';
import { Check, FileText, FolderOpen, PlayCircle, Plus, Search, StickyNote, Trash2 } from 'lucide-react';
import type { Note } from '../../types';
import { api } from '../../services/api';
import { useApp } from '../../App';
import { formatDateTime } from '../../utils/format';
import { renderMarkdown } from '../../utils/markdown';
import styles from './NotesPage.module.css';

export default function NotesPage() {
  const { navigate, refreshKey } = useApp();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Note | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = (query?: string) => {
    setLoading(true);
    const p = query ? api().notes.search(query) : api().notes.list();
    p.then(setNotes)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load(search.trim() || undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const handleSearch = (value: string) => {
    setSearch(value);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => load(value.trim() || undefined), 300);
  };

  const openEditor = (note: Note) => {
    setEditing(note);
    setEditTitle(note.title);
    setEditContent(note.content);
  };

  const saveEdit = (noteId: number, title: string, content: string) => {
    setSaving(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api()
        .notes.update(noteId, { title, content })
        .then((updated) => {
          setNotes((prev) => prev.map((n) => (n.id === noteId ? updated : n)));
          setSaving(false);
          setSavedFlash(true);
          setTimeout(() => setSavedFlash(false), 1200);
        })
        .catch(() => setSaving(false));
    }, 500);
  };

  const createNote = () => {
    // Notes must belong to a course — use the first available one.
    api()
      .courses.list()
      .then((courses) => {
        if (courses.length === 0) {
          void api().app.showError('No courses', 'Import a course first to create notes.');
          return;
        }
        return api()
          .notes.create({ courseId: courses[0].id, title: '', content: '' })
          .then((note) => {
            setNotes((prev) => [note, ...prev]);
            openEditor(note);
          });
      })
      .catch(() => undefined);
  };

  const deleteNote = async (noteId: number) => {
    await api().notes.remove(noteId);
    setNotes((prev) => prev.filter((n) => n.id !== noteId));
    if (editing?.id === noteId) setEditing(null);
  };

  const jumpToNote = (note: Note) => {
    if (note.lessonId) {
      navigate({ name: 'player', courseId: note.courseId, lessonId: note.lessonId });
    } else {
      navigate({ name: 'course', courseId: note.courseId });
    }
  };

  return (
    <div className={`fade-in ${styles.page}`}>
      <div className={styles.header}>
        <h1>Notes</h1>
        <div className={styles.toolbar}>
          <div className={styles.searchWrap}>
            <span className={styles.searchIcon}>
              <Search size={15} />
            </span>
            <input
              className="input"
              style={{ paddingLeft: 40 }}
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
      ) : notes.length === 0 ? (
        <div className={`card ${styles.empty}`}>
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
                <div>
                  <div className={styles.noteTitle}>{note.title || 'Untitled note'}</div>
                  <div className={styles.noteContext}>
                    <FileText size={12} />
                    {note.courseTitle}
                    {note.lessonTitle && (
                      <>
                        <span>·</span>
                        <PlayCircle size={12} />
                        {note.lessonTitle}
                      </>
                    )}
                  </div>
                </div>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    openEditor(note);
                  }}
                >
                  Edit
                </button>
              </div>
              {note.content.trim() && (
                <div className={styles.noteContent}>
                  {renderMarkdown(note.content, {
                    onTimestampClick: (seconds) => {
                      if (note.lessonId) {
                        navigate({ name: 'player', courseId: note.courseId, lessonId: note.lessonId });
                        // seek happens on mount via timestamp — handled by player resume
                        void seconds;
                      }
                    },
                  })}
                </div>
              )}
              <div className={styles.noteMeta}>
                <span>Edited {formatDateTime(note.updatedAt)}</span>
                <button
                  className="btn btn-danger btn-sm"
                  style={{ marginLeft: 'auto' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    void deleteNote(note.id);
                  }}
                >
                  <Trash2 size={13} /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className={styles.editorOverlay} onClick={() => setEditing(null)}>
          <div className={`card ${styles.editorDialog}`} onClick={(e) => e.stopPropagation()}>
            <h2>Edit note</h2>
            <input
              className={`input ${styles.editorTitle}`}
              value={editTitle}
              placeholder="Note title"
              onChange={(e) => {
                setEditTitle(e.target.value);
                saveEdit(editing.id, e.target.value, editContent);
              }}
            />
            <textarea
              className={styles.editorTextarea}
              value={editContent}
              placeholder="Write your notes... Markdown supported."
              onChange={(e) => {
                setEditContent(e.target.value);
                saveEdit(editing.id, editTitle, e.target.value);
              }}
            />
            <div className={styles.editorFooter}>
              <div className={styles.left}>
                <button className="btn btn-danger btn-sm" onClick={() => deleteNote(editing.id)}>
                  <Trash2 size={13} /> Delete
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span className={styles.saveStatus}>
                  {saving ? 'Saving...' : savedFlash ? (
                    <span style={{ color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Check size={12} /> Saved
                    </span>
                  ) : (
                    `Edited ${formatDateTime(editing.updatedAt)}`
                  )}
                </span>
                <button className="btn btn-primary" onClick={() => setEditing(null)}>Done</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
