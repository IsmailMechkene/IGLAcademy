import { useEffect, useState } from 'react';
import { ArrowRight, Brain, CheckCircle2, FolderOpen, GraduationCap, LibraryBig, Play } from 'lucide-react';
import type { CourseWithProgress, LearningStats, LessonActivity, StudyStats } from '../../types';
import { api } from '../../services/api';
import { useApp } from '../../App';
import { timeAgo } from '../../utils/format';
import { cleanTitle, splitOrdinal } from '../../utils/titles';
import CourseCard from '../../components/CourseCard/CourseCard';
import CourseCover from '../../components/CourseCover/CourseCover';
import ProgressBar from '../../components/ProgressBar/ProgressBar';
import LoadError from '../../components/LoadError/LoadError';
import StudyActivity from './StudyActivity';
import styles from './Dashboard.module.css';

function ProgressRing({ percent, size = 76 }: { percent: number; size?: number }) {
  const stroke = 7;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = Math.max(0, Math.min(100, percent));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className={styles.ring}>
      <defs>
        <linearGradient id="ringGradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--brand-teal)" />
          <stop offset="100%" stopColor="var(--brand-teal-strong)" />
        </linearGradient>
      </defs>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-active)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="url(#ringGradient)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${(filled / 100) * c} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className={styles.ringText}>
        {filled}%
      </text>
    </svg>
  );
}

