import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import styles from './WindowControls.module.css';

/**
 * Minimize / maximize / close for the frameless window. Sits at the right end
 * of whichever header is on screen (Topbar, or the player's header).
 */
export default function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let alive = true;
    void api().window.isMaximized().then((m) => alive && setMaximized(m));
    const off = api().window.onMaximizedChange(setMaximized);
    return () => {
      alive = false;
      off();
    };
  }, []);

  return (
    <div className={styles.controls}>
      <button className={styles.btn} onClick={() => void api().window.minimize()} aria-label="Minimize" title="Minimize">
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 5h10" />
        </svg>
      </button>
      <button
        className={styles.btn}
        onClick={() => void api().window.toggleMaximize()}
        aria-label={maximized ? 'Restore' : 'Maximize'}
        title={maximized ? 'Restore' : 'Maximize'}
      >
        {maximized ? (
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <rect x="0.5" y="2.5" width="7" height="7" rx="1.2" />
            <path d="M2.5 2.5V1.7a1.2 1.2 0 0 1 1.2-1.2h4.6a1.2 1.2 0 0 1 1.2 1.2v4.6a1.2 1.2 0 0 1-1.2 1.2H7.5" />
          </svg>
        ) : (
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <rect x="0.5" y="0.5" width="9" height="9" rx="1.5" />
          </svg>
        )}
      </button>
      <button className={`${styles.btn} ${styles.close}`} onClick={() => void api().window.close()} aria-label="Close" title="Close">
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
        </svg>
      </button>
    </div>
  );
}
