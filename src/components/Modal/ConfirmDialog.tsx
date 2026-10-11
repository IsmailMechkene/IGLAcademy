import { useState, type ReactNode } from 'react';
import Modal from './Modal';

interface Props {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Confirmation step for destructive actions. Focus starts on Cancel, so a
 * stray Enter (or a double-click on the button that opened it) cannot delete.
 */
export default function ConfirmDialog({ title, children, confirmLabel, onConfirm, onCancel }: Props) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const confirm = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await onConfirm();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <Modal label={title} onClose={onCancel}>
      <h2>{title}</h2>
      {children}
      {failed && <p role="alert" style={{ color: 'var(--danger)' }}>That didn’t work. Please try again.</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button className="btn btn-ghost" data-autofocus onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button className="btn btn-danger" onClick={() => void confirm()} disabled={busy}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
