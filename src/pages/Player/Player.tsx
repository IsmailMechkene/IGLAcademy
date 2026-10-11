import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Bookmark, BookmarkPlus, CheckCircle2, Keyboard, ListVideo, RotateCcw, SkipForward, StickyNote } from 'lucide-react';
import type { CourseDetail } from '../../types';
import { api } from '../../services/api';
import { useApp } from '../../App';
import { formatTime } from '../../utils/format';
import { locateFileMessage } from '../../utils/locateFile';
import VideoPlayer, { type VideoPlayerHandle } from '../../components/VideoPlayer/VideoPlayer';
import PracticeViewer from '../../components/PracticeViewer/PracticeViewer';
import LessonSidebar from '../../components/LessonSidebar/LessonSidebar';
import NotesPanel from '../../components/NotesPanel/NotesPanel';
import LoadError from '../../components/LoadError/LoadError';
import Modal from '../../components/Modal/Modal';
import styles from './Player.module.css';

interface Props {
  courseId: number;
  lessonId: number;
  /** Optional position to jump to on open (bookmarks, review links). */
  startAt?: number;
}

const COMPLETION_THRESHOLD = 0.9; // 90% watched counts as complete
const POSITION_SAVE_INTERVAL = 5; // seconds

/** Records a freshly learned media duration on the loaded course. */
function withDuration(course: CourseDetail, lessonId: number, duration: number): CourseDetail {
  if (!course.sections.some((s) => s.lessons.some((l) => l.id === lessonId && l.duration !== duration))) {
    return course;
  }
  return {
    ...course,
    sections: course.sections.map((section) => ({
      ...section,
      lessons: section.lessons.map((l) => (l.id === lessonId ? { ...l, duration } : l)),
    })),
  };
}

/**
 * Applies a completion change to the loaded course in place, so the lesson
 * sidebar and its counters update without re-fetching (and without the
 * global refresh that used to remount the whole player mid-lesson).
 */
function withCompletion(course: CourseDetail, lessonId: number, completed: boolean): CourseDetail {
  let changed = false;
  const sections = course.sections.map((section) => {
    if (!section.lessons.some((l) => l.id === lessonId && l.completed !== completed)) return section;
    changed = true;
    return {
      ...section,
      lessons: section.lessons.map((l) =>
        l.id === lessonId
          ? { ...l, completed, completedAt: completed ? new Date().toISOString() : null }
          : l,
      ),
    };
  });
  if (!changed) return course;
  const completedCount = sections.reduce((n, s) => n + s.lessons.filter((l) => l.completed).length, 0);
  return {
    ...course,
    sections,
    completedCount,
    progressPercent: course.lessonCount > 0 ? Math.round((completedCount / course.lessonCount) * 100) : 0,
  };
}

