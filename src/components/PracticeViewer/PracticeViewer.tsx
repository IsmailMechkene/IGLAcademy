import { ExternalLink } from 'lucide-react';
import { api } from '../../services/api';
import styles from './PracticeViewer.module.css';

interface Props {
  src: string;
  title: string;
  lessonId: number;
}

/**
 * In-app preview for HTML practice tests. The frame is fully sandboxed
 * (no scripts from course files ever execute), so interactive tests are best
 * experienced via "Open in browser" — the static content still reads fine here.
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
      <button
        className={styles.openExternal}
        onClick={() => void api().media.openExternal(lessonId).catch(() => undefined)}
        title="Open this practice test in your browser with full interactivity"
      >
        <ExternalLink size={14} />
        Open in browser
      </button>
    </div>
  );
}
