// Parses single-file HTML practice exams (ダウンロード-style dumps that embed
// a `const quizData = {...}` JSON blob) into native IsmaLearn quiz content.
// Pure logic — no Electron, filesystem, or database access, fully testable.

export interface ParsedPracticeQuestion {
  question: string;
  options: string[];
  correctIndices: number[];
  explanation: string;
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

interface RawQuestion {
  assessment_type?: unknown;
  prompt?: { question?: unknown; answers?: unknown; explanation?: unknown };
  correct_response?: unknown;
  question_plain?: unknown;
}

function letterToIndex(letter: unknown, optionCount: number): number | null {
  if (typeof letter !== 'string' || letter.length !== 1) return null;
  const idx = letter.toLowerCase().charCodeAt(0) - 97; // 'a' -> 0
  if (idx < 0 || idx >= optionCount) return null;
  return idx;
}

/** Extracts the quizData JSON blob via brace matching (string-aware). */
function extractQuizData(content: string): unknown | null {
  const marker = 'const quizData =';
  const markerIdx = content.indexOf(marker);
  if (markerIdx < 0) return null;
  const start = content.indexOf('{', markerIdx + marker.length);
  if (start < 0) return null;

  let depth = 0;
  let end = -1;
  let inString = false;
  let escaped = false;
  for (let i = start; i < content.length; i++) {
    const c = content[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) return null;

  // JSON forbids raw control characters, but they are legal inside JS string
  // literals and appear in these dumps (e.g. inside <pre> blocks). They can
  // only occur inside strings here, never as structural syntax, so blanking
  // them is safe.
  const raw = content.slice(start, end).replace(/[\x00-\x1F]/g, ' ');
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function parsePracticeExamHtml(content: string): ParsedPracticeExam | null {
  if (typeof content !== 'string' || content.length === 0) return null;
  const data = extractQuizData(content) as {
    quiz_title?: unknown;
    questions?: unknown;
  } | null;
  if (!data || typeof data !== 'object' || !Array.isArray(data.questions)) return null;

  const title = typeof data.quiz_title === 'string' && data.quiz_title.trim()
    ? data.quiz_title.trim()
    : '';
  const questions: ParsedPracticeQuestion[] = [];
  let skipped = 0;

  for (const raw of data.questions as RawQuestion[]) {
    if (!raw || typeof raw !== 'object') {
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
      explanation: typeof prompt.explanation === 'string' ? htmlToText(prompt.explanation) : '',
    });
  }

  return { title, questions, skipped };
}
