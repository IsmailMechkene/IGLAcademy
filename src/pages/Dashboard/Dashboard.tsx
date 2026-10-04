import { useEffect, useState, type ReactNode } from 'react';
import {
  BookOpen, Clock, CheckCircle2, Target, PlayCircle, FolderOpen, GraduationCap, ArrowRight, Brain,
} from 'lucide-react';
import type { CourseWithProgress, LearningStats, LessonActivity } from '../../types';
import { api } from '../../services/api';
import { useApp } from '../../App';
import { formatHours, timeAgo } from '../../utils/format';
import { cleanTitle } from '../../utils/titles';
import CourseCard from '../../components/CourseCard/CourseCard';
import CourseCover from '../../components/CourseCover/CourseCover';
import ProgressBar from '../../components/ProgressBar/ProgressBar';
import LoadError from '../../components/LoadError/LoadError';
import styles from './Dashboard.module.css';

function ProgressRing({ percent }: { percent: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(100, percent));
  return (
    <svg className={styles.ring} width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r={r} fill="none" stroke="var(--bg-hover)" strokeWidth="5" />
      <circle
        cx="20"
        cy="20"
        r={r}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={`${(filled / 100) * c} ${c}`}
        transform="rotate(-90 20 20)"
      />
    </svg>
  );
}

