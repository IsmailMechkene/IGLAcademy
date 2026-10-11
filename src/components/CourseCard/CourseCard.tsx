import { BookOpen, Check, Play } from 'lucide-react';
import type { CourseWithProgress } from '../../types';
import { useApp } from '../../App';
import { cleanTitle } from '../../utils/titles';
import CourseCover from '../CourseCover/CourseCover';
import ProgressBar from '../ProgressBar/ProgressBar';
import styles from './CourseCard.module.css';

interface Props {
  course: CourseWithProgress;
}

export default function CourseCard({ course }: Props) {
  const { navigate } = useApp();
  const displayTitle = cleanTitle(course.title);

  const open = () => navigate({ name: 'course', courseId: course.id });

  return (
    <div
      className={`card ${styles.card}`}
      onClick={open}
      role="button"
      tabIndex={0}
      title={displayTitle !== course.title ? course.title : undefined}
      aria-label={`Open course: ${displayTitle}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
    >
      <div className={styles.thumbnail}>
        <CourseCover courseId={course.id} title={course.title} />
        {course.progressPercent === 100 ? (
          <span className={`${styles.status} ${styles.statusDone}`}>
            <Check size={12} strokeWidth={3} /> Completed
          </span>
        ) : course.progressPercent > 0 ? (
          <span className={styles.status}>In progress</span>
        ) : (
          <span className={`${styles.status} ${styles.statusNew}`}>New</span>
        )}
        <span className={styles.playOverlay} aria-hidden="true">
          <span className={styles.playButton}>
            <Play size={18} fill="currentColor" />
          </span>
        </span>
      </div>
      <div className={styles.body}>
        <div className={styles.title}>{displayTitle}</div>
        <div className={styles.meta}>
          <span className={styles.lessonCount}>
            <BookOpen size={13} aria-hidden="true" />
            {course.lessonCount} lesson{course.lessonCount === 1 ? '' : 's'}
          </span>
          <span className={styles.percent}>
            {course.progressPercent > 0 ? `${course.completedCount}/${course.lessonCount} · ${course.progressPercent}%` : 'Not started'}
          </span>
        </div>
        <div className={styles.footer}>
          <ProgressBar percent={course.progressPercent} />
        </div>
      </div>
    </div>
  );
}
