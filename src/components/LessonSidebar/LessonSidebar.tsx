import { CheckCircle2, Circle, FileText } from 'lucide-react';
import type { CourseDetail } from '../../types';
import styles from './LessonSidebar.module.css';

interface Props {
  course: CourseDetail;
  activeLessonId: number;
  onSelectLesson: (lessonId: number) => void;
  completed: boolean;
  onToggleComplete: () => void;
}

export default function LessonSidebar({ course, activeLessonId, onSelectLesson, completed, onToggleComplete }: Props) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.header}>
        <h2>{course.title}</h2>
        <span>
          {course.completedCount} of {course.lessonCount} lessons completed
        </span>
      </div>
      <div className={styles.list}>
        {course.sections.map((section) => (
          <div key={section.id}>
            <div className={styles.sectionLabel}>{section.title}</div>
            {section.lessons.map((lesson) => (
              <button
                key={lesson.id}
                className={`${styles.lessonRow} ${lesson.id === activeLessonId ? styles.active : ''}`}
                onClick={() => onSelectLesson(lesson.id)}
              >
                <span className={styles.statusIcon}>
                  {lesson.completed ? (
                    <CheckCircle2 size={16} color="var(--success)" />
                  ) : lesson.fileType === 'practice' ? (
                    <FileText size={16} color="var(--text-muted)" />
                  ) : (
                    <Circle size={16} color="var(--text-muted)" />
                  )}
                </span>
                <span className={styles.lessonTitle}>{lesson.title}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className={styles.footer}>
        <button
          className={`btn ${completed ? 'btn-ghost' : 'btn-primary'} ${styles.completeBtn}`}
          onClick={onToggleComplete}
        >
          <CheckCircle2 size={16} />
          {completed ? 'Completed' : 'Mark as complete'}
        </button>
      </div>
    </aside>
  );
}
