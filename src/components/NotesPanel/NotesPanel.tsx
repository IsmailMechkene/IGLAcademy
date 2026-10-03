import { useEffect, useRef, useState } from 'react';
import { Check, Clock, FileText, Pencil, Plus, StickyNote, Trash2, X } from 'lucide-react';
import type { Note } from '../../types';
import { api } from '../../services/api';
import { formatDateTime, formatTime } from '../../utils/format';
import { renderMarkdown } from '../../utils/markdown';
import styles from './NotesPanel.module.css';

interface Props {
  courseId: number;
  lessonId: number | null;
  lessonTitle: string | null;
  currentTime: number;
  onTimestampClick: (seconds: number) => void;
  refreshKey: number;
}

export default function NotesPanel({ courseId, lessonId, lessonTitle, currentTime, onTimestampClick, refreshKey }: Props) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<number | null>(null);
  const [view, setView] = useState<'list' | 'edit' | 'preview'>('list');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentRef = useRef(content);
  contentRef.current = content;

  const loadNotes = () => {
    api()
      .notes.list(courseId)
      .then(setNotes)
      .catch(() => undefined);
  };

  useEffect(loadNotes, [courseId, refreshKey]);

  // Auto-save with debounce
  const scheduleSave = (noteId: number, newTitle: string, newContent: string) => {
    setSaving(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api()
        .notes.update(noteId, { title: newTitle, content: newContent })
        .then((updated) => {
          setNotes((prev) => prev.map((n) => (n.id === noteId ? updated : n)));
          setSaving(false);
          setSavedFlash(true);
          setTimeout(() => setSavedFlash(false), 1200);
        })
        .catch(() => setSaving(false));
    }, 600);
  };

  const createNote = () => {
    api()
      .notes.create({
        courseId,
        lessonId,
        title: lessonTitle ? `Note: ${lessonTitle}` : '',
        content: '',
      })
      .then((note) => {
        setNotes((prev) => [note, ...prev]);
        openEditor(note);
      })
      .catch(() => undefined);
  };

  const openEditor = (note: Note) => {
    setActiveNoteId(note.id);
    setTitle(note.title);
    setContent(note.content);
    setView('edit');
  };

  const deleteNote = async (noteId: number) => {
    await api().notes.remove(noteId);
    setNotes((prev) => prev.filter((n) => n.id !== noteId));
    if (activeNoteId === noteId) {
      setView('list');
      setActiveNoteId(null);
    }
  };

  const insertTimestamp = () => {
    const ts = `[${formatTime(currentTime)}](t=${Math.floor(currentTime)})`;
    setContent((prev) => (prev ? `${prev}\n${ts}` : ts));
  };

  const activeNote = notes.find((n) => n.id === activeNoteId) ?? null;

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <StickyNote size={15} />
          Notes
        </h3>
        <div className={styles.headerActions}>
          {view !== 'list' && (
            <button className={styles.iconBtn} title="Back to notes" aria-label="Back to notes" onClick={() => setView('list')}>
              <X size={15} />
            </button>
          )}
          {view === 'list' && (
            <button className={styles.iconBtn} title="New note" aria-label="New note" onClick={createNote}>
              <Plus size={16} />
            </button>
          )}
        </div>
      </div>

      {view === 'list' && (
        <div className={styles.list}>
          {notes.length === 0 ? (
            <div className={styles.emptyNotes}>
              <FileText size={22} style={{ marginBottom: 6, opacity: 0.5 }} />
              <div>No notes yet.</div>
              <div>Create one to remember key moments.</div>
            </div>
          ) : (
            notes.map((note) => (
              <div
                key={note.id}
                className={`card ${styles.noteCard} ${note.id === activeNoteId ? styles.active : ''}`}
                onClick={() => openEditor(note)}
              >
                <div className={styles.noteTitle}>{note.title || 'Untitled note'}</div>
                <div className={styles.notePreview}>
                  {note.content ? note.content.slice(0, 120) : 'Empty note'}
                </div>
                <div className={styles.noteDate}>{formatDateTime(note.updatedAt)}</div>
              </div>
            ))
          )}
        </div>
      )}

      {view === 'edit' && activeNote && (
        <div className={styles.editor}>
          <div className={styles.editorHeader}>
            <input
              className={styles.editorTitle}
              style={{
                background: 'transparent', border: 'none', outline: 'none', color: 'var(--text)',
                padding: 0,
              }}
              value={title}
              placeholder="Note title"
              onChange={(e) => {
                setTitle(e.target.value);
                scheduleSave(activeNote.id, e.target.value, contentRef.current);
              }}
            />
            <div className={styles.editorMeta}>
              {lessonTitle && <span>Re: {lessonTitle}</span>}
              <span>Edited {formatDateTime(activeNote.updatedAt)}</span>
              {saving && <span style={{ color: 'var(--warning)' }}>Saving...</span>}
              {savedFlash && !saving && (
                <span style={{ color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <Check size={11} /> Saved
                </span>
              )}
            </div>
            <div className={styles.editorToolbar}>
              <button className="btn btn-ghost btn-sm" onClick={insertTimestamp} title="Insert timestamp at current video position">
                <Clock size={13} /> {formatTime(currentTime)}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setView('preview')}
                title="Preview markdown"
              >
                <Pencil size={13} /> Preview
              </button>
              <button
                className="btn btn-danger btn-sm"
                onClick={() => deleteNote(activeNote.id)}
                title="Delete note"
                aria-label="Delete note"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
          <div className={styles.editorBody}>
            <textarea
              className={styles.editorTextarea}
              value={content}
              placeholder="Write your notes here... Markdown supported. Use the timestamp button to link a moment in the video."
              onChange={(e) => {
                setContent(e.target.value);
                scheduleSave(activeNote.id, title, e.target.value);
              }}
            />
          </div>
        </div>
      )}

      {view === 'preview' && activeNote && (
        <div className={styles.editor}>
          <div className={styles.editorHeader}>
            <div className={styles.editorTitle}>{activeNote.title || 'Untitled note'}</div>
            <div className={styles.editorToolbar}>
              <button className="btn btn-ghost btn-sm" onClick={() => setView('edit')}>
                <Pencil size={13} /> Back to editing
              </button>
            </div>
          </div>
          <div className={styles.editorBody}>
            <div className={styles.preview}>
              {activeNote.content.trim() ? (
                renderMarkdown(activeNote.content, { onTimestampClick })
              ) : (
                <span className={styles.previewEmpty}>Nothing to preview yet.</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