export default function Dashboard() {
  const { navigate, refreshKey, refreshAll } = useApp();
  const [stats, setStats] = useState<LearningStats | null>(null);
  const [courses, setCourses] = useState<CourseWithProgress[]>([]);
  const [continueCourseId, setContinueCourseId] = useState<number | null>(null);
  const [recentIds, setRecentIds] = useState<number[]>([]);
  const [activity, setActivity] = useState<LessonActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [due, setDue] = useState<{ itemsDue: number; cardsDue: number }>({ itemsDue: 0, cardsDue: 0 });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    Promise.all([
      api().progress.stats(),
      api().courses.list(),
      api().progress.mostRecentCourseId(),
      api().progress.recentCourseIds(6),
      api().review.dueCounts().catch(() => ({ itemsDue: 0, cardsDue: 0 })),
    ])
      .then(async ([s, c, recentId, recent, dueCounts]) => {
        if (cancelled) return;
        setStats(s);
        setCourses(c);
        setContinueCourseId(recentId);
        setRecentIds(recent);
        setDue(dueCounts);
        if (recentId !== null) {
          try {
            const a = await api().progress.lastActivity(recentId);
            if (!cancelled) setActivity(a);
          } catch {
            // hero still renders without activity details
          }
        } else if (!cancelled) {
          setActivity(null);
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
  }, [refreshKey]);

  if (loadError) {
    return (
      <div className={styles.page}>
        <div className={styles.welcome}>
          <h1>Welcome back</h1>
          <p>Pick up where you left off — your progress is saved on this device.</p>
        </div>
        <LoadError message="Could not load your learning space." onRetry={refreshAll} />
      </div>
    );
  }

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.welcome}>
          <div className="skeleton" style={{ width: 220, height: 28, borderRadius: 8 }} />
          <div className="skeleton" style={{ width: 340, height: 16, borderRadius: 8 }} />
        </div>
        <div className={styles.statsGrid}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={`card ${styles.statCard}`} aria-hidden="true">
              <div className="skeleton" style={{ width: 90, height: 30, borderRadius: 8 }} />
              <div className="skeleton" style={{ width: 130, height: 14, borderRadius: 7 }} />
            </div>
          ))}
        </div>
        <div className={styles.courseGrid}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className={`card ${styles.skeletonCard}`} aria-hidden="true">
              <div className="skeleton" style={{ width: '100%', aspectRatio: '16 / 9' }} />
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="skeleton" style={{ width: '85%', height: 13, borderRadius: 6 }} />
                <div className="skeleton" style={{ width: '55%', height: 13, borderRadius: 6 }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (courses.length === 0) {
    return (
      <div className={`fade-in ${styles.page}`}>
        <div className={styles.welcome}>
          <h1>Welcome to IsmaLearn</h1>
          <p>Your courses. Your pace. Your progress.</p>
        </div>
        <div className={`card ${styles.emptyState}`}>
          <div className={styles.emptyIcon}>
            <GraduationCap size={36} strokeWidth={1.8} />
          </div>
          <h2>No courses yet</h2>
          <p>
            Import a folder from your computer to get started. IsmaLearn organizes your
            downloaded courses into sections and lessons automatically.
          </p>
          <div className={styles.emptySteps}>
            <span>1. Click "Import Course" in the top bar</span>
            <span>2. Select a folder that contains your course videos</span>
            <span>3. Start learning — your progress is saved locally</span>
          </div>
          <button className="btn btn-primary" onClick={() => navigate({ name: 'library' })}>
            <FolderOpen size={16} />
            Import your first course
          </button>
        </div>
      </div>
    );
  }

  const continueCourse = courses.find((c) => c.id === continueCourseId) ?? null;
  const recentCourses = recentIds
    .filter((id) => id !== continueCourseId)
    .map((id) => courses.find((c) => c.id === id))
    .filter((c): c is CourseWithProgress => Boolean(c))
    .slice(0, 6);

  const statItems = [
    {
      icon: BookOpen,
      chip: styles.chipViolet,
      value: String(stats?.courseCount ?? 0),
      label: 'Courses',
      extra: null as ReactNode,
    },
    {
      icon: Clock,
      chip: styles.chipGreen,
      value: formatHours(stats?.totalWatchedSeconds ?? 0),
      label: 'Learning time',
      extra: null as ReactNode,
    },
    {
      icon: CheckCircle2,
      chip: styles.chipAmber,
      value: String(stats?.lessonsCompleted ?? 0),
      label: `Lessons completed of ${stats?.totalLessons ?? 0}`,
      extra: null as ReactNode,
    },
    {
      icon: Target,
      chip: styles.chipBlue,
      value: `${stats?.overallProgressPercent ?? 0}%`,
      label: 'Overall progress',
      extra: <ProgressRing percent={stats?.overallProgressPercent ?? 0} />,
    },
  ];

  const resumeLessonId = activity?.lessonId;

  return (
    <div className={`fade-in ${styles.page}`}>
      <div className={styles.welcome}>
        <h1>Welcome back</h1>
        <p>Pick up where you left off — your progress is saved on this device.</p>
      </div>

      {(due.itemsDue > 0 || due.cardsDue > 0) && (
        <div
          className={`card ${styles.dueBanner}`}
          role="button"
          tabIndex={0}
          onClick={() => navigate({ name: 'review' })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') navigate({ name: 'review' });
          }}
          aria-label={`Up for review: ${due.cardsDue} flashcards and ${due.itemsDue} queued items due. Open Review.`}
        >
          <Brain size={20} color="var(--accent)" />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 650, fontSize: 14.5 }}>Up for review</div>
            <div className="muted" style={{ fontSize: 12.5 }}>
              {due.cardsDue > 0 && `${due.cardsDue} flashcard${due.cardsDue === 1 ? '' : 's'} due`}
              {due.cardsDue > 0 && due.itemsDue > 0 && ' · '}
              {due.itemsDue > 0 && `${due.itemsDue} queued item${due.itemsDue === 1 ? '' : 's'} due`}
            </div>
          </div>
          <ArrowRight size={16} className="muted" />
        </div>
      )}

      <div className={styles.statsGrid}>
        {statItems.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className={`card ${styles.statCard}`}>
              <div className={styles.statTop}>
                <span className={`${styles.chip} ${s.chip}`}>
                  <Icon size={16} />
                </span>
                {s.extra}
              </div>
              <span className={styles.statValue}>{s.value}</span>
              <span className={styles.statLabel}>{s.label}</span>
            </div>
          );
        })}
      </div>

      {continueCourse && (
        <section aria-label="Continue Learning">
          <div className={styles.sectionHeader}>
            <h2>Continue Learning</h2>
          </div>
          <div
            className={`card ${styles.continueCard}`}
            role="button"
            tabIndex={0}
            title={continueCourse.title}
            aria-label={`Continue learning: ${cleanTitle(continueCourse.title)}`}
            onClick={() => navigate({ name: 'course', courseId: continueCourse.id })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                navigate({ name: 'course', courseId: continueCourse.id });
              }
            }}
          >
            <div className={styles.continueThumb}>
              <CourseCover courseId={continueCourse.id} title={continueCourse.title} />
            </div>
            <div className={styles.continueInfo}>
              <span className={styles.continueTitle}>{cleanTitle(continueCourse.title)}</span>
              <span className={styles.continueMeta}>
                {activity ? (
                  <>
                    <span className={styles.lastLesson}>{activity.lessonTitle}</span>
                    <span>·</span>
                    <span>Last watched {timeAgo(activity.updatedAt)}</span>
                  </>
                ) : (
                  <span>{continueCourse.completedCount} of {continueCourse.lessonCount} lessons completed</span>
                )}
              </span>
              <ProgressBar percent={continueCourse.progressPercent} />
              <span className={styles.continueMeta}>
                <span>{continueCourse.completedCount} of {continueCourse.lessonCount} lessons</span>
                <span>·</span>
                <span>{continueCourse.progressPercent}%</span>
              </span>
            </div>
            <button
              className="btn btn-primary"
              onClick={(e) => {
                e.stopPropagation();
                if (resumeLessonId !== undefined) {
                  navigate({ name: 'player', courseId: continueCourse.id, lessonId: resumeLessonId });
                } else {
                  navigate({ name: 'course', courseId: continueCourse.id });
                }
              }}
            >
              <PlayCircle size={16} />
              Resume
              <ArrowRight size={15} />
            </button>
          </div>
        </section>
      )}

      {recentCourses.length > 0 && (
        <section aria-label="Recently opened">
          <div className={styles.sectionHeader}>
            <h2>Recently opened</h2>
          </div>
          <div className={styles.courseGrid}>
            {recentCourses.map((course) => (
              <CourseCard key={course.id} course={course} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
