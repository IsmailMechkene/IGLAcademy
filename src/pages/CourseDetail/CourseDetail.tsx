import { useEffect, useState } from 'react';
import {
  ArrowLeft, BookOpen, Check, ChevronDown, Clock, FileText, FileWarning, FolderInput, Layers, Pencil, Play,
  RefreshCw,
} from 'lucide-react';
import type { CourseDetail as CourseDetailType, CourseHealth } from '../../types';
import { api } from '../../services/api';
import { useApp, useCrumbs } from '../../App';
import { formatDateTime, formatLength, formatTime } from '../../utils/format';
import { cleanTitle, splitOrdinal } from '../../utils/titles';
import { locateFileMessage } from '../../utils/locateFile';
import CourseCover from '../../components/CourseCover/CourseCover';
import ProgressBar from '../../components/ProgressBar/ProgressBar';
import LoadError from '../../components/LoadError/LoadError';
import Modal from '../../components/Modal/Modal';
import QuizManager from '../../components/Quiz/QuizManager';
import ResourceSection from '../../components/Resources/ResourceSection';
import styles from './CourseDetail.module.css';

interface Props {
  courseId: number;
}

export default function CourseDetail({ courseId }: Props) {
  const { navigate, refreshAll, refreshKey } = useApp();
  const [course, setCourse] = useState<CourseDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [openSections, setOpenSections] = useState<Set<number>>(new Set());
  const [renaming, setRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [health, setHealth] = useState<CourseHealth | null>(null);
  const [showHealth, setShowHealth] = useState(false);
  const [relocating, setRelocating] = useState(false);
  const [forgetting, setForgetting] = useState<{ lessonId: number; title: string } | null>(null);
  const [tab, setTab] = useState<'content' | 'quizzes' | 'resources'>('content');

  useCrumbs(
    course
      ? [{ label: 'Courses', route: { name: 'library' } }, { label: cleanTitle(course.title) }]
      : null,
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    api()
      .courses.get(courseId)
      .then((c) => {
        if (cancelled) return;
        setCourse(c);
        if (c && c.sections.length > 0) {
          setOpenSections(new Set([c.sections[0].id]));
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, refreshKey]);

  // Mark course as opened (for "recently opened") + check file health
  useEffect(() => {
    api().courses.markOpened(courseId).catch(() => undefined);
    api()
      .courses.health(courseId)
      .then(setHealth)
      .catch(() => undefined);
  }, [courseId, refreshKey]);

  const refreshHealth = async () => {
    const next = await api().courses.health(courseId).catch(() => null);
    if (next) setHealth(next);
  };

  const handleLocate = async (lessonId: number) => {
    try {
      const result = await api().media.locateFile(lessonId);
      if (result.status === 'cancelled') return;
      if (result.status !== 'ok') {
        await api().app.showError('Could not use that file', locateFileMessage(result));
        return;
      }
      await refreshHealth();
      refreshAll();
    } catch (err) {
      await api().app.showError('Could not use that file', err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const handleForget = async (lessonId: number) => {
    const result = await api().courses.forgetLesson(lessonId).catch(() => ({
      status: 'error' as const,
      title: '',
      error: 'Could not remove the lesson.',
    }));
    setForgetting(null);
    if (result.status === 'error') {
      await api().app.showError('Could not forget this lesson', result.error ?? 'Unknown error');
    }
    await refreshHealth();
    refreshAll();
  };

  const handleRelocate = async () => {
    setRelocating(true);
    try {
      const result = await api().courses.relocate(courseId);
      if (result.status === 'cancelled') return;
      if (result.status === 'error') {
        await api().app.showError('Relocation failed', result.error ?? 'Unknown error');
        return;
      }
      const healthNow = await api().courses.health(courseId).catch(() => null);
      if (healthNow) setHealth(healthNow);
      refreshAll();
      if (result.stillMissing > 0) {
        await api().app.showError(
          'Partially relinked',
          `${result.relocated} file${result.relocated === 1 ? '' : 's'} relinked, ${result.stillMissing} still missing.`,
        );
      }
    } finally {
      setRelocating(false);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <div className={`card skeleton ${styles.heroSkeleton}`} />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="page">
        <button className="btn btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => navigate({ name: 'library' })}>
          <ArrowLeft size={15} /> Back to library
        </button>
        <LoadError message="Could not load this course." onRetry={refreshAll} />
      </div>
    );
  }

  if (!course) {
    return (
      <div className="page">
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

  const allLessons = course.sections.flatMap((sec) => sec.lessons);
  // Durations are learned as lessons are played; a total over a few known
  // lessons would understate the course, so totals only show once complete.
  const totalSeconds = allLessons.every((l) => l.duration !== null)
    ? allLessons.reduce((n, l) => n + (l.duration ?? 0), 0)
    : 0;
  const remaining = course.lessonCount - course.completedCount;
  const started = course.completedCount > 0;
  const continueSection = continueLesson
    ? course.sections.find((sec) => sec.lessons.some((l) => l.id === continueLesson.id))
    : undefined;
  const allOpen = openSections.size === course.sections.length;
  let lessonNumber = 0;

  return (
    <div className="page fade-in">
      <header className={styles.hero}>
        <div className={styles.heroBackdrop} aria-hidden="true">
          <CourseCover courseId={course.id} title={course.title} />
        </div>
        <div className={styles.heroCover}>
          <CourseCover courseId={course.id} title={course.title} />
        </div>
        <div className={styles.heroInfo}>
          <span className="eyebrow">Course</span>
          {renaming ? (
            <div className={styles.renameRow}>
              <input
                className="input"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                autoFocus
                aria-label="Course title"
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
              <button className="btn btn-ghost" onClick={() => setRenaming(false)}>Cancel</button>
            </div>
          ) : (
            <h1 className={styles.title} title={course.title}>{cleanTitle(course.title)}</h1>
          )}
          {course.description && <p className={styles.description}>{course.description}</p>}
          <div className={styles.metaRow}>
            <span className={styles.metaItem}><Layers size={14} /> {course.sections.length} sections</span>
            <span className={styles.metaItem}><BookOpen size={14} /> {course.lessonCount} lessons</span>
            {totalSeconds > 0 && (
              <span className={styles.metaItem} title="Total length of all lessons">
                <Clock size={14} /> {formatLength(totalSeconds)}
              </span>
            )}
          </div>
          <div className={styles.progressBlock}>
            <div className={styles.progressRow}>
              <span>{course.completedCount} of {course.lessonCount} lessons completed</span>
              <strong>{course.progressPercent}%</strong>
            </div>
            <ProgressBar percent={course.progressPercent} large />
          </div>
          <div className={styles.actions}>
            {continueLesson && (
              <button className="btn btn-primary btn-lg" onClick={() => openLesson(continueLesson.id)}>
                <Play size={16} fill="currentColor" />
                {course.progressPercent === 100 ? 'Watch again' : started ? 'Continue learning' : 'Start course'}
              </button>
            )}
            <button
              className="btn btn-ghost btn-lg"
              onClick={() => {
                setNewTitle(course.title);
                setRenaming(true);
              }}
              title="Rename course"
            >
              <Pencil size={15} /> Rename
            </button>
            <button
              className="btn btn-ghost btn-lg"
              title="Look for new or moved files in the course folder"
              onClick={async () => {
                const result = await api().courses.rescan(course.id);
                if (result.status === 'ok') refreshAll();
                else await api().app.showError('Rescan failed', result.error ?? 'Unknown error');
              }}
            >
              <RefreshCw size={15} /> Rescan
            </button>
          </div>
        </div>
      </header>

      {health && health.missingLessons.length > 0 && (
        <div className={`card ${styles.healthBanner}`} role="alert">
          <span className={styles.healthIcon}><FileWarning size={18} /></span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 650, fontSize: 14 }}>
              {health.missingLessons.length} of {health.totalLessons} files missing
            </div>
            <div className="muted" style={{ fontSize: 12.5 }}>
              These lessons were moved or deleted. Relocate the whole folder at once, or fix files individually.
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowHealth(true)}>
            Fix files
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleRelocate} disabled={relocating}>
            <FolderInput size={14} /> {relocating ? 'Relocating...' : 'Relocate folder'}
          </button>
        </div>
      )}

      <div className="tabs" role="tablist" aria-label="Course sections">
        <button role="tab" className="tab" aria-selected={tab === 'content'} onClick={() => setTab('content')}>
          Content <span className="count">{course.lessonCount}</span>
        </button>
        <button role="tab" className="tab" aria-selected={tab === 'quizzes'} onClick={() => setTab('quizzes')}>
          Quizzes
        </button>
        <button role="tab" className="tab" aria-selected={tab === 'resources'} onClick={() => setTab('resources')}>
          Resources
        </button>
      </div>

      {tab === 'content' && (
        <div className={styles.contentGrid}>
          <div className={styles.sections}>
            <div className={styles.contentToolbar}>
              <span className="muted" style={{ fontSize: 13 }}>
                {course.sections.length} sections · {course.lessonCount} lessons
                {totalSeconds > 0 && ` · ${formatLength(totalSeconds)}`}
              </span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  setOpenSections(allOpen ? new Set() : new Set(course.sections.map((sec) => sec.id)))
                }
              >
                {allOpen ? 'Collapse all' : 'Expand all'}
              </button>
            </div>
            {course.sections.map((section, sIdx) => {
              const open = openSections.has(section.id);
              const completedInSection = section.lessons.filter((l) => l.completed).length;
              const sectionSeconds = section.lessons.every((l) => l.duration !== null)
                ? section.lessons.reduce((n, l) => n + (l.duration ?? 0), 0)
                : 0;
              const sectionDone = completedInSection === section.lessons.length && section.lessons.length > 0;
              const firstNumber = lessonNumber;
              lessonNumber += section.lessons.length;
              return (
                <div key={section.id} className={`card ${styles.section} ${open ? styles.sectionOpen : ''}`}>
                  <button
                    className={styles.sectionHeader}
                    onClick={() => toggleSection(section.id)}
                    aria-expanded={open}
                    title={section.title}
                  >
                    <span className={`${styles.sectionIndex} ${sectionDone ? styles.sectionIndexDone : ''}`}>
                      {sectionDone ? <Check size={14} strokeWidth={3} /> : sIdx + 1}
                    </span>
                    <span className={styles.sectionText}>
                      <span className={styles.sectionTitle}>{splitOrdinal(section.title).text}</span>
                      <span className={styles.sectionMeta}>
                        {completedInSection}/{section.lessons.length} completed
                        {sectionSeconds > 0 && ` · ${formatLength(sectionSeconds)}`}
                      </span>
                    </span>
                    <span className={styles.sectionBar} aria-hidden="true">
                      <span style={{ width: `${section.lessons.length ? (completedInSection / section.lessons.length) * 100 : 0}%` }} />
                    </span>
                    <ChevronDown size={18} className={styles.chevron} />
                  </button>
                  {open && (
                    <div className={styles.lessonList}>
                      {section.lessons.map((lesson, i) => {
                        const missing = lesson.missingSince !== null;
                        const isNext = continueLesson?.id === lesson.id && course.progressPercent < 100;
                        return (
                          <button
                            key={lesson.id}
                            className={`${styles.lessonRow} ${lesson.completed ? styles.lessonDone : ''} ${isNext ? styles.lessonNext : ''}`}
                            onClick={() => openLesson(lesson.id)}
                            title={lesson.title}
                          >
                            <span className={styles.lessonStatus} aria-hidden="true">
                              {missing ? (
                                <FileWarning size={13} />
                              ) : lesson.completed ? (
                                <Check size={12} strokeWidth={3} />
                              ) : lesson.fileType === 'practice' ? (
                                <FileText size={12} />
                              ) : (
                                <span>{firstNumber + i + 1}</span>
                              )}
                            </span>
                            <span className={styles.lessonTitle}>{splitOrdinal(lesson.title).text}</span>
                            {isNext && <span className="badge">Up next</span>}
                            {missing && (
                              <span
                                className="badge badge-warning"
                                title={`File not found since ${formatDateTime(lesson.missingSince)} — progress and notes are kept`}
                              >
                                File missing
                              </span>
                            )}
                            <span className={styles.lessonType}>
                              {lesson.fileType === 'practice' ? 'Practice' : lesson.duration !== null ? formatTime(lesson.duration) : 'Video'}
                            </span>
                            <span className={styles.lessonPlay} aria-hidden="true">
                              <Play size={12} fill="currentColor" />
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <aside className={styles.aside}>
            {continueLesson && (
              <div className={`card ${styles.upNext}`}>
                <span className="eyebrow">{course.progressPercent === 100 ? 'Course complete' : started ? 'Up next' : 'First lesson'}</span>
                <div className={styles.upNextTitle}>{splitOrdinal(continueLesson.title).text}</div>
                {continueSection && (
                  <div className={styles.upNextMeta}>{splitOrdinal(continueSection.title).text}</div>
                )}
                <button className="btn btn-primary" onClick={() => openLesson(continueLesson.id)}>
                  <Play size={14} fill="currentColor" /> {started ? 'Continue' : 'Start'}
                </button>
              </div>
            )}
            <div className={`card ${styles.statsCard}`}>
              <div className={styles.statLine}>
                <span>Completed</span>
                <strong>{course.completedCount}</strong>
              </div>
              <div className={styles.statLine}>
                <span>Remaining</span>
                <strong>{remaining}</strong>
              </div>
              {totalSeconds > 0 && (
                <div className={styles.statLine}>
                  <span>Total length</span>
                  <strong>{formatLength(totalSeconds)}</strong>
                </div>
              )}
              <div className={styles.statLine}>
                <span>Sections</span>
                <strong>{course.sections.length}</strong>
              </div>
            </div>
          </aside>
        </div>
      )}

      {tab === 'quizzes' && (
        <section className={styles.tabPanel}>
          <QuizManager courseId={course.id} />
        </section>
      )}

      {tab === 'resources' && (
        <section className={styles.tabPanel}>
          <ResourceSection courseId={course.id} />
        </section>
      )}

      {showHealth && health && (
        <Modal label="Fix missing files" onClose={() => setShowHealth(false)} wide>
          <h2>Missing files ({health.missingLessons.length})</h2>
          <p>Locate each file individually, or relocate the whole course folder at once.</p>
          <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
            Nothing has been deleted — these lessons keep their progress, notes and bookmarks until
            you forget them.
          </p>
          <div className={styles.healthList}>
            {health.missingLessons.map((m) => (
              <div key={m.lessonId} className={styles.healthRow}>
                <span title={m.filePath}>{m.title}</span>
                <button className="btn btn-ghost btn-sm" onClick={() => void handleLocate(m.lessonId)}>
                  Locate
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  title="Remove this lesson and its progress, notes and bookmarks"
                  onClick={() => setForgetting({ lessonId: m.lessonId, title: m.title })}
                >
                  Forget
                </button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button className="btn btn-ghost" onClick={() => setShowHealth(false)}>Close</button>
            <button
              className="btn btn-primary"
              disabled={relocating}
              onClick={async () => {
                await handleRelocate();
                const next = await api().courses.health(course.id).catch(() => null);
                if (next) {
                  setHealth(next);
                  if (next.missingLessons.length === 0) setShowHealth(false);
                }
              }}
            >
              <FolderInput size={15} /> {relocating ? 'Relocating...' : 'Relocate folder'}
            </button>
          </div>
        </Modal>
      )}

      {forgetting && (
        <Modal label="Forget lesson" onClose={() => setForgetting(null)}>
          <h2>Forget this lesson?</h2>
          <p>
            <strong>{forgetting.title}</strong> will be removed from the course along with its
            progress, notes and bookmarks. This cannot be undone.
          </p>
          <p className="muted" style={{ fontSize: 12.5 }}>
            If the file is only temporarily unavailable (external drive, moved folder), close this
            and use <strong>Locate</strong> or <strong>Relocate folder</strong> instead — the lesson
            keeps everything until you forget it.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button className="btn btn-ghost" onClick={() => setForgetting(null)}>Cancel</button>
            <button
              className="btn btn-danger"
              data-autofocus
              onClick={() => void handleForget(forgetting.lessonId)}
            >
              Forget lesson
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
