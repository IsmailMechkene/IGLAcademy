import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, FileText, FileWarning, Play } from 'lucide-react';
import type { CourseDetail } from '../../types';
import { formatLength, formatTime } from '../../utils/format';
import { splitOrdinal } from '../../utils/titles';
import styles from './LessonSidebar.module.css';

interface Props {
  course: CourseDetail;
  activeLessonId: number;
  onSelectLesson: (lessonId: number) => void;
}

/**
 * The course's table of contents inside the player: collapsible sections with
 * per-section progress, the current lesson highlighted and kept in view.
 */
export default function LessonSidebar({ course, activeLessonId, onSelectLesson }: Props) {
  const activeSectionId = useMemo(
    () => course.sections.find((s) => s.lessons.some((l) => l.id === activeLessonId))?.id ?? null,
    [course, activeLessonId],
  );
  const [open, setOpen] = useState<Set<number>>(() => new Set(activeSectionId !== null ? [activeSectionId] : []));
  const activeRef = useRef<HTMLButtonElement>(null);

  // Following the lesson into a new section opens it.
  useEffect(() => {
    if (activeSectionId === null) return;
    setOpen((prev) => (prev.has(activeSectionId) ? prev : new Set(prev).add(activeSectionId)));
  }, [activeSectionId]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [activeLessonId, open]);

  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  let lessonNumber = 0;

  return (
    <div className={styles.list}>
      {course.sections.map((section, sIdx) => {
        const isOpen = open.has(section.id);
        const done = section.lessons.filter((l) => l.completed).length;
        const total = section.lessons.every((l) => l.duration !== null)
          ? section.lessons.reduce((n, l) => n + (l.duration ?? 0), 0)
          : 0;
        const { text: sectionTitle } = splitOrdinal(section.title);
        const firstNumber = lessonNumber;
        lessonNumber += section.lessons.length;
        return (
          <section key={section.id} className={`${styles.section} ${isOpen ? styles.sectionOpen : ''}`}>
            <button
              className={styles.sectionHeader}
              onClick={() => toggle(section.id)}
              aria-expanded={isOpen}
              title={section.title}
            >
              <span className={styles.sectionText}>
                <span className={styles.sectionEyebrow}>Section {sIdx + 1}</span>
                <span className={styles.sectionTitle}>{sectionTitle}</span>
                <span className={styles.sectionMeta}>
                  {done}/{section.lessons.length} done
                  {formatLength(total) && ` · ${formatLength(total)}`}
                </span>
              </span>
              <ChevronDown size={16} className={styles.chevron} />
            </button>
            {isOpen && (
              <div className={styles.lessons}>
                {section.lessons.map((lesson, i) => {
                  const active = lesson.id === activeLessonId;
                  const missing = lesson.missingSince !== null;
                  return (
                    <button
                      key={lesson.id}
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
                          <span className={styles.num}>{firstNumber + i + 1}</span>
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
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
