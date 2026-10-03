import { useRef, type ReactNode } from 'react';
import styles from './SegmentedControl.module.css';

export interface SegmentOption<T extends string | number> {
  value: T;
  label: string;
  icon?: ReactNode;
}

interface Props<T extends string | number> {
  label: string;
  options: Array<SegmentOption<T>>;
  value: T;
  onChange: (value: T) => void;
}

/** Accessible segmented control (radiogroup with arrow-key support). */
export default function SegmentedControl<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: Props<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const focusOption = (index: number) => {
    const el = refs.current[index];
    if (el) {
      el.focus();
      onChange(options[index].value);
    }
  };

  return (
    <div className={styles.segmented} role="radiogroup" aria-label={label}>
      {options.map((opt, i) => {
        const checked = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className={styles.segment}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                focusOption((i + 1) % options.length);
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                focusOption((i - 1 + options.length) % options.length);
              } else if (e.key === 'Home') {
                e.preventDefault();
                focusOption(0);
              } else if (e.key === 'End') {
                e.preventDefault();
                focusOption(options.length - 1);
              }
            }}
          >
            {opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
