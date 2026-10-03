import { useEffect, useMemo, useState } from 'react';
import { FolderOpen, Search, RefreshCw, Pencil, Trash2, CheckCircle2, PlayCircle, X } from 'lucide-react';
import type { CourseWithProgress, ImportResult, RescanResult } from '../../types';
import { api } from '../../services/api';
import { useApp } from '../../App';
import CourseCard from '../../components/CourseCard/CourseCard';
import styles from './Library.module.css';

type Filter = 'all' | 'in-progress' | 'completed';

interface Props {
  filter?: Filter;
}

export default function Library({ filter = 'all' }: Props) {
  const { navigate, refreshAll, refreshKey, searchQuery, setSearchQuery } = useApp();
  const [courses, setCourses] = useState<CourseWithProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [dialog, setDialog] = useState<
    | { kind: 'importing' }
    | { kind: 'result'; result: ImportResult }
    | { kind: 'rescan'; courseId: number; result: RescanResult | null }
    | { kind: 'rename'; course: CourseWithProgress }
    | { kind: 'delete'; course: CourseWithProgress }
    | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api()
      .courses.list()
      .then((c) => {
        if (!cancelled) setCourses(c);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const filtered = useMemo(() => {
    let list = courses;
    if (filter === 'in-progress') {
      list = list.filter((c) => c.progressPercent > 0 && c.progressPercent < 100);
    } else if (filter === 'completed') {
      list = list.filter((c) => c.progressPercent === 100);
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((c) => c.title.toLowerCase().includes(q));
    }
    return list;
  }, [courses, filter, searchQuery]);

  const handleImport = async () => {
    setImporting(true);
    setDialog({ kind: 'importing' });
    try {
      const result = await api().courses.import();
      setDialog({ kind: 'result', result });
      if (result.status === 'imported') refreshAll();
    } catch (err) {
      setDialog({
        kind: 'result',
        result: { status: 'error', error: err instanceof Error ? err.message : 'Import failed' },
      });
    } finally {
      setImporting(false);
    }
  };

  const handleRescan = async (courseId: number) => {
    setDialog({ kind: 'rescan', courseId, result: null });
    try {
      const result = await api().courses.rescan(courseId);
      setDialog({ kind: 'rescan', courseId, result });
      refreshAll();
    } catch (err) {
      setDialog({
        kind: 'rescan',
        courseId,
        result: { status: 'error', addedLessons: 0, addedSections: 0, removedLessons: 0, error: err instanceof Error ? err.message : 'Rescan failed' },
      });
    }
  };

  const handleRename = async (course: CourseWithProgress, title: string) => {
    await api().courses.rename(course.id, title);
    setDialog(null);
    refreshAll();
  };

  const handleDelete = async (course: CourseWithProgress) => {
    await api().courses.remove(course.id);
    setDialog(null);
    refreshAll();
  };

  const titles: Record<Filter, { title: string; subtitle: string }> = {
    all: { title: 'My Courses', subtitle: 'All imported courses live here.' },
    'in-progress': { title: 'In Progress', subtitle: 'Courses you are currently studying.' },
    completed: { title: 'Completed', subtitle: 'Courses you have finished. Great work!' },
  };

  return (
    <div className={`fade-in ${styles.page}`}>
      <div className={styles.header}>
        <div>
          <h1>{titles[filter].title}</h1>
          <p>{titles[filter].subtitle}</p>
        </div>
        <div className={styles.toolbar}>
          <div className={styles.searchWrap}>
            <span className={styles.searchIcon}>
              <Search size={15} />
            </span>
            <input
              className="input"
              style={{ paddingLeft: 34 }}
              placeholder="Filter courses..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button className="btn btn-primary" onClick={handleImport} disabled={importing}>
            <FolderOpen size={16} />
            {importing ? 'Importing...' : 'Import Course'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="muted">Loading courses...</div>
      ) : filtered.length === 0 ? (
        <div className={`card ${styles.emptyState}`}>
          {filter === 'all' ? (
            <>
              <h2>No courses yet</h2>
              <p>Import a course folder to start learning.</p>
              <button className="btn btn-primary" onClick={handleImport}>
                <FolderOpen size={16} />
                Import Course
              </button>
            </>
          ) : (
            <>
              <h2>{filter === 'completed' ? 'No completed courses yet' : 'No courses in progress'}</h2>
              <p className="muted">
                {filter === 'completed'
                  ? 'Complete all lessons in a course to see it here.'
                  : 'Start learning a course to see it here.'}
              </p>
            </>
          )}
        </div>
      ) : (
        <div className={styles.courseGrid}>
          {filtered.map((course) => (
            <div key={course.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <CourseCard course={course} />
              <div style={{ display: 'flex', gap: 6, padding: '0 2px' }}>
                <button
                  className="btn btn-ghost btn-sm"
                  title="Rescan for new files"
                  onClick={() => handleRescan(course.id)}
                >
                  <RefreshCw size={13} /> Rescan
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  title="Rename course"
                  onClick={() => setDialog({ kind: 'rename', course })}
                >
                  <Pencil size={13} /> Rename
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  title="Remove course (files are not deleted)"
                  onClick={() => setDialog({ kind: 'delete', course })}
                >
                  <Trash2 size={13} /> Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {dialog?.kind === 'importing' && (
        <div className={styles.overlay}>
          <div className={`card ${styles.dialog}`}>
            <h2>Importing course</h2>
            <div className={styles.spinner} />
            <p>Scanning the selected folder for videos and resources...</p>
          </div>
        </div>
      )}

      {dialog?.kind === 'result' && (
        <div className={styles.overlay} onClick={() => setDialog(null)}>
          <div className={`card ${styles.dialog}`} onClick={(e) => e.stopPropagation()}>
            {dialog.result.status === 'imported' && (
              <>
                <h2>Course imported</h2>
                <div className={`${styles.resultRow} ${styles.success}`}>
                  <CheckCircle2 size={17} />
                  <span>
                    <strong>{dialog.result.courseTitle}</strong> — {dialog.result.sectionCount} sections,{' '}
                    {dialog.result.lessonCount} lessons
                  </span>
                </div>
                <div className={styles.dialogActions}>
                  <button className="btn btn-ghost" onClick={() => setDialog(null)}>Close</button>
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      const id = dialog.result.courseId!;
                      setDialog(null);
                      navigate({ name: 'course', courseId: id });
                    }}
                  >
                    <PlayCircle size={15} /> Open course
                  </button>
                </div>
              </>
            )}
            {dialog.result.status === 'duplicate' && (
              <>
                <h2>Course already imported</h2>
                <div className={`${styles.resultRow} ${styles.info}`}>
                  <RefreshCw size={17} />
                  <span>
                    <strong>{dialog.result.courseTitle}</strong> is already in your library. You can rescan it
                    from the library to pick up new files.
                  </span>
                </div>
                <div className={styles.dialogActions}>
                  <button className="btn btn-ghost" onClick={() => setDialog(null)}>Close</button>
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      const id = dialog.result.courseId!;
                      setDialog(null);
                      navigate({ name: 'course', courseId: id });
                    }}
                  >
                    Open existing course
                  </button>
                </div>
              </>
            )}
            {dialog.result.status === 'error' && (
              <>
                <h2>Import failed</h2>
                <div className={`${styles.resultRow} ${styles.error}`}>
                  <X size={17} />
                  <span>{dialog.result.error}</span>
                </div>
                <div className={styles.dialogActions}>
                  <button className="btn btn-ghost" onClick={() => setDialog(null)}>Close</button>
                  <button className="btn btn-primary" onClick={handleImport}>Try again</button>
                </div>
              </>
            )}
            {dialog.result.status === 'cancelled' && (
              <>
                <h2>Import cancelled</h2>
                <div className={styles.dialogActions}>
                  <button className="btn btn-ghost" onClick={() => setDialog(null)}>Close</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {dialog?.kind === 'rescan' && (
        <div className={styles.overlay} onClick={() => setDialog(null)}>
          <div className={`card ${styles.dialog}`} onClick={(e) => e.stopPropagation()}>
            <h2>Rescan course</h2>
            {!dialog.result ? (
              <>
                <div className={styles.spinner} />
                <p>Scanning for new files...</p>
              </>
            ) : dialog.result.status === 'ok' ? (
              <>
                <div className={`${styles.resultRow} ${styles.success}`}>
                  <CheckCircle2 size={17} />
                  <span>
                    Rescan complete: {dialog.result.addedSections} new sections, {dialog.result.addedLessons} new lessons
                    {dialog.result.removedLessons > 0 ? `, ${dialog.result.removedLessons} removed` : ''}.
                  </span>
                </div>
                <div className={styles.dialogActions}>
                  <button className="btn btn-primary" onClick={() => setDialog(null)}>Done</button>
                </div>
              </>
            ) : (
              <>
                <div className={`${styles.resultRow} ${styles.error}`}>
                  <X size={17} />
                  <span>{dialog.result.error}</span>
                </div>
                <div className={styles.dialogActions}>
                  <button className="btn btn-ghost" onClick={() => setDialog(null)}>Close</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {dialog?.kind === 'rename' && (
        <RenameDialog
          course={dialog.course}
          onClose={() => setDialog(null)}
          onSave={handleRename}
        />
      )}

      {dialog?.kind === 'delete' && (
        <div className={styles.overlay} onClick={() => setDialog(null)}>
          <div className={`card ${styles.dialog}`} onClick={(e) => e.stopPropagation()}>
            <h2>Remove course?</h2>
            <p>
              <strong>{dialog.course.title}</strong> will be removed from your library along with its
              progress, notes and quizzes. Your original course files will <strong>not</strong> be deleted.
            </p>
            <div className={styles.dialogActions}>
              <button className="btn btn-ghost" onClick={() => setDialog(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => handleDelete(dialog.course)}>
                <Trash2 size={15} /> Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RenameDialog({
  course,
  onClose,
  onSave,
}: {
  course: CourseWithProgress;
  onClose: () => void;
  onSave: (course: CourseWithProgress, title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(course.title);
  const [saving, setSaving] = useState(false);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={`card ${styles.dialog}`} onClick={(e) => e.stopPropagation()}>
        <h2>Rename course</h2>
        <input
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter' && title.trim()) {
              setSaving(true);
              onSave(course, title.trim()).finally(() => setSaving(false));
            }
          }}
        />
        <div className={styles.dialogActions}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={!title.trim() || saving}
            onClick={() => {
              setSaving(true);
              onSave(course, title.trim()).finally(() => setSaving(false));
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
