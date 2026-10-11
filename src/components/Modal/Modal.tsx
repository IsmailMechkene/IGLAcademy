import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './Modal.module.css';

interface Props {
  label: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}

/**
 * Accessible modal dialog: traps Tab focus, closes on Escape or backdrop
 * click, and returns focus to the opener.
 */
export default function Modal({ label, onClose, children, wide }: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement;
    const dialog = dialogRef.current;
    // Focus the dialog (or its first autofocusable child).
    const target =
      (dialog?.querySelector('[data-autofocus]') as HTMLElement | null) ??
      (dialog?.querySelector('button, input, select, textarea, [tabindex]') as HTMLElement | null) ??
      dialog;
    target?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !dialog) return;
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      const opener = openerRef.current as HTMLElement | null;
      opener?.focus?.();
    };
  }, [onClose]);

  // Portalled to <body>: a fixed overlay inside any transformed or filtered
  // ancestor (page animations, hover lifts) is trapped in that ancestor's box,
  // which showed up as a blurry rectangle over part of the page.
  return createPortal(
    <div
      ref={overlayRef}
      className={styles.overlay}
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={`card ${styles.dialog} ${wide ? styles.wide : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
