import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { courseInitials, titleHue } from '../../utils/titles';
import styles from './CourseCover.module.css';

interface Props {
  courseId: number;
  title: string;
  className?: string;
}

/**
 * Course artwork: the course's cover image when one was detected at import,
 * otherwise a deterministic gradient (hashed from the title) with initials.
 * The gradient stays behind the photo so thumbnails never flash blank.
 */
export default function CourseCover({ courseId, title, className }: Props) {
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
  const background = `linear-gradient(135deg, hsl(${hue} 55% 42%), hsl(${(hue + 40) % 360} 60% 28%))`;

  return (
    <div className={`${styles.cover} ${className ?? ''}`} style={{ background }} aria-hidden="true">
      <span className={styles.initials}>{courseInitials(title)}</span>
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
