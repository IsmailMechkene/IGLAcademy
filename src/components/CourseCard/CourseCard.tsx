import { useEffect, useState } from 'react';
import { BookOpen, GraduationCap } from 'lucide-react';
import type { CourseWithProgress } from '../../types';
import { api } from '../../services/api';
import { useApp } from '../../App';
import ProgressBar from '../ProgressBar/ProgressBar';
import styles from './CourseCard.module.css';

interface Props {
  course: CourseWithProgress;
}

export default function CourseCard({ course }: Props) {
  const { navigate } = useApp();
  const [thumb, setThumb] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api()
      .courses.thumbnailUrl(course.id)
      .then((url) => {
        if (!cancelled) setThumb(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [course.id]);

  return (
    <div
      className={`card ${styles.card}`}
      onClick={() => navigate({ name: 'course', courseId: course.id })}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') navigate({ name: 'course', courseId: course.id });
      }}
    >
      <div className={styles.thumbnail}>
        {thumb ? (
          <img
            src={thumb}
            alt=""
            loading="lazy"
            onError={() => setThumb(null)}
          />
        ) : (
          <div className={styles.thumbnailPlaceholder}>
            <GraduationCap size={36} strokeWidth={1.5} />
          </div>
        )}
      </div>
      <div className={styles.body}>
        <div className={styles.title}>{course.title}</div>
        <div className={styles.meta}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <BookOpen size={13} />
            {course.lessonCount} lessons
          </span>
          <span className={styles.percent}>{course.progressPercent}%</span>
        </div>
        <div className={styles.footer}>
          <ProgressBar percent={course.progressPercent} />
        </div>
      </div>
    </div>
  );
}
