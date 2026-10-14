import { Sparkles } from 'lucide-react';
import Modal from '../Modal/Modal';
import { tokenizeInline } from '../../utils/explanation';
import type { ChangelogEntry } from '../../utils/changelog';
import styles from './WhatsNew.module.css';

function Item({ text }: { text: string }) {
  return (
    <>
      {tokenizeInline(text).map((t, i) =>
        t.type === 'bold' ? <strong key={i}>{t.text}</strong>
          : t.type === 'code' ? <code key={i}>{t.text}</code>
            : <span key={i}>{'text' in t ? t.text : ''}</span>,
      )}
    </>
  );
}

/** Shown once after an update: the changelog entries the user has not seen. */
export default function WhatsNew({ entries, onClose }: { entries: ChangelogEntry[]; onClose: () => void }) {
  return (
    <Modal label="What's new" onClose={onClose}>
      <div className={styles.head}>
        <span className={styles.icon} aria-hidden="true"><Sparkles size={18} /></span>
        <div>
          <h2 className={styles.title}>What's new in IGLAcademy</h2>
          <p className={styles.sub}>Version {entries[0].version}</p>
        </div>
      </div>
      <div className={styles.body}>
        {entries.map((entry, i) => (
          <section key={entry.version}>
            {i > 0 && <h3 className={styles.older}>Version {entry.version}</h3>}
            <ul className={styles.list}>
              {entry.items.map((item, j) => (
                <li key={j}><Item text={item} /></li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <div className={styles.actions}>
        <button className="btn btn-primary" data-autofocus onClick={onClose}>
          Got it
        </button>
      </div>
    </Modal>
  );
}
