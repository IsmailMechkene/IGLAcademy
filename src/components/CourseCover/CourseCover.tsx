import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { courseInitials, titleHue } from '../../utils/titles';
import styles from './CourseCover.module.css';

interface Props {
  courseId: number;
  title: string;
  className?: string;
  /** Small thumbnail: square, monogram only. */
  compact?: boolean;
}

/**
 * Course artwork: the course's cover image when one was detected at import,
 * otherwise generated art — a dark base lit by two blooms in a hue hashed from
 * the title, a fine grid, and a monogram. The generated layer stays behind the
 * photo so thumbnails never flash blank.
 */
export default function CourseCover({ courseId, title, className, compact }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setLoaded(false);
    api()
      .courses.thumbnailUrl(courseId)
      .then((u) => {
        if (!cancelled) setUrl(u);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [courseId]);

  const hue = titleHue(title);
  const style = {
    ['--h1' as string]: String(hue),
    ['--h2' as string]: String((hue + 48) % 360),
  };

  return (
    <div
      className={`${styles.cover} ${compact ? styles.compact : ''} ${className ?? ''}`}
      style={style}
      aria-hidden="true"
    >
      <span className={styles.grid} />
      <span className={styles.monogram}>{courseInitials(title)}</span>
      {url && (
        <img
          src={url}
          alt=""
          loading="lazy"
          className={loaded ? styles.visible : ''}
          onLoad={() => setLoaded(true)}
          onError={() => setUrl(null)}
        />
      )}
    </div>
  );
}
