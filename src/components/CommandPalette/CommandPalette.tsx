import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  Brain, FileCheck2, ListChecks, Home, Layers, LibraryBig, PlayCircle, Search, Settings, StickyNote, CornerDownLeft,
} from 'lucide-react';
import type { GlobalSearchResults } from '../../types';
import type { Route } from '../../App';
import { api } from '../../services/api';
import { cleanTitle, splitOrdinal } from '../../utils/titles';
import styles from './CommandPalette.module.css';

interface Item {
  key: string;
  group: string;
  icon: ReactNode;
  title: string;
  subtitle?: string;
  route: Route;
}

const PAGES: Item[] = [
  { key: 'p-home', group: 'Go to', icon: <Home size={16} />, title: 'Home', route: { name: 'dashboard' } },
  { key: 'p-courses', group: 'Go to', icon: <LibraryBig size={16} />, title: 'Courses', route: { name: 'library' } },
  { key: 'p-practice', group: 'Go to', icon: <FileCheck2 size={16} />, title: 'Practice Exams', route: { name: 'practice' } },
  { key: 'p-review', group: 'Go to', icon: <Brain size={16} />, title: 'Review', route: { name: 'review' } },
  { key: 'p-notes', group: 'Go to', icon: <StickyNote size={16} />, title: 'Notes', route: { name: 'notes' } },
  { key: 'p-settings', group: 'Go to', icon: <Settings size={16} />, title: 'Settings', route: { name: 'settings' } },
];

function toItems(r: GlobalSearchResults): Item[] {
  return [
    ...r.courses.map((c) => ({
      key: `c${c.id}`,
      group: 'Courses',
      icon: <LibraryBig size={16} />,
      title: cleanTitle(c.title),
      subtitle: `${c.lessonCount} lessons`,
      route: { name: 'course', courseId: c.id } as Route,
    })),
    ...r.sections.map((sec) => ({
      key: `s${sec.id}`,
      group: 'Sections',
      icon: <Layers size={16} />,
      title: splitOrdinal(sec.title).text,
      subtitle: `${cleanTitle(sec.courseTitle)} · ${sec.lessonCount} lesson${sec.lessonCount === 1 ? '' : 's'}`,
      route: (sec.lessonId !== null
        ? { name: 'player', courseId: sec.courseId, lessonId: sec.lessonId }
        : { name: 'course', courseId: sec.courseId }) as Route,
    })),
    ...r.lessons.map((l) => ({
      key: `l${l.id}`,
      group: 'Lessons',
      icon: l.kind === 'practice' ? <ListChecks size={16} /> : <PlayCircle size={16} />,
      title: splitOrdinal(l.title).text,
      subtitle: `${cleanTitle(l.courseTitle)} · ${splitOrdinal(l.sectionTitle).text}`,
      route: { name: 'player', courseId: l.courseId, lessonId: l.id } as Route,
    })),
    ...r.notes.map((n) => ({
      key: `n${n.id}`,
      group: 'Notes',
      icon: <StickyNote size={16} />,
      title: n.title,
      subtitle: n.snippet,
      route: (n.lessonId !== null
        ? { name: 'player', courseId: n.courseId, lessonId: n.lessonId }
        : { name: 'notes' }) as Route,
    })),
    ...r.exams.map((e) => ({
      key: `e${e.filePath}`,
      group: 'Practice exams',
      icon: <FileCheck2 size={16} />,
      title: e.title,
      subtitle: `${e.questionCount} questions`,
      route: { name: 'examfile', filePath: e.filePath } as Route,
    })),
  ];
}

/** Bolds the matched part of a title. */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  const i = q ? text.toLowerCase().indexOf(q) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className={styles.mark}>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

/**
 * Ctrl+K: one search across courses, lessons, notes and practice exams, fully
 * keyboard-driven (↑ ↓ to move, Enter to open, Esc to close).
 */
export default function CommandPalette({ onClose, navigate }: { onClose: () => void; navigate: (r: Route) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GlobalSearchResults | null>(null);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced search; out-of-order responses are dropped.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    const id = ++requestRef.current;
    const timer = setTimeout(() => {
      api()
        .search.global(q)
        .then((r) => {
          if (id === requestRef.current) setResults(r);
        })
        .catch(() => undefined);
    }, 120);
    return () => clearTimeout(timer);
  }, [query]);

  const items = useMemo(() => {
    if (!query.trim()) return PAGES;
    if (!results) return [];
    const q = query.trim().toLowerCase();
    const pages = PAGES.filter((p) => p.title.toLowerCase().includes(q));
    return [...toItems(results), ...pages];
  }, [query, results]);

  useEffect(() => setActive(0), [items]);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const open = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    navigate(item.route);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (items.length ? (a + 1) % items.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (items.length ? (a - 1 + items.length) % items.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      open(items[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const searching = query.trim() !== '' && results === null;
  let lastGroup = '';

  return createPortal(
    <div className={styles.overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.palette} role="dialog" aria-modal="true" aria-label="Search">
        <div className={styles.inputRow}>
          <Search size={18} className={styles.searchIcon} aria-hidden="true" />
          <input
            ref={inputRef}
            className={styles.input}
            placeholder="Search courses, sections, lessons, notes and practice exams"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={items[active] ? `palette-${items[active].key}` : undefined}
            aria-label="Search everything"
          />
          <kbd>Esc</kbd>
        </div>

        <div className={styles.results} id="palette-results" role="listbox" ref={listRef}>
          {items.map((item, i) => {
            const header = item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <div key={item.key}>
                {header && <div className={styles.group}>{header}</div>}
                <div
                  id={`palette-${item.key}`}
                  role="option"
                  aria-selected={i === active}
                  className={`${styles.item} ${i === active ? styles.itemActive : ''}`}
                  onMouseMove={() => setActive(i)}
                  onClick={() => open(item)}
                >
                  <span className={styles.itemIcon}>{item.icon}</span>
                  <span className={styles.itemText}>
                    <span className={styles.itemTitle}><Highlight text={item.title} query={query} /></span>
                    {item.subtitle && <span className={styles.itemSub}>{item.subtitle}</span>}
                  </span>
                  {i === active && <CornerDownLeft size={14} className={styles.enter} aria-hidden="true" />}
                </div>
              </div>
            );
          })}
          {!searching && query.trim() && items.length === 0 && (
            <div className={styles.empty}>No matches for “{query.trim()}”.</div>
          )}
          {searching && <div className={styles.empty}>Searching…</div>}
        </div>

        <div className={styles.footer}>
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>Enter</kbd> open</span>
          <span><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
