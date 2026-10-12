import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, FileText, FileWarning, Play } from 'lucide-react';
import type { CourseDetail, LessonWithProgress, SectionWithLessons } from '../../types';
import { formatLength, formatTime } from '../../utils/format';
import { splitOrdinal } from '../../utils/titles';
import styles from './LessonSidebar.module.css';

interface Props {
  course: CourseDetail;
  activeLessonId: number;
  onSelectLesson: (lessonId: number) => void;
  className?: string;
}

type Row =
  | { kind: 'section'; key: string; section: SectionWithLessons; index: number; open: boolean }
  | { kind: 'lesson'; key: string; lesson: LessonWithProgress; number: number };

/** Above this many visible rows the list is windowed (only rows in view render). */
export const VIRTUALIZE_AFTER = 150;
/** Fixed row heights in windowed mode (single-line titles, full title in the tooltip). */
const SECTION_HEIGHT = 78;
const LESSON_HEIGHT = 58;
const OVERSCAN = 8;

/**
 * The course's table of contents inside the player: collapsible sections with
 * per-section progress, the current lesson highlighted and kept in view.
 * Long courses (thousands of lessons) are windowed so only what is on screen
 * is rendered, and the list ignores playback-time re-renders (memo).
 */
function LessonSidebar({ course, activeLessonId, onSelectLesson, className }: Props) {
  const activeSectionId = useMemo(
    () => course.sections.find((s) => s.lessons.some((l) => l.id === activeLessonId))?.id ?? null,
    [course, activeLessonId],
  );
  const [open, setOpen] = useState<Set<number>>(() => new Set(activeSectionId !== null ? [activeSectionId] : []));
  const scrollerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(800);

  // Following the lesson into a new section opens it.
  useEffect(() => {
    if (activeSectionId === null) return;
    setOpen((prev) => (prev.has(activeSectionId) ? prev : new Set(prev).add(activeSectionId)));
  }, [activeSectionId]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    let number = 0;
    course.sections.forEach((section, index) => {
      const isOpen = open.has(section.id);
      out.push({ kind: 'section', key: `s${section.id}`, section, index, open: isOpen });
      if (isOpen) {
        section.lessons.forEach((lesson, i) => {
          out.push({ kind: 'lesson', key: `l${lesson.id}`, lesson, number: number + i + 1 });
        });
      }
      number += section.lessons.length;
    });
    return out;
  }, [course, open]);

  const windowed = rows.length > VIRTUALIZE_AFTER;

  // Row offsets for windowed mode (prefix sums of fixed heights).
  const offsets = useMemo(() => {
    if (!windowed) return null;
    const tops = new Array<number>(rows.length + 1);
    tops[0] = 0;
    rows.forEach((r, i) => {
      tops[i + 1] = tops[i] + (r.kind === 'section' ? SECTION_HEIGHT : LESSON_HEIGHT);
    });
    return tops;
  }, [rows, windowed]);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setViewport(el.clientHeight);
    const observer = new ResizeObserver(() => setViewport(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Keep the current lesson in view.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    if (!windowed || !offsets) {
      activeRef.current?.scrollIntoView({ block: 'nearest' });
      return;
    }
    const index = rows.findIndex((r) => r.kind === 'lesson' && r.lesson.id === activeLessonId);
    if (index < 0) return;
    const top = offsets[index];
    const bottom = offsets[index + 1];
    if (top < el.scrollTop) el.scrollTop = Math.max(0, top - LESSON_HEIGHT);
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight + LESSON_HEIGHT;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run on lesson/section changes, not on every scroll
  }, [activeLessonId, windowed, open]);

  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderSection = (row: Extract<Row, { kind: 'section' }>) => {
    const { section, index, open: isOpen } = row;
    const done = section.lessons.filter((l) => l.completed).length;
    const total = section.lessons.every((l) => l.duration !== null)
      ? section.lessons.reduce((n, l) => n + (l.duration ?? 0), 0)
      : 0;
    return (
      <button
        className={`${styles.sectionHeader} ${isOpen ? styles.sectionOpen : ''}`}
        onClick={() => toggle(section.id)}
        aria-expanded={isOpen}
        title={section.title}
      >
        <span className={styles.sectionText}>
          <span className={styles.sectionEyebrow}>Section {index + 1}</span>
          <span className={styles.sectionTitle}>{splitOrdinal(section.title).text}</span>
          <span className={styles.sectionMeta}>
            {done}/{section.lessons.length} done
            {formatLength(total) && ` · ${formatLength(total)}`}
          </span>
        </span>
        <ChevronDown size={16} className={styles.chevron} />
      </button>
    );
  };

  const renderLesson = (row: Extract<Row, { kind: 'lesson' }>) => {
    const { lesson, number } = row;
    const active = lesson.id === activeLessonId;
    const missing = lesson.missingSince !== null;
    return (
      <button
        ref={active ? activeRef : undefined}
        className={`${styles.lessonRow} ${active ? styles.active : ''} ${lesson.completed ? styles.done : ''}`}
        onClick={() => onSelectLesson(lesson.id)}
        aria-current={active ? 'true' : undefined}
        title={missing ? `${lesson.title} — file missing (progress and notes kept)` : lesson.title}
      >
        <span className={styles.status} aria-hidden="true">
          {missing ? (
            <FileWarning size={14} />
          ) : active ? (
            <Play size={11} fill="currentColor" />
          ) : lesson.completed ? (
            <Check size={12} strokeWidth={3} />
          ) : lesson.fileType === 'practice' ? (
            <FileText size={12} />
          ) : (
            <span className={styles.num}>{number}</span>
          )}
        </span>
        <span className={styles.lessonText}>
          <span className={styles.lessonTitle}>{splitOrdinal(lesson.title).text}</span>
          <span className={styles.lessonMeta}>
            {lesson.fileType === 'practice' ? 'Practice test' : 'Video'}
            {lesson.duration !== null && ` · ${formatTime(lesson.duration)}`}
            {missing && ' · File missing'}
          </span>
        </span>
      </button>
    );
  };

  if (!windowed || !offsets) {
    // Small course: plain list, titles may wrap.
    return (
      <div ref={scrollerRef} className={`${styles.scroller} ${className ?? ''}`}>
        <div className={styles.list}>
          {course.sections.map((section) => {
            const sectionRows = rows.filter(
              (r) => (r.kind === 'section' && r.section.id === section.id) ||
                (r.kind === 'lesson' && r.lesson.sectionId === section.id),
            );
            const [head, ...lessons] = sectionRows;
            return (
              <section key={section.id} className={styles.section}>
                {head && head.kind === 'section' && renderSection(head)}
                {lessons.length > 0 && (
                  <div className={styles.lessons}>
                    {lessons.map((r) => (r.kind === 'lesson' ? <div key={r.key}>{renderLesson(r)}</div> : null))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
    );
  }

  // Windowed: only the rows intersecting the viewport (plus overscan) render.
  const total = offsets[rows.length];
  let first = 0;
  let lo = 0;
  let hi = rows.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid + 1] <= scrollTop) lo = mid + 1;
    else {
      first = mid;
      hi = mid - 1;
    }
  }
  first = Math.max(0, first - OVERSCAN);
  let last = first;
  while (last < rows.length && offsets[last] < scrollTop + viewport) last++;
  last = Math.min(rows.length, last + OVERSCAN);

  return (
    <div
      ref={scrollerRef}
      className={`${styles.scroller} ${styles.windowed} ${className ?? ''}`}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      data-windowed="true"
    >
      <div className={styles.list} style={{ height: total + 32, position: 'relative' }}>
        {rows.slice(first, last).map((row, i) => {
          const index = first + i;
          return (
            <div
              key={row.key}
              className={row.kind === 'section' ? styles.windowSection : styles.windowLesson}
              style={{ position: 'absolute', top: offsets[index] + 8, left: 10, right: 10 }}
            >
              {row.kind === 'section' ? renderSection(row) : renderLesson(row)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// The player re-renders several times a second while a video plays; the
// table of contents only needs to change when its own props do.
export default memo(LessonSidebar);
