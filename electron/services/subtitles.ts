import fs from 'node:fs';
import path from 'node:path';

// Subtitle discovery + SRT-to-VTT conversion for local video lessons.

export interface SubtitleFile {
  filePath: string;
  label: string;
}

/** Converts SubRip content to WebVTT (browsers only render VTT tracks). */
export function srtToVtt(srt: string): string {
  const text = srt.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const cues: string[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '');
    if (lines.length === 0) continue;
    let i = 0;
    if (/^\d+$/.test(lines[0].trim())) i += 1; // numeric cue identifier
    if (i >= lines.length) continue;
    const timing = lines[i]
      .split('-->')
      .map((part) => part.trim().replace(',', '.'))
      .join(' --> ');
    if (!timing.includes('-->')) continue;
    const body = lines.slice(i + 1).join('\n');
    if (!body) continue;
    cues.push(`${timing}\n${body}`);
  }
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

function labelFor(fileName: string, videoStem: string, index: number): string {
  const stem = path.basename(fileName, path.extname(fileName));
  const suffix = stem.startsWith(videoStem) ? stem.slice(videoStem.length).replace(/^[._-]+/, '') : '';
  if (/^[a-z]{2}(-[A-Z]{2})?$/i.test(suffix)) return suffix.toUpperCase();
  if (suffix) return suffix;
  return index === 0 ? 'Subtitles' : `Subtitles ${index + 1}`;
}

/**
 * Finds subtitle sidecars for a video: exact basename matches (.vtt preferred
 * over .srt) plus language variants like `lesson.en.vtt`.
 */
export function findSubtitleFiles(videoPath: string): SubtitleFile[] {
  const dir = path.dirname(videoPath);
  const stem = path.basename(videoPath, path.extname(videoPath));
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const found: SubtitleFile[] = [];
  for (const name of entries) {
    const ext = path.extname(name).toLowerCase();
    if (ext !== '.vtt' && ext !== '.srt') continue;
    const nameStem = path.basename(name, ext);
    if (nameStem !== stem && !nameStem.startsWith(`${stem}.`) && !nameStem.startsWith(`${stem}_`)) {
      continue;
    }
    found.push({ filePath: path.join(dir, name), label: '' });
  }
  // Prefer VTT over SRT for the same base name, then sort deterministically.
  found.sort((a, b) => {
    const aStem = path.basename(a.filePath, path.extname(a.filePath));
    const bStem = path.basename(b.filePath, path.extname(b.filePath));
    if (aStem !== bStem) return aStem < bStem ? -1 : 1;
    return path.extname(a.filePath) === '.vtt' ? -1 : 1;
  });
  const deduped = found.filter(
    (f, i) =>
      i === 0 ||
      path.basename(f.filePath, path.extname(f.filePath)) !==
        path.basename(found[i - 1].filePath, path.extname(found[i - 1].filePath)),
  );
  return deduped.map((f, i) => ({
    ...f,
    label: labelFor(path.basename(f.filePath), stem, i),
  }));
}
