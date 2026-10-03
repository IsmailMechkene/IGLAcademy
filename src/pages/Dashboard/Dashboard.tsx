import { useEffect, useState } from 'react';
import {
  BookOpen, Clock, CheckCircle2, Target, PlayCircle, FolderOpen, GraduationCap, ArrowRight,
} from 'lucide-react';
import type { CourseWithProgress, LearningStats } from '../../types';
import { api } from '../../services/api';
import { useApp } from '../../App';
import { formatHours } from '../../utils/format';
import CourseCard from '../../components/CourseCard/CourseCard';
import ProgressBar from '../../components/ProgressBar/ProgressBar';
import styles from './Dashboard.module.css';

export default function Dashboard() {
  const { navigate, refreshKey } = useApp();
  const [stats, setStats] = useState<LearningStats | null>(null);
  const [courses, setCourses] = useState<CourseWithProgress[]>([]);
  const [continueCourseId, setContinueCourseId] = useState<number | null>(null);
  const [recentIds, setRecentIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api().progress.stats(),
      api().courses.list(),
      api().progress.mostRecentCourseId(),
      api().progress.recentCourseIds(6),
    ])
      .then(([s, c, recentId, recent]) => {
        if (cancelled) return;
        setStats(s);
        setCourses(c);
        setContinueCourseId(recentId);
        setRecentIds(recent);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  if (loading) {
    return <div className={styles.loading}>Loading your learning space...</div>;
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
    .map((id) => courses.find((c) => c.id === id))
    .filter((c): c is CourseWithProgress => Boolean(c))
    .slice(0, 6);

  return (
    <div className={`fade-in ${styles.page}`}>
      <div className={styles.welcome}>
        <h1>Welcome back</h1>
        <p>Pick up where you left off — your progress is saved on this device.</p>
      </div>

      <div className={styles.statsGrid}>
        <div className={`card ${styles.statCard}`}>
          <span className={styles.statValue}>{stats?.courseCount ?? 0}</span>
          <span className={styles.statLabel}>
            <BookOpen size={14} /> Courses
          </span>
        </div>
        <div className={`card ${styles.statCard}`}>
          <span className={styles.statValue}>{formatHours(stats?.totalWatchedSeconds ?? 0)}</span>
          <span className={styles.statLabel}>
            <Clock size={14} /> Learning time
          </span>
        </div>
        <div className={`card ${styles.statCard}`}>
          <span className={styles.statValue}>
            {stats?.lessonsCompleted ?? 0}
            <span className="muted" style={{ fontSize: 15, fontWeight: 500 }}>
              {' '}/ {stats?.totalLessons ?? 0}
            </span>
          </span>
          <span className={styles.statLabel}>
            <CheckCircle2 size={14} /> Lessons completed
          </span>
        </div>
        <div className={`card ${styles.statCard}`}>
          <span className={styles.statValue}>{stats?.overallProgressPercent ?? 0}%</span>
          <span className={styles.statLabel}>
            <Target size={14} /> Overall progress
          </span>
        </div>
      </div>

      {continueCourse && (
        <section>
          <div className={styles.sectionHeader}>
            <h2>Continue Learning</h2>
          </div>
          <div
            className={`card ${styles.continueCard}`}
            role="button"
            tabIndex={0}
            onClick={() => navigate({ name: 'course', courseId: continueCourse.id })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') navigate({ name: 'course', courseId: continueCourse.id });
            }}
          >
            <div className={styles.continueInfo}>
              <span className={styles.continueTitle}>{continueCourse.title}</span>
              <span className={styles.continueMeta}>
                <span>{continueCourse.completedCount} of {continueCourse.lessonCount} lessons completed</span>
                <span>·</span>
                <span>{continueCourse.progressPercent}%</span>
              </span>
              <ProgressBar percent={continueCourse.progressPercent} />
            </div>
            <button
              className="btn btn-primary"
              onClick={(e) => {
                e.stopPropagation();
                navigate({ name: 'course', courseId: continueCourse.id });
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
        <section>
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
