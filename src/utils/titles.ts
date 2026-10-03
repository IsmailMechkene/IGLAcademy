// Display-title helpers. The original folder/file names are never modified —
// these only affect what the UI shows (the full name stays in tooltips).

/** Strips marketplace prefixes, resolution tags and date suffixes. */
export function cleanTitle(raw: string): string {
  let t = (raw ?? '').trim();

  // Leading/trailing marketplace tags: "Udemy - X", "X - Udemy"
  t = t.replace(/^(udemy|skillshare|coursera|pluralsight|linkedin learning|udacity)\s*[-–—:|]\s*/i, '');
  t = t.replace(/\s*[-–—:|]\s*(udemy|skillshare|coursera|pluralsight|linkedin learning|udacity)$/i, '');

  // Resolution tags: "1080p", "(1080)", "4K", "[2K]", trailing bare "1080"
  t = t.replace(/[\s\(\[]\b(\d{3,4}p|[24]K)\b[\)\]]?/gi, '');
  t = t.replace(/\s+\(?\b(1080|720|2160)\b\)?$/i, '');

  // Date suffixes: " - 2026-6", "2026-6", " (2024_12)", " [2023-01-15]"
  t = t.replace(/\s*[-–—]\s*\d{4}[-_.]\d{1,2}([-_.]\d{1,2})?\s*$/i, '');
  t = t.replace(/\s+\d{4}[-_.]\d{1,2}([-_.]\d{1,2})?\s*$/i, '');
  t = t.replace(/\s*[\(\[]\d{4}[-_.]\d{1,2}([-_.]\d{1,2})?[\)\]]\s*$/i, '');

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
