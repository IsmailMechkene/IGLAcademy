import type { ReactNode } from 'react';
import { AlertTriangle, BookOpen, Check, CheckCircle2, ExternalLink, Image, Lightbulb, X, XCircle } from 'lucide-react';
import { linkLabel, parseExplanation, tokenizeInline, type ExplanationSection } from '../../utils/explanation';
import styles from './Explanation.module.css';

/** Renders one line's inline markers. Links open in the system browser. */
function Inline({ text }: { text: string }) {
  const nodes: ReactNode[] = tokenizeInline(text).map((t, i) => {
    switch (t.type) {
      case 'bold':
        return <strong key={i}>{t.text}</strong>;
      case 'code':
        return <code key={i} className={styles.code}>{t.text}</code>;
      case 'link':
        return (
          <a key={i} className={styles.link} href={t.url} target="_blank" rel="noreferrer" title={t.url}>
            {linkLabel(t.text, t.url)}
            <ExternalLink size={12} aria-hidden="true" />
          </a>
        );
      case 'image':
        return (
          <a key={i} className={styles.diagram} href={t.url} target="_blank" rel="noreferrer" title={t.url}>
            <Image size={13} aria-hidden="true" /> View diagram
          </a>
        );
      default:
        return <span key={i}>{t.text}</span>;
    }
  });
  return <>{nodes}</>;
}

/** "via - <link>" lines are attributions; they read better small. */
function Paragraph({ text }: { text: string }) {
  const isSource = /^via\s*[-–—:]/i.test(text);
  const isBullet = text.startsWith('• ');
  return (
    <p className={`${styles.para} ${isSource ? styles.source : ''} ${isBullet ? styles.bullet : ''}`}>
      <Inline text={isBullet ? text.slice(2) : text} />
    </p>
  );
}

const SECTION_META: Record<Exclude<ExplanationSection['kind'], 'general'>, { title: (n: number) => string; icon: ReactNode }> = {
  correct: { title: (n) => (n > 1 ? 'Why these answers are correct' : 'Why this answer is correct'), icon: <CheckCircle2 size={15} /> },
  incorrect: { title: () => 'Why the other options are wrong', icon: <XCircle size={15} /> },
  references: { title: () => 'References', icon: <BookOpen size={15} /> },
  alert: { title: () => 'Exam tip', icon: <AlertTriangle size={15} /> },
};

/**
 * Answer explanation, laid out by meaning: what is right (green), why each
 * other option is wrong (red), reading material, then anything else.
 */
export default function ExplanationBlock({ text }: { text: string }) {
  const sections = parseExplanation(text);
  if (sections.length === 0) return null;

  return (
    <div className={styles.explanation}>
      <div className={styles.header}>
        <Lightbulb size={15} aria-hidden="true" />
        <span>Explanation</span>
      </div>

      {sections.map((section, si) => {
        if (section.kind === 'general') {
          return (
            <div key={si} className={styles.general}>
              {section.paragraphs.map((p, i) => <Paragraph key={i} text={p} />)}
            </div>
          );
        }
        const meta = SECTION_META[section.kind];

        if (section.kind === 'references') {
          const links = section.paragraphs.flatMap((p) =>
            tokenizeInline(p).filter((t): t is Extract<typeof t, { type: 'link' }> => t.type === 'link'),
          );
          const other = section.paragraphs.filter((p) => !tokenizeInline(p).some((t) => t.type === 'link'));
          return (
            <section key={si} className={`${styles.section} ${styles.references}`}>
              <div className={styles.sectionTitle}>{meta.icon}{meta.title(0)}</div>
              <div className={styles.refList}>
                {links.map((l, i) => (
                  <a key={i} className={styles.refLink} href={l.url} target="_blank" rel="noreferrer" title={l.url}>
                    <ExternalLink size={13} aria-hidden="true" />
                    {linkLabel(l.text, l.url)}
                  </a>
                ))}
              </div>
              {other.map((p, i) => <Paragraph key={i} text={p} />)}
            </section>
          );
        }

        return (
          <section key={si} className={`${styles.section} ${styles[section.kind]}`}>
            <div className={styles.sectionTitle}>
              {meta.icon}
              {meta.title(section.options.reduce((n, o) => n + o.names.length, 0))}
            </div>
            {section.paragraphs.map((p, i) => <Paragraph key={`p${i}`} text={p} />)}
            {section.options.map((option, oi) => (
              <div key={oi} className={styles.option}>
                {option.names.map((name, ni) => (
                  <div key={ni} className={styles.optionName}>
                    <span className={styles.optionMark} aria-hidden="true">
                      {section.kind === 'correct' ? <Check size={12} strokeWidth={3} /> : <X size={12} strokeWidth={3} />}
                    </span>
                    <span><Inline text={name} /></span>
                  </div>
                ))}
                {option.paragraphs.length > 0 && (
                  <div className={styles.optionBody}>
                    {option.paragraphs.map((p, i) => <Paragraph key={i} text={p} />)}
                  </div>
                )}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
