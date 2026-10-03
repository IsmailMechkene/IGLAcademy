import { ExternalLink } from 'lucide-react';
import { api } from '../../services/api';
import styles from './PracticeViewer.module.css';

interface Props {
  src: string;
  title: string;
  lessonId: number;
}

/**
 * In-app preview for HTML practice tests found inside imported courses.
 * The frame is fully sandboxed (no scripts from course files ever execute).
 * For the full interactive exam experience, register the file's folder under
 * Practice Exams in the sidebar.
 */
export default function PracticeViewer({ src, title, lessonId }: Props) {
  return (
    <div className={styles.viewer}>
      <iframe
        className={styles.frame}
        title={title}
        src={src}
        sandbox=""
        referrerPolicy="no-referrer"
      />
      <div className={styles.actions}>
        <button
          className={styles.openExternal}
          onClick={() => void api().media.openExternal(lessonId).catch(() => undefined)}
          title="Open this practice test in your browser with full interactivity"
        >
          <ExternalLink size={14} />
          Open in browser
        </button>
      </div>
    </div>
  );
}
