// Display-title helpers. The original folder/file names are never modified —
// these only affect what the UI shows (the full name stays in tooltips).

/** Strips marketplace prefixes, resolution tags and date suffixes. */
export function cleanTitle(raw: string): string {
  let t = (raw ?? '').trim();

  // Leading/trailing marketplace tags: "Udemy - X", "X - Udemy"
  t = t.replace(/^(udemy|skillshare|coursera|pluralsight|linkedin learning|udacity)\s*[-–—:|]\s*/i, '');
  t = t.replace(/\s*[-–—:|]\s*(udemy|skillshare|coursera|pluralsight|linkedin learning|udacity)$/i, '');

  // Resolution tags: "1080p", "(1080)", "4K", "[2K]", trailing bare "1080"
  t = t.replace(/[\s([]\b(\d{3,4}p|[24]K)\b[)\]]?/gi, '');
  t = t.replace(/\s+\(?\b(1080|720|2160)\b\)?$/i, '');

  // Date suffixes: " - 2026-6", "2026-6", " (2024_12)", " [2023-01-15]"
  t = t.replace(/\s*[-–—]\s*\d{4}[-_.]\d{1,2}([-_.]\d{1,2})?\s*$/i, '');
  t = t.replace(/\s+\d{4}[-_.]\d{1,2}([-_.]\d{1,2})?\s*$/i, '');
  t = t.replace(/\s*[([]\d{4}[-_.]\d{1,2}([-_.]\d{1,2})?[)\]]\s*$/i, '');

  // Leftover trailing separators and doubled whitespace
  t = t.replace(/\s*[-–—:|]\s*$/, '').replace(/\s{2,}/g, ' ').trim();
  return t;
}

/** Two-letter initials from the (cleaned) title, e.g. "AWS Solutions" -> "AS". */
export function courseInitials(title: string): string {
  const words = cleanTitle(title).split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) {
    const w = words[0].replace(/[^a-z0-9]/gi, '');
    return (w.slice(0, 2) || '?').toUpperCase();
  }
  const first = words[0].replace(/[^a-z0-9]/gi, '');
  const second = words[1].replace(/[^a-z0-9]/gi, '');
  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase() || '?';
}

/** Deterministic hue (0-359) from a title, for generated covers. */
export function titleHue(title: string): number {
  let h = 0;
  for (let i = 0; i < title.length; i++) {
    h = (h * 31 + title.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
}

const EXAM_CODE_NAMES: Record<string, string> = {
  'SAA-C03': 'AWS Certified Solutions Architect – Associate',
  'DVA-C02': 'AWS Certified Developer – Associate',
  'CLF-C02': 'AWS Certified Cloud Practitioner',
  'AIF-C01': 'AWS Certified AI Practitioner',
  'SAP-C02': 'AWS Certified Solutions Architect – Professional',
  'DOP-C02': 'AWS Certified DevOps Engineer – Professional',
  'SCS-C02': 'AWS Certified Security – Specialty',
  'MLS-C01': 'AWS Certified Machine Learning – Specialty',
  'MLA-C01': 'AWS Certified Machine Learning Engineer – Associate',
  'ANS-C01': 'AWS Certified Advanced Networking – Specialty',
  'DAS-C01': 'AWS Certified Data Analytics – Specialty',
  'DEA-C01': 'AWS Certified Data Engineer – Associate',
  'SOA-C02': 'AWS Certified SysOps Administrator – Associate',
};

export interface ExamGroup {
  /** Exam code like SAA-C03, or null when no code was found. */
  code: string | null;
  /** Display name used for grouping. */
  name: string;
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * A practice-test title without the certification it belongs to, for lists
 * already grouped by certification: "Practice Test #1 - AWS Certified Solutions
 * Architect Associate" -> "Practice Test #1". Falls back to the cleaned title.
 */
export function shortExamTitle(title: string, group: ExamGroup): string {
  const groupKey = normalizeName(group.name.replace(/^AWS Certified /i, ''));
  const isGroupPart = (part: string) => {
    const n = normalizeName(part.replace(/^AWS Certified /i, ''));
    if (!n) return true;
    if (group.code && n.includes(normalizeName(group.code))) return true;
    if (/full-?exam/i.test(part)) return true;
    return groupKey.length > 0 && (n.includes(groupKey) || groupKey.includes(n));
  };
  let t = splitOrdinal(title).text;
  // "(AWS Certified Developer Associate - DVA-C02)"
  t = t.replace(/\s*\(([^)]*)\)\s*$/, (m, inner: string) => (isGroupPart(inner) ? '' : m));
  const parts = t.split(/\s+[-–—|]\s+/);
  const kept = parts.filter((p, i) => i === 0 || !isGroupPart(p));
  const result = kept.join(' - ').trim();
  return result || title;
}

/** Derives the associated certification exam from a practice-exam title. */
export function examGroupInfo(title: string): ExamGroup {
  const codeMatch = /\b([A-Z]{2,4}-C\d{2})\b/.exec(title ?? '');
  if (codeMatch) {
    const code = codeMatch[1];
    return { code, name: EXAM_CODE_NAMES[code] ?? code };
  }
  const certMatch = /aws certified ([a-z0-9][a-z0-9&+.'\- ]*?)(?:\s*[-–—:|]\s*|\s*\(|\s*$)/i.exec(title ?? '');
  if (certMatch) {
    const words = certMatch[1].trim().split(/\s+/).filter(Boolean);
    const name = `AWS Certified ${words
      .map((w) => (/^[A-Z0-9]+$/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
      .join(' ')}`;
    // A name that matches a known certification joins that exam's group, so
    // files with and without the code in their title are not split apart.
    const known = Object.entries(EXAM_CODE_NAMES).find(([, n]) => normalizeName(n) === normalizeName(name));
    if (known) return { code: known[0], name: known[1] };
    return { code: null, name };
  }
  return { code: null, name: 'Other practice exams' };
}

/**
 * Splits a leading ordinal off a lesson or section name, so lists can show the
 * number in its own column: "01 - Welcome" -> { index: 1, text: "Welcome" }.
 * Only strips when a separator follows the number ("3 ways to scale" stays).
 */
export function splitOrdinal(raw: string): { index: number | null; text: string } {
  const title = (raw ?? '').trim();
  const m = /^(\d{1,4})(?:\.\d{1,3})?\s*(?:[-–—_:)]|\.(?=\s))\s*(.+)$/.exec(title)
    ?? /^(\d{1,4})\.\d{1,3}\s+(.+)$/.exec(title);
  if (!m || !m[2].trim()) return { index: null, text: title };
  // Four digits cover big courses ("1500 - …", "0001 - …") but a year is a
  // title, not a lesson number ("2024 - Year in review").
  if (m[1].length === 4 && /^(19|20)\d\d$/.test(m[1])) return { index: null, text: title };
  return { index: Number(m[1]), text: m[2].trim() };
}
