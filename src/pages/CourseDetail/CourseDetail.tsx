import { useEffect, useState } from 'react';
import {
  ArrowLeft, BookOpen, CheckCircle2, ChevronDown, ListChecks, Pencil, PlayCircle,
  RefreshCw, GraduationCap,
} from 'lucide-react';
import type { CourseDetail as CourseDetailType } from '../../types';
import { api } from '../../services/api';
import { useApp } from '../../App';
import { formatTime } from '../../utils/format';
import ProgressBar from '../../components/ProgressBar/ProgressBar';
import QuizManager from '../../components/Quiz/QuizManager';
import styles from './CourseDetail.module.css';

interface Props {
  courseId: number;
}

export default function CourseDetail({ courseId }: Props) {
  const { navigate, refreshAll, refreshKey } = useApp();
  const [course, setCourse] = useState<CourseDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [thumb, setThumb] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<Set<number>>(new Set());
  const [renaming, setRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api()
      .courses.get(courseId)
      .then((c) => {
        if (cancelled) return;
        setCourse(c);
        if (c && c.sections.length > 0) {
          setOpenSections(new Set([c.sections[0].id]));
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    api()
      .courses.thumbnailUrl(courseId)
      .then((url) => {
        if (!cancelled) setThumb(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [courseId, refreshKey]);

  // Mark course as opened (for "recently opened")
  useEffect(() => {
    api().courses.markOpened(courseId).catch(() => undefined);
  }, [courseId]);

  if (loading) {
    return <div className="muted" style={{ padding: 48 }}>Loading course...</div>;
  }

  if (!course) {
    return (
      <div className={styles.page}>
        <button className="btn btn-ghost" onClick={() => navigate({ name: 'library' })}>
          <ArrowLeft size={15} /> Back to library
        </button>
        <div className={`card ${styles.empty}`}>Course not found.</div>
      </div>
    );
  }

  const toggleSection = (id: number) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const firstIncomplete = course.sections
    .flatMap((s) => s.lessons)
    .find((l) => !l.completed);
  const continueLesson = firstIncomplete ?? course.sections.flatMap((s) => s.lessons)[0];

  const openLesson = (lessonId: number) => {
    navigate({ name: 'player', courseId: course.id, lessonId });
  };

  return (
    <div className={`fade-in ${styles.page}`}>
      <button className={`btn btn-ghost ${styles.backButton}`} onClick={() => navigate({ name: 'library' })}>
        <ArrowLeft size={15} /> Back to library
      </button>

      <div className={styles.header}>
        <div className={styles.thumbnail}>
          {thumb ? (
            <img src={thumb} alt="" />
          ) : (
            <GraduationCap size={48} strokeWidth={1.4} />
          )}
        </div>
        <div className={styles.headerInfo}>
          {renaming ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="input"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                autoFocus
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' && newTitle.trim()) {
                    await api().courses.rename(course.id, newTitle.trim());
                    setRenaming(false);
                    refreshAll();
                  }
                  if (e.key === 'Escape') setRenaming(false);
                }}
              />
              <button
                className="btn btn-primary"
                onClick={async () => {
                  if (!newTitle.trim()) return;
                  await api().courses.rename(course.id, newTitle.trim());
                  setRenaming(false);
                  refreshAll();
                }}
              >
                Save
              </button>
            </div>
          ) : (
            <h1>{course.title}</h1>
          )}
          {course.description && <p className={styles.description}>{course.description}</p>}
          <div className={styles.metaRow}>
            <span className={styles.metaItem}>
              <ListChecks size={14} /> {course.sections.length} sections
            </span>
            <span className={styles.metaItem}>
              <BookOpen size={14} /> {course.lessonCount} lessons
            </span>
            <span className={styles.metaItem}>
              <CheckCircle2 size={14} /> {course.completedCount} completed
            </span>
          </div>
          <div className={styles.progressRow}>
            <ProgressBar percent={course.progressPercent} large />
            <span className={styles.progressPercent}>{course.progressPercent}%</span>
          </div>
          <div className={styles.actions}>
            {continueLesson && (
              <button className="btn btn-primary" onClick={() => openLesson(continueLesson.id)}>
                <PlayCircle size={16} />
                {course.completedCount > 0 && course.completedCount < course.lessonCount
                  ? 'Continue Learning'
                  : 'Start Course'}
              </button>
            )}
            <button
              className="btn btn-ghost"
              onClick={() => {
                setNewTitle(course.title);
                setRenaming(true);
              }}
            >
              <Pencil size={14} /> Rename
            </button>
            <button
              className="btn btn-ghost"
              onClick={async () => {
                const result = await api().courses.rescan(course.id);
                if (result.status === 'ok') refreshAll();
                else await api().app.showError('Rescan failed', result.error ?? 'Unknown error');
              }}
            >
              <RefreshCw size={14} /> Rescan
            </button>
          </div>
        </div>
      </div>

      <section className={styles.sectionHeader} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ fontSize: 16, fontWeight: 650, margin: 0 }}>Course content</h2>
      </section>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {course.sections.map((section) => {
          const open = openSections.has(section.id);
          const completedInSection = section.lessons.filter((l) => l.completed).length;
          return (
            <div key={section.id} className={`card ${styles.section}`}>
              <button className={styles.sectionHeader} onClick={() => toggleSection(section.id)}>
                <span className={`${styles.chevron} ${open ? styles.open : ''}`}>
                  <ChevronDown size={17} />
                </span>
                <span className={styles.sectionTitle}>{section.title}</span>
                <span className={styles.sectionMeta}>
                  <span>
                    {completedInSection}/{section.lessons.length} completed
                  </span>
                </span>
              </button>
              {open && (
                <div className={styles.lessonList}>
                  {section.lessons.map((lesson) => (
                    <button key={lesson.id} className={styles.lessonRow} onClick={() => openLesson(lesson.id)}>
                      <span className={styles.statusIcon}>
                        {lesson.completed ? (
                          <CheckCircle2 size={17} color="var(--success)" />
                        ) : (
                          <PlayCircle size={17} color="var(--text-muted)" />
                        )}
                      </span>
                      <span className={styles.lessonTitle}>{lesson.title}</span>
                      {lesson.duration !== null && (
                        <span className={styles.lessonDuration}>{formatTime(lesson.duration)}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <section className={styles.quizSection}>
        <div className={styles.quizHeader}>
          <h2>Quizzes</h2>
        </div>
        <QuizManager courseId={course.id} />
      </section>
    </div>
  );
}