function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
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
  const [study, setStudy] = useState<StudyStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    Promise.all([
      api().progress.stats(),
      api().courses.list(),
      api().progress.mostRecentCourseId(),
      api().progress.recentCourseIds(12),
      api().review.dueCounts().catch(() => ({ itemsDue: 0, cardsDue: 0 })),
      api().progress.studyStats().catch(() => null),
    ])
      .then(async ([s, c, recentId, recent, dueCounts, studyStats]) => {
        if (cancelled) return;
        setStudy(studyStats);
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

  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  const header = (
    <div className="page-header">
      <div>
        <div className="eyebrow">{today}</div>
        <h1 style={{ marginTop: 6 }}>{courses.length === 0 && !loading ? 'Welcome to IGLAcademy' : greeting()}</h1>
        <p>
          {courses.length === 0 && !loading
            ? 'Your courses. Your pace. Your progress — all on this device.'
            : 'Pick up where you left off.'}
        </p>
      </div>
    </div>
  );

  if (loadError) {
    return (
      <div className="page">
        {header}
        <LoadError message="Could not load your learning space." onRetry={refreshAll} />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="page">
        <div className="page-header">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="skeleton" style={{ width: 160, height: 12 }} />
            <div className="skeleton" style={{ width: 260, height: 30 }} />
          </div>
        </div>
        <div className={styles.heroGrid}>
          <div className={`card skeleton ${styles.heroSkeleton}`} />
          <div className={styles.statsCol}>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className={`card skeleton ${styles.statSkeleton}`} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (courses.length === 0) {
    return (
      <div className="page fade-in">
        {header}
        <div className={`card ${styles.welcomeCard}`}>
          <div className="emptyIcon">
            <GraduationCap size={26} strokeWidth={1.8} />
          </div>
          <h2>Bring your first course in</h2>
          <p>
            Point IGLAcademy at a folder of downloaded videos. Sections and lessons are organised
            automatically, and your files are never moved or changed.
          </p>
          <ol className={styles.steps}>
            <li><span>1</span>Choose a course folder</li>
            <li><span>2</span>IGLAcademy builds sections and lessons</li>
            <li><span>3</span>Learn — progress is saved locally</li>
          </ol>
          <button className="btn btn-primary btn-lg" onClick={() => navigate({ name: 'library' })}>
            <FolderOpen size={17} />
            Import a course
          </button>
        </div>
      </div>
    );
  }

  const continueCourse =
    courses.find((c) => c.id === continueCourseId) ??
    courses.find((c) => c.progressPercent < 100) ??
    courses[0];
  const hasActivity = activity !== null && continueCourse.id === continueCourseId;
  const order = new Map(recentIds.map((id, i) => [id, i]));
  const yourCourses = [...courses]
    .sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999))
    .slice(0, 8);
  const dueTotal = due.cardsDue + due.itemsDue;

  const resume = () => {
    if (hasActivity && activity) {
      navigate({ name: 'player', courseId: continueCourse.id, lessonId: activity.lessonId });
    } else {
      navigate({ name: 'course', courseId: continueCourse.id });
    }
  };

  return (
    <div className="page fade-in">
      {header}

      <div className={styles.heroGrid}>
        <section className={`card ${styles.hero}`} aria-label="Continue learning">
          <div className={styles.heroCover}>
            <CourseCover courseId={continueCourse.id} title={continueCourse.title} />
            <button className={styles.heroPlay} onClick={resume} aria-label="Resume">
              <Play size={22} fill="currentColor" />
            </button>
          </div>
          <div className={styles.heroBody}>
            <span className="eyebrow">{hasActivity ? 'Continue learning' : 'Start learning'}</span>
            <h2 className={styles.heroTitle} title={continueCourse.title}>
              {cleanTitle(continueCourse.title)}
            </h2>
            {hasActivity && activity && (
              <div className={styles.nextUp}>
                <span className={styles.nextUpLabel}>Last lesson</span>
                <span className={styles.nextUpTitle}>{splitOrdinal(activity.lessonTitle).text}</span>
                <span className={styles.nextUpMeta}>{timeAgo(activity.updatedAt)}</span>
              </div>
            )}
            <div className={styles.heroProgress}>
              <div className={styles.heroProgressRow}>
                <span>
                  {continueCourse.completedCount} of {continueCourse.lessonCount} lessons
                </span>
                <strong>{continueCourse.progressPercent}%</strong>
              </div>
              <ProgressBar percent={continueCourse.progressPercent} large />
            </div>
            <div className={styles.heroActions}>
              <button className="btn btn-primary btn-lg" onClick={resume}>
                <Play size={16} fill="currentColor" />
                {hasActivity ? 'Resume' : 'Start course'}
              </button>
              <button className="btn btn-ghost btn-lg" onClick={() => navigate({ name: 'course', courseId: continueCourse.id })}>
                Course overview
              </button>
            </div>
          </div>
        </section>

        <div className={styles.statsCol}>
          <div className={`card ${styles.stat} ${styles.statRing}`}>
            <ProgressRing percent={stats?.overallProgressPercent ?? 0} />
            <div>
              <div className={styles.statLabel}>Overall progress</div>
              <div className={styles.statCaption}>
                across {stats?.courseCount ?? courses.length} course{(stats?.courseCount ?? courses.length) === 1 ? '' : 's'}
              </div>
            </div>
          </div>
          <div className={`card ${styles.stat}`}>
            <span className={`${styles.statIcon} ${styles.iconGreen}`}>
              <CheckCircle2 size={17} />
            </span>
            <div>
              <div className={styles.statValue}>
                {stats?.lessonsCompleted ?? 0}
                <span className={styles.statOf}> / {stats?.totalLessons ?? 0}</span>
              </div>
              <div className={styles.statCaption}>lessons completed</div>
            </div>
          </div>
          <button
            className={`card card-interactive ${styles.stat} ${styles.statButton}`}
            onClick={() => navigate({ name: 'review' })}
          >
            <span className={`${styles.statIcon} ${styles.iconAccent}`}>
              <Brain size={17} />
            </span>
            <div style={{ flex: 1 }}>
              <div className={styles.statValue}>{dueTotal}</div>
              <div className={styles.statCaption}>
                {dueTotal === 0 ? 'nothing due for review' : `due for review${due.cardsDue ? ` · ${due.cardsDue} card${due.cardsDue === 1 ? '' : 's'}` : ''}`}
              </div>
            </div>
            <ArrowRight size={16} className={styles.statArrow} />
          </button>
        </div>
      </div>

      {study && <StudyActivity stats={study} />}

      <section>
        <div className="sectionHeader">
          <h2>Your courses</h2>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate({ name: 'library' })}>
            <LibraryBig size={14} /> View all
          </button>
        </div>
        <div className={styles.courseGrid}>
          {yourCourses.map((course) => (
            <CourseCard key={course.id} course={course} />
          ))}
        </div>
      </section>
    </div>
  );
}
