import { useCallback, useEffect, useRef, useState } from 'react';
import type { Note } from '../types';
import { api } from '../services/api';

interface Pending {
  noteId: number;
  title: string;
  content: string;
}

/**
 * Debounced note autosave that never drops the last keystrokes: the pending
 * edit is flushed immediately when the editor closes or switches note, when
 * the component unmounts, and when the window is closing. Owning its own
 * timer also keeps it from sharing one with unrelated debounces (the Notes
 * page used a single timer for search and autosave, so each cancelled the
 * other).
 */
export function useNoteAutosave(delayMs: number, onSaved: (note: Note) => void) {
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [failed, setFailed] = useState(false);
  const pending = useRef<Pending | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const edit = pending.current;
    if (!edit) return;
    pending.current = null;
    // The IPC request is dispatched synchronously, so it reaches the main
    // process even when this is called while the window is closing.
    api()
      .notes.update(edit.noteId, { title: edit.title, content: edit.content })
      .then((updated) => {
        if (!mounted.current) return;
        onSavedRef.current(updated);
        if (pending.current) return; // more typing happened meanwhile
        setSaving(false);
        setFailed(false);
        setSavedFlash(true);
        if (flashTimer.current) clearTimeout(flashTimer.current);
        flashTimer.current = setTimeout(() => setSavedFlash(false), 1200);
      })
      .catch(() => {
        if (!mounted.current) return;
        setSaving(false);
        setFailed(true);
      });
  }, []);

  const schedule = useCallback(
    (noteId: number, title: string, content: string) => {
      // Switching notes mid-debounce: save the previous note first.
      if (pending.current && pending.current.noteId !== noteId) flush();
      pending.current = { noteId, title, content };
      setSaving(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, delayMs);
    },
    [delayMs, flush],
  );

  /** Drops an unsaved edit, e.g. for a note that is being deleted. */
  const discard = useCallback((noteId: number) => {
    if (pending.current?.noteId !== noteId) return;
    pending.current = null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setSaving(false);
  }, []);

  useEffect(() => {
    mounted.current = true;
    window.addEventListener('ismalearn:window-closing', flush);
    return () => {
      window.removeEventListener('ismalearn:window-closing', flush);
      mounted.current = false;
      flush();
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, [flush]);

  return { schedule, flush, discard, saving, savedFlash, failed };
}
