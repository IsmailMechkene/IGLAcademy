import { useState } from 'react';
import { CircleCheck, Download, X } from 'lucide-react';
import { api } from '../../services/api';
import { useUpdateStatus } from '../../services/updates';
import { formatBytes } from '../../utils/format';
import styles from './UpdateBanner.module.css';

/**
 * Floating card, bottom-right on every page, from the moment a new version is
 * found: download progress with its real size, then the offer to restart.
 * Dismissing it hides it for that version and step; the sidebar keeps its
 * "Restart to update" card either way.
 */
export default function UpdateBanner() {
  const update = useUpdateStatus();
  const [dismissed, setDismissed] = useState<string | null>(null);

  if (update.state !== 'downloading' && update.state !== 'ready') return null;
  const key = `${update.state}:${update.version}`;
  if (dismissed === key) return null;
  const dismiss = () => setDismissed(key);

  if (update.state === 'downloading') {
    const size =
      update.total && update.transferred !== undefined
        ? `${formatBytes(update.transferred)} of ${formatBytes(update.total)}`
        : 'Preparing download';
    return (
      <section className={styles.banner} aria-label="Update downloading" data-testid="update-banner">
        <span className={styles.icon} aria-hidden="true">
          <Download size={18} />
        </span>
        <div className={styles.body}>
          <div className={styles.title}>Downloading IGLAcademy {update.version}</div>
          <div className={styles.meta}>
            {size} · {update.percent}%
          </div>
          <div
            className={styles.progress}
            role="progressbar"
            aria-label="Update download"
            aria-valuenow={update.percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <span style={{ width: `${update.percent}%` }} />
          </div>
        </div>
        <button className={styles.close} onClick={dismiss} aria-label="Hide" title="Hide">
          <X size={14} />
        </button>
      </section>
    );
  }

  return (
    <section className={`${styles.banner} ${styles.ready}`} aria-label="Update ready" data-testid="update-banner">
      <span className={styles.icon} aria-hidden="true">
        <CircleCheck size={18} />
      </span>
      <div className={styles.body}>
        <div className={styles.title}>IGLAcademy {update.version} is ready</div>
        <div className={styles.meta}>
          {update.size ? `${formatBytes(update.size)} downloaded. ` : ''}
          Restart to finish, it only takes a few seconds.
        </div>
        <div className={styles.actions}>
          <button className="btn btn-ghost btn-sm" onClick={dismiss}>
            Later
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => void api().updates.install()}>
            Restart now
          </button>
        </div>
      </div>
    </section>
  );
}
