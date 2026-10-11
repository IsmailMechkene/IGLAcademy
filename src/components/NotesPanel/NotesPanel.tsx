import { useEffect, useRef, useState } from 'react';
import { Check, Clock, FileText, Pencil, Plus, StickyNote, Trash2, X } from 'lucide-react';
import type { Note } from '../../types';
import { api } from '../../services/api';
import { formatDateTime, formatTime, markdownPreview } from '../../utils/format';
import { renderMarkdown } from '../../utils/markdown';
import { useNoteAutosave } from '../../utils/useNoteAutosave';
import ConfirmDialog from '../Modal/ConfirmDialog';
import styles from './NotesPanel.module.css';

interface Props {
  courseId: number;
  lessonId: number | null;
  lessonTitle: string | null;
  currentTime: number;
  onTimestampClick: (seconds: number) => void;
  refreshKey: number;
  /** Rendered inside the player's tabbed panel: no own title or border. */
  embedded?: boolean;
}

export default function NotesPanel({ courseId, lessonId, lessonTitle, currentTime, onTimestampClick, refreshKey, embedded }: Props) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<number | null>(null);
  const [view, setViewState] = useState<'list' | 'edit' | 'preview'>('list');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [listError, setListError] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Note | null>(null);
  const contentRef = useRef(content);
  contentRef.current = content;
  const { schedule: scheduleSave, flush, discard, saving, savedFlash, failed: saveFailed } = useNoteAutosave(
    600,
    (updated) => setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n))),
  );

  // Leaving the editor (back to the list, or to the preview, which renders
  // the saved note) must not wait out the debounce.
  const setView = (next: 'list' | 'edit' | 'preview') => {
    if (next !== 'edit') flush();
    setViewState(next);
  };

  const loadNotes = () => {
    setListError(false);
    api()
      .notes.list(courseId)
      .then(setNotes)
      .catch(() => setListError(true));
  };

  useEffect(loadNotes, [courseId, refreshKey]);

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
    flush();
    setActiveNoteId(note.id);
    setTitle(note.title);
    setContent(note.content);
    setView('edit');
  };

  const deleteNote = async (noteId: number) => {
    discard(noteId);
    await api().notes.remove(noteId);
    setConfirmDelete(null);
    setNotes((prev) => prev.filter((n) => n.id !== noteId));
    if (activeNoteId === noteId) {
      setView('list');
      setActiveNoteId(null);
    }
  };

  const insertTimestamp = () => {
    const ts = `[${formatTime(currentTime)}](t=${Math.floor(currentTime)})`;
    const next = contentRef.current ? `${contentRef.current}\n${ts}` : ts;
    setContent(next);
    // Inserting a timestamp is an edit like any other: it used to change the
    // text without ever saving it.
    if (activeNoteId !== null) scheduleSave(activeNoteId, title, next);
  };

  const activeNote = notes.find((n) => n.id === activeNoteId) ?? null;

  return (
    <div className={`${styles.panel} ${embedded ? styles.embedded : ''}`}>
      <div className={styles.header}>
        {embedded ? (
          <span className={styles.headerHint}>
            {view === 'list' ? `${notes.length} note${notes.length === 1 ? '' : 's'} in this course` : 'Editing note'}
          </span>
        ) : (
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <StickyNote size={15} />
            Notes
          </h3>
        )}
        <div className={styles.headerActions}>
          {view !== 'list' && (
            <button className="btn btn-ghost btn-sm" title="Back to notes" aria-label="Back to notes" onClick={() => setView('list')}>
              <X size={14} /> Close
            </button>
          )}
          {view === 'list' && (
            <button className="btn btn-soft btn-sm" title="New note" aria-label="New note" onClick={createNote}>
              <Plus size={14} /> New note
            </button>
          )}
        </div>
      </div>

      {view === 'list' && (
        <div className={styles.list}>
          {listError ? (
            <div className={styles.emptyNotes}>
              <div>Couldn't load notes.</div>
              <button className="btn btn-ghost btn-sm" onClick={loadNotes} style={{ marginTop: 8 }}>
                Try again
              </button>
            </div>
          ) : notes.length === 0 ? (
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
                  {note.content ? markdownPreview(note.content) : 'Empty note'}
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
              {saveFailed && !saving && <span style={{ color: 'var(--danger)' }}>Not saved</span>}
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
                onClick={() => setConfirmDelete(activeNote)}
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
      {confirmDelete && (
        <ConfirmDialog
          title="Delete note?"
          confirmLabel="Delete note"
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => deleteNote(confirmDelete.id)}
        >
          <p>
            <strong>{confirmDelete.title || 'Untitled note'}</strong> will be deleted. This cannot be undone.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