export default function Player({ courseId, lessonId, startAt }: Props) {
  const { navigate, settings } = useApp();
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [fileMissing, setFileMissing] = useState(false);
  const [currentLessonId, setCurrentLessonId] = useState(lessonId);
  const [currentTime, setCurrentTime] = useState(0);
  const [showResumePrompt, setShowResumePrompt] = useState(false);
  const [resumePosition, setResumePosition] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesWidth, setNotesWidth] = useState(340);
  const [completed, setCompleted] = useState(false);
  const [lessonTitle, setLessonTitle] = useState('');
  const [sectionTitle, setSectionTitle] = useState('');
  const [lessonKind, setLessonKind] = useState<'video' | 'practice'>('video');
  const [courseError, setCourseError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [showEndPrompt, setShowEndPrompt] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [bookmarkSaved, setBookmarkSaved] = useState(false);
  const startAtRef = useRef<number | null>(startAt ?? null);

  const playerRef = useRef<VideoPlayerHandle>(null);
  const lastSaveRef = useRef(0);
  const completedRef = useRef(false);
  const startTimeRef = useRef(0);

  // Load course data
  useEffect(() => {
    let cancelled = false;
    api()
      .courses.get(courseId)
      .then((c) => {
        if (!cancelled) setCourse(c);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  const allLessons = useCallback(
    () => (course ? course.sections.flatMap((s) => s.lessons) : []),
    [course],
  );

  // Load lesson metadata + media URL for the current lesson.
  // Metadata (title, type, completion) loads even when the media file is
  // missing, so the player never shows the previous lesson's info. Resume
  // still only applies once media is actually available.
  useEffect(() => {
    let cancelled = false;
    setMediaUrl(null);
    setFileMissing(false);
    setLoadError(null);
    setCourseError(false);

    api()
      .courses.get(courseId)
      .then((c) => {
        if (cancelled) return;
        if (!c) {
          setCourseError(true);
          return;
        }
        for (const section of c.sections) {
          const lesson = section.lessons.find((l) => l.id === currentLessonId);
          if (!lesson) continue;
          setCompleted(lesson.completed);
          completedRef.current = lesson.completed;
          setLessonTitle(lesson.title);
          setSectionTitle(section.title);
          const kind = lesson.fileType === 'practice' ? 'practice' : 'video';
          setLessonKind(kind);

          api()
            .media.getUrl(currentLessonId)
            .then((url) => {
              if (cancelled) return;
              setMediaUrl(url);
              // Check saved position for resume prompt (videos only)
              if (kind !== 'video') return;
              const pos = lesson.positionSeconds;
              const dur = lesson.duration ?? 0;
              if (pos > 10 && (dur === 0 || pos < dur * COMPLETION_THRESHOLD)) {
                if (settings.resumePlayback === 'always') {
                  setTimeout(() => playerRef.current?.seek(pos), 300);
                } else if (settings.resumePlayback === 'ask') {
                  setResumePosition(pos);
                  setShowResumePrompt(true);
                }
              }
            })
            .catch(async () => {
              if (cancelled) return;
              setFileMissing(true);
              const stillMissing = await api().media.checkFile(currentLessonId).catch(() => false);
              if (!stillMissing) setFileMissing(true);
            });
          break;
        }
      })
      .catch(() => {
        if (!cancelled) setCourseError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [currentLessonId, courseId, settings.resumePlayback, retryKey]);

  // Save position periodically and on pause/unload
  const savePosition = useCallback(() => {
    const v = playerRef.current;
    if (!v) return;
    const pos = v.getCurrentTime();
    if (pos > 0) {
      void api().progress.savePosition(currentLessonId, pos);
    }
  }, [currentLessonId]);

  useEffect(() => {
    const interval = setInterval(savePosition, POSITION_SAVE_INTERVAL * 1000);
    return () => clearInterval(interval);
  }, [savePosition]);

  // Persist position when switching lessons or leaving the player.
  // (Effect cleanup runs with the previous lesson's id via closure.)
  useEffect(() => {
    return () => savePosition();
  }, [savePosition]);

  // Save on window close
  useEffect(() => {
    const handler = () => savePosition();
    window.addEventListener('beforeunload', handler);
    window.addEventListener('ismalearn:window-closing', handler);
    return () => {
      window.removeEventListener('beforeunload', handler);
      window.removeEventListener('ismalearn:window-closing', handler);
    };
  }, [savePosition]);

  // Track watch time for stats
  useEffect(() => {
    startTimeRef.current = Date.now();
    const interval = setInterval(() => {
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      if (elapsed >= 1) {
        void api().progress.savePosition(currentLessonId, playerRef.current?.getCurrentTime() ?? 0);
        startTimeRef.current = Date.now();
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [currentLessonId]);

  // Records completion locally + in the database. Never triggers a global
  // refresh: the page is keyed on the route, and a refresh here would unmount
  // the <video> element (the player used to restart at 90% of every lesson).
  const markCompleted = useCallback((lessonId: number, next: boolean) => {
    completedRef.current = next;
    setCompleted(next);
    setCourse((prev) => (prev ? withCompletion(prev, lessonId, next) : prev));
    void api().progress.setCompleted(lessonId, next);
  }, []);

  const handleTimeUpdate = useCallback(
    (time: number, duration: number) => {
      setCurrentTime(time);
      // Auto-complete at 90%
      if (duration > 0 && time / duration >= COMPLETION_THRESHOLD && !completedRef.current) {
        markCompleted(currentLessonId, true);
      }
      // Periodic position save
      if (time - lastSaveRef.current >= POSITION_SAVE_INTERVAL) {
        lastSaveRef.current = time;
        void api().progress.savePosition(currentLessonId, time);
      }
    },
    [currentLessonId, markCompleted],
  );

  const handleEnded = useCallback(() => {
    void api().progress.savePosition(currentLessonId, playerRef.current?.getDuration() ?? 0);
    setShowEndPrompt(true);
  }, [currentLessonId]);

  const handleReplay = useCallback(() => {
    setShowEndPrompt(false);
    playerRef.current?.seek(0);
    playerRef.current?.play();
  }, []);

  const handleBookmark = useCallback(async () => {
    try {
      await api().bookmarks.create({
        courseId,
        lessonId: currentLessonId,
        positionSeconds: Math.floor(playerRef.current?.getCurrentTime() ?? currentTime),
        title: `${lessonTitle || 'Lesson'} @ ${formatTime(playerRef.current?.getCurrentTime() ?? currentTime)}`,
      });
      setBookmarkSaved(true);
      setTimeout(() => setBookmarkSaved(false), 1500);
    } catch {
      // bookmarking is best-effort; the Review page shows what stuck
    }
  }, [courseId, currentLessonId, currentTime, lessonTitle]);

  const handleReviewLater = useCallback(async () => {
    try {
      await api().review.add({
        courseId,
        kind: 'lesson',
        refId: String(currentLessonId),
        title: lessonTitle || 'Lesson',
      });
    } catch {
      // best-effort; manageable from the Review page
    }
  }, [courseId, currentLessonId, lessonTitle]);

  // Jump links (bookmarks) can open the player at a position.
  // This is also the only moment the real media duration is known, so it gets
  // persisted here — the scanner cannot read it without decoding the file.
  const handleLoadedMetadata = useCallback(
    (duration: number) => {
      if (startAtRef.current !== null && startAtRef.current > 0) {
        const at = startAtRef.current;
        startAtRef.current = null;
        setTimeout(() => playerRef.current?.seek(at), 200);
      }
      if (Number.isFinite(duration) && duration > 0) {
        const lessonId = currentLessonId;
        void api()
          .courses.setLessonDuration(lessonId, duration)
          .then(() => {
            setCourse((prev) => (prev ? withDuration(prev, lessonId, duration) : prev));
          })
          .catch(() => undefined);
      }
    },
    [currentLessonId],
  );

  const goToLesson = useCallback(
    (id: number) => {
      if (id === currentLessonId) return;
      savePosition();
      setShowEndPrompt(false);
      setCurrentLessonId(id);
    },
    [currentLessonId, savePosition],
  );

  const handlePrev = useCallback(() => {
    const lessons = allLessons();
    const idx = lessons.findIndex((l) => l.id === currentLessonId);
    if (idx > 0) goToLesson(lessons[idx - 1].id);
  }, [allLessons, currentLessonId, goToLesson]);

  const handleNext = useCallback(() => {
    const lessons = allLessons();
    const idx = lessons.findIndex((l) => l.id === currentLessonId);
    if (idx >= 0 && idx < lessons.length - 1) goToLesson(lessons[idx + 1].id);
  }, [allLessons, currentLessonId, goToLesson]);

  const handleToggleComplete = useCallback(() => {
    markCompleted(currentLessonId, !completed);
  }, [completed, currentLessonId, markCompleted]);

  // Relinking can fail (file outside the course folder, wrong kind). Those
  // outcomes are reported instead of silently doing nothing.
  const handleLocateFile = useCallback(async () => {
    try {
      const result = await api().media.locateFile(currentLessonId);
      if (result.status === 'ok') {
        setMediaUrl(result.url);
        setFileMissing(false);
        setLoadError(null);
        return;
      }
      if (result.status === 'cancelled') return;
      await api().app.showError('Could not use that file', locateFileMessage(result));
    } catch (err) {
      await api().app.showError(
        'Could not use that file',
        err instanceof Error ? err.message : 'Unknown error',
      );
    }
  }, [currentLessonId]);

  // A file can disappear while the app is open — verify before showing the error state
  const handleVideoError = useCallback(async () => {
    const exists = await api().media.checkFile(currentLessonId).catch(() => false);
    if (!exists) {
      setMediaUrl(null);
      setFileMissing(true);
    } else {
      // The file is there but Chromium cannot play it (unsupported codec/container)
      setLoadError(
        'The file exists but could not be decoded. MP4 (H.264) and WebM play best — ' +
        'MKV support depends on the codecs inside the container.',
      );
    }
  }, [currentLessonId]);

  // Keyboard shortcuts (ignored while typing or when a dialog is open).
  // Registered after all lesson actions so the handler closes over them.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (document.querySelector('[role="dialog"]')) return;
      const player = playerRef.current;
      if (!player || lessonKind !== 'video') {
        if (e.key === '?') setShowShortcuts(true);
        return;
      }
      switch (e.key) {
        case ' ':
          e.preventDefault();
          player.togglePlay();
          break;
        case 'ArrowLeft':
          player.seekBy(e.shiftKey ? -10 : -5);
          break;
        case 'ArrowRight':
          player.seekBy(e.shiftKey ? 10 : 5);
          break;
        case 'ArrowUp':
          e.preventDefault();
          player.volumeBy(0.1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          player.volumeBy(-0.1);
          break;
        case 'f':
        case 'F':
          player.toggleFullscreen();
          break;
        case 'm':
        case 'M':
          player.toggleMute();
          break;
        case 'n':
        case 'N':
          handleNext();
          break;
        case 'p':
        case 'P':
          handlePrev();
          break;
        case 'b':
        case 'B':
          void handleBookmark();
          break;
        case 'c':
        case 'C':
          handleToggleComplete();
          break;
        case '[':
          player.cycleSpeed(-1);
          break;
        case ']':
          player.cycleSpeed(1);
          break;
        case '?':
          setShowShortcuts(true);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lessonKind, handleNext, handlePrev, handleBookmark, handleToggleComplete]);

  // Notes panel resize
  const handleResizeMouseMove = useCallback(
    (e: MouseEvent) => {
      const newWidth = window.innerWidth - e.clientX;
      if (newWidth >= 260 && newWidth <= 640) setNotesWidth(newWidth);
    },
    [],
  );

  const handleResizeMouseUp = useCallback(() => {
    document.removeEventListener('mousemove', handleResizeMouseMove);
    document.removeEventListener('mouseup', handleResizeMouseUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, [handleResizeMouseMove]);

  const startResize = useCallback(() => {
    document.addEventListener('mousemove', handleResizeMouseMove);
    document.addEventListener('mouseup', handleResizeMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [handleResizeMouseMove, handleResizeMouseUp]);

  if (!course) {
    return (
      <div style={{ padding: 48, maxWidth: 560 }}>
        {courseError ? (
          <LoadError message="Could not load this course." onRetry={() => setRetryKey((k) => k + 1)} />
        ) : (
          <div className="muted">Loading player...</div>
        )}
      </div>
    );
  }

  const lessons = allLessons();
  const currentIdx = lessons.findIndex((l) => l.id === currentLessonId);

  return (
    <div className={styles.page}>
      <LessonSidebar
        course={course}
        activeLessonId={currentLessonId}
        onSelectLesson={goToLesson}
        completed={completed}
        onToggleComplete={handleToggleComplete}
      />

      <div className={styles.main}>
        <div className={styles.playerArea}>
          {mediaUrl || fileMissing ? (
            lessonKind === 'practice' && !fileMissing ? (
              <PracticeViewer
                src={mediaUrl ?? ''}
                title={lessonTitle}
                lessonId={currentLessonId}
              />
            ) : (
              <VideoPlayer
                ref={playerRef}
                src={mediaUrl ?? undefined}
                // Without this the player never asks for subtitle tracks, so
                // the CC menu (gated on tracks.length) could never appear.
                lessonId={currentLessonId}
                defaultSpeed={settings.defaultPlaybackSpeed}
                hasPrev={currentIdx > 0}
                hasNext={currentIdx >= 0 && currentIdx < lessons.length - 1}
                onPrev={handlePrev}
                onNext={handleNext}
                onTimeUpdate={handleTimeUpdate}
                onEnded={handleEnded}
                onLoadedMetadata={handleLoadedMetadata}
                missing={fileMissing}
                mediaKind={lessonKind}
                onMissingFile={handleLocateFile}
                onError={handleVideoError}
                loadError={loadError}
              />
            )
          ) : null}
        </div>
        <div className={styles.playerBar}>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate({ name: 'course', courseId })}>
            <ArrowLeft size={15} /> Course
          </button>
          <div className={styles.lessonInfo}>
            <div className={styles.lessonTitle}>{lessonTitle || 'Loading...'}</div>
            <div className={styles.lessonSection}>{sectionTitle}</div>
          </div>
          {lessonKind === 'video' && (
            <>
              <button
                className="btn btn-ghost btn-sm"
                onClick={handleBookmark}
                title="Bookmark this moment (B)"
                aria-label="Bookmark current position"
              >
                {bookmarkSaved ? <CheckCircle2 size={15} color="var(--success)" /> : <Bookmark size={15} />}
                {bookmarkSaved ? 'Saved' : 'Bookmark'}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={handleReviewLater}
                title="Review this lesson later"
                aria-label="Add lesson to review later queue"
              >
                <BookmarkPlus size={15} /> Later
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowShortcuts(true)}
                title="Keyboard shortcuts (?)"
                aria-label="Show keyboard shortcuts"
              >
                <Keyboard size={15} />
              </button>
            </>
          )}
          <button
            className={`btn btn-ghost ${styles.notesToggle}`}
            onClick={() => setNotesOpen((o) => !o)}
            title={notesOpen ? 'Hide notes' : 'Show notes'}
          >
            <StickyNote size={16} />
            {notesOpen ? 'Hide notes' : 'Notes'}
          </button>
        </div>
      </div>

      {notesOpen && (
        <>
          <div
            style={{ width: 5, cursor: 'col-resize', background: 'var(--border)' }}
            onMouseDown={startResize}
          />
          <div style={{ width: notesWidth, minWidth: 260 }}>
            <NotesPanel
              courseId={courseId}
              lessonId={currentLessonId}
              lessonTitle={lessonTitle}
              currentTime={currentTime}
              onTimestampClick={(seconds) => playerRef.current?.seek(seconds)}
              refreshKey={currentLessonId}
            />
          </div>
        </>
      )}

      {showResumePrompt && (
        <Modal label="Resume playback" onClose={() => setShowResumePrompt(false)}>
          <h2>Resume where you left off?</h2>
          <p>
            You were at {formatTime(resumePosition)} in this lesson.
          </p>
          <div className={styles.dialogActions}>
            <button
              className="btn btn-ghost"
              onClick={() => {
                setShowResumePrompt(false);
                startTimeRef.current = Date.now();
              }}
            >
              Start over
            </button>
            <button
              className="btn btn-primary"
              data-autofocus
              onClick={() => {
                setShowResumePrompt(false);
                setTimeout(() => playerRef.current?.seek(resumePosition), 200);
                startTimeRef.current = Date.now();
              }}
            >
              Resume
            </button>
          </div>
        </Modal>
      )}

      {showEndPrompt && (() => {
        const nextLesson = lessons[currentIdx + 1];
        return (
          <Modal label="Lesson finished" onClose={() => setShowEndPrompt(false)}>
            <h2>Lesson finished</h2>
            <p>{lessonTitle}</p>
            <div className={styles.endActions}>
              <button
                className={`btn ${completed ? 'btn-ghost' : 'btn-primary'}`}
                onClick={() => {
                  handleToggleComplete();
                  setShowEndPrompt(false);
                }}
              >
                <CheckCircle2 size={15} />
                {completed ? 'Mark as incomplete' : 'Mark complete'}
              </button>
              {nextLesson ? (
                <button
                  className="btn btn-primary"
                  data-autofocus
                  onClick={() => {
                    setShowEndPrompt(false);
                    goToLesson(nextLesson.id);
                  }}
                >
                  <SkipForward size={15} /> Next lesson
                </button>
              ) : (
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setShowEndPrompt(false);
                    navigate({ name: 'course', courseId });
                  }}
                >
                  <ListVideo size={15} /> Back to course
                </button>
              )}
              <button className="btn btn-ghost" onClick={handleReplay}>
                <RotateCcw size={15} /> Replay
              </button>
            </div>
          </Modal>
        );
      })()}

      {showShortcuts && (
        <Modal label="Keyboard shortcuts" onClose={() => setShowShortcuts(false)}>
          <h2>Keyboard shortcuts</h2>
          <div className={styles.shortcutList}>
            {[
              ['Space', 'Play / pause'],
              ['← / →', 'Seek 5 seconds (Shift: 10 seconds)'],
              ['↑ / ↓', 'Volume up / down'],
              ['F', 'Fullscreen'],
              ['M', 'Mute'],
              ['N / P', 'Next / previous lesson'],
              ['[ / ]', 'Slower / faster playback'],
              ['B', 'Bookmark this moment'],
              ['C', 'Mark complete / incomplete'],
              ['?', 'This list'],
            ].map(([key, desc]) => (
              <div key={key} className={styles.shortcutRow}>
                <kbd className={styles.kbd}>{key}</kbd>
                <span>{desc}</span>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
