import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, StickyNote } from 'lucide-react';
import type { CourseDetail } from '../../types';
import { api } from '../../services/api';
import { useApp } from '../../App';
import { formatTime } from '../../utils/format';
import VideoPlayer, { type VideoPlayerHandle } from '../../components/VideoPlayer/VideoPlayer';
import PracticeViewer from '../../components/PracticeViewer/PracticeViewer';
import LessonSidebar from '../../components/LessonSidebar/LessonSidebar';
import NotesPanel from '../../components/NotesPanel/NotesPanel';
import styles from './Player.module.css';

interface Props {
  courseId: number;
  lessonId: number;
}

const COMPLETION_THRESHOLD = 0.9; // 90% watched counts as complete
const POSITION_SAVE_INTERVAL = 5; // seconds

export default function Player({ courseId, lessonId }: Props) {
  const { navigate, settings, refreshAll } = useApp();
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

  const findLesson = useCallback(
    (id: number) => {
      if (!course) return null;
      for (const section of course.sections) {
        const lesson = section.lessons.find((l) => l.id === id);
        if (lesson) return { lesson, section };
      }
      return null;
    },
    [course],
  );

  const allLessons = useCallback(
    () => (course ? course.sections.flatMap((s) => s.lessons) : []),
    [course],
  );

  // Load media URL + progress for the current lesson
  useEffect(() => {
    let cancelled = false;
    setMediaUrl(null);
    setFileMissing(false);
    setLoadError(null);

    api()
      .media.getUrl(currentLessonId)
      .then((url) => {
        if (cancelled) return;
        setMediaUrl(url);
        // Check saved position for resume prompt
        api()
          .courses.get(courseId)
          .then((c) => {
            if (cancelled || !c) return;
            const found = findLesson(currentLessonId);
            if (!found) return;
            setCompleted(found.lesson.completed);
            completedRef.current = found.lesson.completed;
            setLessonTitle(found.lesson.title);
            setSectionTitle(found.section.title);
            setLessonKind(found.lesson.fileType === 'practice' ? 'practice' : 'video');

            const pos = found.lesson.positionSeconds;
            const dur = found.lesson.duration ?? 0;
            if (pos > 10 && (dur === 0 || pos < dur * COMPLETION_THRESHOLD)) {
              if (settings.resumePlayback === 'always') {
                setTimeout(() => playerRef.current?.seek(pos), 300);
              } else if (settings.resumePlayback === 'ask') {
                setResumePosition(pos);
                setShowResumePrompt(true);
              }
            }
          })
          .catch(() => undefined);
      })
      .catch(async () => {
        if (cancelled) return;
        setFileMissing(true);
        const stillMissing = await api().media.checkFile(currentLessonId).catch(() => false);
        if (!stillMissing) setFileMissing(true);
      });

    return () => {
      cancelled = true;
    };
  }, [currentLessonId, courseId, findLesson, settings.resumePlayback]);

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

  const handleTimeUpdate = useCallback(
    (time: number, duration: number) => {
      setCurrentTime(time);
      // Auto-complete at 90%
      if (duration > 0 && time / duration >= COMPLETION_THRESHOLD && !completedRef.current) {
        completedRef.current = true;
        setCompleted(true);
        void api().progress.setCompleted(currentLessonId, true);
        refreshAll();
      }
      // Periodic position save
      if (time - lastSaveRef.current >= POSITION_SAVE_INTERVAL) {
        lastSaveRef.current = time;
        void api().progress.savePosition(currentLessonId, time);
      }
    },
    [currentLessonId, refreshAll],
  );

  const handleEnded = useCallback(() => {
    if (!completedRef.current) {
      completedRef.current = true;
      setCompleted(true);
      void api().progress.setCompleted(currentLessonId, true);
      refreshAll();
    }
    void api().progress.savePosition(currentLessonId, playerRef.current?.getDuration() ?? 0);
  }, [currentLessonId, refreshAll]);

  const goToLesson = useCallback(
    (id: number) => {
      if (id === currentLessonId) return;
      savePosition();
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
    const next = !completed;
    completedRef.current = next;
    setCompleted(next);
    void api().progress.setCompleted(currentLessonId, next);
    refreshAll();
  }, [completed, currentLessonId, refreshAll]);

  const handleLocateFile = useCallback(async () => {
    const newUrl = await api().media.locateFile(currentLessonId);
    if (newUrl) {
      setMediaUrl(newUrl);
      setFileMissing(false);
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
    return <div className="muted" style={{ padding: 48 }}>Loading player...</div>;
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
                defaultSpeed={settings.defaultPlaybackSpeed}
                hasPrev={currentIdx > 0}
                hasNext={currentIdx >= 0 && currentIdx < lessons.length - 1}
                onPrev={handlePrev}
                onNext={handleNext}
                onTimeUpdate={handleTimeUpdate}
                onEnded={handleEnded}
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
        <div className={styles.overlay}>
          <div className={`card ${styles.dialog}`}>
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
                onClick={() => {
                  setShowResumePrompt(false);
                  setTimeout(() => playerRef.current?.seek(resumePosition), 200);
                  startTimeRef.current = Date.now();
                }}
              >
                Resume
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
