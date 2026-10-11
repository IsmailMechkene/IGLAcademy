/**
 * Turns an answer explanation (plain text with the inert markers produced by
 * the practice-exam parser: **bold**, `code`, [text](url), ![diagram](url))
 * into sections the UI can lay out: what is correct, why the others are
 * wrong, references. Hand-written quiz explanations without any of that
 * structure come back as a single general section.
 */

export type SectionKind = 'general' | 'correct' | 'incorrect' | 'references' | 'alert';

export interface OptionBlock {
  /** Option names this block talks about (several options can share one explanation). */
  names: string[];
  paragraphs: string[];
}

export interface ExplanationSection {
  kind: SectionKind;
  /** Paragraphs that are not about a specific option. */
  paragraphs: string[];
  options: OptionBlock[];
}

export type InlineToken =
  | { type: 'text'; text: string }
  | { type: 'bold'; text: string }
  | { type: 'code'; text: string }
  | { type: 'link'; text: string; url: string }
  | { type: 'image'; url: string };

const HEADINGS: Array<[RegExp, SectionKind]> = [
  [/^correct (answers?|options?)\s*:?\s*$/i, 'correct'],
  [/^incorrect (answers?|options?)\s*:?\s*$/i, 'incorrect'],
  [/^(references?|sources?|links?)\s*:?\s*$/i, 'references'],
  [/^(exam alert|exam tip|note|important)\s*:?\s*$/i, 'alert'],
];

function headingKind(line: string): SectionKind | null {
  for (const [re, kind] of HEADINGS) if (re.test(line)) return kind;
  return null;
}

/** "**Option name** - why" -> { name, rest } when the line opens with a bold run. */
function leadingBold(line: string): { name: string; rest: string } | null {
  const m = /^\*\*(.+?)\*\*\s*(?:[-–—:]\s*)?(.*)$/.exec(line);
  if (!m) return null;
  return { name: m[1].trim(), rest: m[2].trim() };
}

export function parseExplanation(text: string): ExplanationSection[] {
  const lines = (text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const sections: ExplanationSection[] = [];
  let current: ExplanationSection = { kind: 'general', paragraphs: [], options: [] };
  const push = () => {
    if (current.paragraphs.length > 0 || current.options.length > 0) sections.push(current);
  };

  for (const line of lines) {
    const kind = headingKind(line);
    if (kind) {
      push();
      current = { kind, paragraphs: [], options: [] };
      continue;
    }
    if (current.kind === 'correct' || current.kind === 'incorrect') {
      const bold = leadingBold(line);
      if (bold) {
        const last = current.options[current.options.length - 1];
        // Consecutive option names with no text yet share the explanation
        // that follows ("Both these options are incorrect as ...").
        if (last && last.paragraphs.length === 0) last.names.push(bold.name);
        else current.options.push({ names: [bold.name], paragraphs: [] });
        if (bold.rest) current.options[current.options.length - 1].paragraphs.push(bold.rest);
        continue;
      }
      const last = current.options[current.options.length - 1];
      if (last) {
        last.paragraphs.push(line);
        continue;
      }
    }
    current.paragraphs.push(line);
  }
  push();
  return sections;
}

/** Splits one line into text, bold, code, link and image tokens. */
export function tokenizeInline(line: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const re = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*(.+?)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m.index > last) tokens.push({ type: 'text', text: line.slice(last, m.index) });
    if (m[1]) tokens.push({ type: 'image', url: m[1] });
    else if (m[3]) tokens.push({ type: 'link', text: m[2], url: m[3] });
    else if (m[4]) tokens.push({ type: 'bold', text: m[4] });
    else if (m[5]) tokens.push({ type: 'code', text: m[5] });
    last = m.index + m[0].length;
  }
  if (last < line.length) tokens.push({ type: 'text', text: line.slice(last) });
  return tokens;
}

/** Short label for a link: its host plus the last path segment. */
export function linkLabel(text: string, url: string): string {
  if (text && text !== url && !/^https?:\/\//.test(text)) return text;
  try {
    const u = new URL(url);
    const tail = u.pathname.split('/').filter(Boolean).pop() ?? '';
    const readable = tail.replace(/\.(html?|pdf)$/i, '').replace(/[-_]+/g, ' ');
    return readable ? `${u.hostname.replace(/^www\./, '')} · ${readable}` : u.hostname.replace(/^www\./, '');
  } catch {
    return text || url;
  }
}
