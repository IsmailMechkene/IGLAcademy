// Parses single-file HTML practice exams (ダウンロード-style dumps that embed
// a `const quizData = {...}` JSON blob) into native IsmaLearn quiz content.
// Pure logic — no Electron, filesystem, or database access, fully testable.

export interface ParsedPracticeQuestion {
  question: string;
  options: string[];
  correctIndices: number[];
  explanation: string;
  /** Source domain from the file (e.g. "Security"), empty when unknown. */
  topic: string;
}

export interface ParsedPracticeExam {
  title: string;
  questions: ParsedPracticeQuestion[];
  /** Questions present in the file but skipped (unknown type, bad data). */
  skipped: number;
}

/** Converts simple HTML (options, explanations) into readable plain text. */
export function htmlToText(html: string): string {
  return (html ?? '')
    .replace(/<(br|p|li|tr|h[1-6]|pre|div|ul|ol)[^>]*>/gi, '\n')
    .replace(/<\/(p|li|tr|h[1-6]|pre|div|ul|ol)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

/**
 * Like htmlToText, but keeps the structure explanations rely on as small,
 * inert markers the renderer understands: **bold** (option names), `code`,
 * [text](https://link) and ![diagram](https://image). Lists become "• " lines.
 * Nothing is ever rendered as HTML; anything else is stripped to text.
 */
export function htmlToRichText(html: string): string {
  const safeUrl = (url: string) => (/^https?:\/\/[^\s()]+$/i.test(url) ? url : null);
  return (html ?? '')
    .replace(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi, (_m, src: string) => {
      const url = safeUrl(src.trim());
      return url ? `\n![diagram](${url})\n` : '';
    })
    .replace(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
      const url = safeUrl(href.trim());
      const text = inner.replace(/<[^>]+>/g, '').replace(/[[\]]/g, '').trim() || href;
      return url ? `[${text}](${url})` : text;
    })
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner: string) => {
      const text = inner.replace(/<[^>]+>/g, '').trim();
      return text ? `**${text}**` : '';
    })
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_m, inner: string) => {
      const text = inner.replace(/<[^>]+>/g, '').replace(/`/g, "'");
      return text ? `\`${text}\`` : '';
    })
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<(br|p|tr|h[1-6]|pre|div|ul|ol)[^>]*>/gi, '\n')
    .replace(/<\/(p|li|tr|h[1-6]|pre|div|ul|ol)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0 && line !== '•')
    .join('\n');
}

interface RawQuestion {
  assessment_type?: unknown;
  prompt?: { question?: unknown; answers?: unknown; explanation?: unknown };
  correct_response?: unknown;
  question_plain?: unknown;
  section?: unknown;
}

function letterToIndex(letter: unknown, optionCount: number): number | null {
  if (typeof letter !== 'string' || letter.length !== 1) return null;
  const idx = letter.toLowerCase().charCodeAt(0) - 97; // 'a' -> 0
  if (idx < 0 || idx >= optionCount) return null;
  return idx;
}

/** Extracts the quizData JSON blob via brace matching (string-aware). */
/**
 * Extracts raw question-object strings from the questions array, one at a
 * time, plus the exam title. Files truncated mid-download (or with a garbled
 * question) still yield every intact question instead of failing the file.
 */
function extractQuestionBlobs(content: string): { title: string; blobs: string[]; truncatedTail: boolean } {
  const noData = { title: '', blobs: [] as string[], truncatedTail: false };
  if (typeof content !== 'string' || content.length === 0) return noData;
  const marker = 'const quizData =';
  const markerIdx = content.indexOf(marker);
  if (markerIdx < 0) return noData;

  const head = content.slice(markerIdx, markerIdx + 50000);
  const titleMatch = /"quiz_title"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(head);
  const title = titleMatch ? titleMatch[1] : '';

  const arrIdx = content.indexOf('"questions"', markerIdx);
  if (arrIdx < 0) return { title, blobs: [], truncatedTail: false };
  const arrStart = content.indexOf('[', arrIdx);
  if (arrStart < 0) return { title, blobs: [], truncatedTail: false };

  // Never scan past the script end — anything beyond is not data.
  const scriptEnd = content.indexOf('</script>', arrStart);
  const limit = scriptEnd > 0 ? scriptEnd : content.length;

  // Match one balanced {...} element starting at `from` (which must be '{').
  // Returns the end offset (exclusive), or -1 when truncated.
  const matchElement = (from: number): number => {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = from; i < limit; i++) {
      const ch = content[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return i + 1;
      }
    }
    return -1;
  };

  const blobs: string[] = [];
  let closedNormally = false;
  let i = arrStart + 1;
  let inString = false;
  let escaped = false;
  // Walk the array's top level: '{' starts an element, ']' ends the array.
  // Nested arrays (unexpected) are skipped wholesale.
  while (i < limit) {
    const c = content[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      i++;
      continue;
    }
    if (c === '"') {
      inString = true;
      i++;
      continue;
    }
    if (c === '[') {
      let depth = 1;
      i++;
      while (i < limit && depth > 0) {
        const d = content[i];
        if (inString) {
          if (escaped) escaped = false;
          else if (d === '\\') escaped = true;
          else if (d === '"') inString = false;
        } else if (d === '"') {
          inString = true;
        } else if (d === '[') {
          depth++;
        } else if (d === ']') {
          depth--;
        }
        i++;
      }
      continue;
    }
    if (c === ']') {
      closedNormally = true;
      break;
    }
    if (c === '{') {
      const end = matchElement(i);
      if (end < 0) break; // truncated tail — stop, keep what we have
      blobs.push(content.slice(i, end));
      i = end;
      continue;
    }
    i++;
  }
  let truncatedTail = false;
  if (!closedNormally) {
    truncatedTail = content.slice(i, limit).includes('{');
  }
  return { title, blobs, truncatedTail };
}

/**
 * Parses one raw question blob. Returns null when the blob is not usable
 * JSON (garbled or truncated question).
 */
function parseQuestionBlob(blob: string): RawQuestion | null {
  // JSON forbids raw control characters, but they are legal inside JS string
  // literals and appear in these dumps (e.g. inside <pre> blocks). They can
  // only occur inside strings here, never as structural syntax, so blanking
  // them is safe.
  // eslint-disable-next-line no-control-regex -- matching control characters is the point
  const raw = blob.replace(/[\x00-\x1F]/g, ' ');
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as RawQuestion;
  } catch {
    return null;
  }
}

export function parsePracticeExamHtml(content: string): ParsedPracticeExam | null {
  const { title, blobs, truncatedTail } = extractQuestionBlobs(content);
  if (blobs.length === 0) return null;

  const questions: ParsedPracticeQuestion[] = [];
  let skipped = truncatedTail ? 1 : 0;

  for (const blob of blobs) {
    const raw = parseQuestionBlob(blob);
    if (!raw) {
      skipped++;
      continue;
    }
    const type = raw.assessment_type;
    if (type !== 'multiple-choice' && type !== 'multi-select') {
      skipped++;
      continue;
    }
    const prompt = raw.prompt;
    if (!prompt || typeof prompt !== 'object' || !Array.isArray(prompt.answers)) {
      skipped++;
      continue;
    }
    const options = (prompt.answers as unknown[])
      .filter((a): a is string => typeof a === 'string')
      .map((a) => htmlToText(a))
      .filter((a) => a.length > 0);
    if (options.length < 2 || !Array.isArray(raw.correct_response)) {
      skipped++;
      continue;
    }
    const correctIndices = [...new Set(
      (raw.correct_response as unknown[])
        .map((letter) => letterToIndex(letter, options.length))
        .filter((i): i is number => i !== null),
    )].sort((a, b) => a - b);
    if (correctIndices.length === 0) {
      skipped++;
      continue;
    }
    if (type === 'multiple-choice' && correctIndices.length !== 1) {
      skipped++;
      continue;
    }
    const stemHtml = typeof prompt.question === 'string' && prompt.question.trim()
      ? prompt.question
      : typeof raw.question_plain === 'string'
        ? raw.question_plain
        : '';
    const question = htmlToText(stemHtml);
    if (!question) {
      skipped++;
      continue;
    }
    questions.push({
      question,
      options,
      correctIndices,
      explanation: typeof prompt.explanation === 'string' ? htmlToRichText(prompt.explanation) : '',
      topic: typeof raw.section === 'string' ? raw.section.trim() : '',
    });
  }

  return { title: title.trim(), questions, skipped };
}
