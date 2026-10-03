import fs from 'node:fs';
import path from 'node:path';
import { naturalSort } from './naturalSort';

// Supported media / resource formats
export const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mkv'] as const;
// HTML practice tests (e.g. downloaded Udemy practice exams)
export const PRACTICE_EXTENSIONS = ['.html', '.htm'] as const;
export const RESOURCE_EXTENSIONS = [
  '.pdf', '.txt', '.md', '.vtt', '.srt',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
] as const;
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'] as const;

export interface ScannedResource {
  fileName: string;
  filePath: string;
  kind: 'resource' | 'image';
}

export interface ScannedLesson {
  title: string;
  filePath: string;
  kind: 'video' | 'practice';
  position: number;
}

export interface ScannedSection {
  title: string;
  lessons: ScannedLesson[];
  resources: ScannedResource[];
  position: number;
}

export interface ScannedCourse {
  title: string;
  rootPath: string;
  sections: ScannedSection[];
  thumbnailPath: string | null;
  lessonCount: number;
}

function extOf(filePath: string): string {
  return path.extname(filePath).toLowerCase();
}

export function isVideoFile(filePath: string): boolean {
  return (VIDEO_EXTENSIONS as readonly string[]).includes(extOf(filePath));
}

export function isPracticeFile(filePath: string): boolean {
  return (PRACTICE_EXTENSIONS as readonly string[]).includes(extOf(filePath));
}

export function isResourceFile(filePath: string): boolean {
  return (RESOURCE_EXTENSIONS as readonly string[]).includes(extOf(filePath));
}

export function isImageFile(filePath: string): boolean {
  return (IMAGE_EXTENSIONS as readonly string[]).includes(extOf(filePath));
}

/** Cleans a filename stem into a display title. */
export function titleFromFileName(fileName: string): string {
  const stem = path.basename(fileName, path.extname(fileName));
  return stem.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim() || stem;
}

/** Cleans a folder name into a section title. */
export function titleFromFolderName(folderName: string): string {
  return folderName.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim() || folderName;
}

interface DirEntry {
  dir: string; // absolute path
  rel: string; // relative path from course root ('' for root)
}

/**
 * Recursively scans a course directory and produces a structured course:
 * - subfolders become sections
 * - video files become video lessons
 * - HTML files become practice-test lessons (e.g. downloaded practice exams)
 * - resources (pdf, txt, md, subtitles, images) attach to their section
 * - everything is sorted naturally and deterministically
 */
export function scanCourseDirectory(rootPath: string): ScannedCourse {
  const root = path.resolve(rootPath);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`Course directory not found: ${root}`);
  }

  // Collect all directories (relative to root)
  const dirs: DirEntry[] = [{ dir: root, rel: '' }];
  const walk = (dir: string, rel: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory — skip
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue; // skip hidden folders
      const childRel = rel ? path.posix.join(rel, entry.name) : entry.name;
      dirs.push({ dir: path.join(dir, entry.name), rel: childRel });
      walk(path.join(dir, entry.name), childRel);
    }
  };
  walk(root, '');

  // Group files by directory
  interface DirContent {
    videos: string[];
    practice: string[];
    resources: ScannedResource[];
  }
  const contentByDir = new Map<string, DirContent>();
  for (const { dir, rel } of dirs) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const content: DirContent = { videos: [], practice: [], resources: [] };
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (entry.name.startsWith('.')) continue;
      const filePath = path.join(dir, entry.name);
      if (isVideoFile(entry.name)) {
        content.videos.push(filePath);
      } else if (isPracticeFile(entry.name)) {
        content.practice.push(filePath);
      } else if (isResourceFile(entry.name)) {
        content.resources.push({
          fileName: entry.name,
          filePath,
          kind: isImageFile(entry.name) ? 'image' : 'resource',
        });
      }
    }
    contentByDir.set(rel, content);
  }

  /** Merges videos + practice files into one naturally-sorted lesson list. */
  const buildLessons = (videos: string[], practice: string[]): ScannedLesson[] => {
    const files = [
      ...videos.map((filePath) => ({ filePath, kind: 'video' as const })),
      ...practice.map((filePath) => ({ filePath, kind: 'practice' as const })),
    ];
    return naturalSort(files, (f) => path.basename(f.filePath)).map((l, i) => ({
      title: titleFromFileName(l.filePath),
      filePath: l.filePath,
      kind: l.kind,
      position: i + 1,
    }));
  };

  const hasLessons = (content: DirContent): boolean =>
    content.videos.length > 0 || content.practice.length > 0;

  // Build sections: every directory with videos or practice tests becomes a section.
  // The root directory (rel === '') becomes the default section when it has lessons.
  const DEFAULT_SECTION_TITLE = 'Course Content';
  const sections: ScannedSection[] = [];
  const rootContent = contentByDir.get('') ?? { videos: [], practice: [], resources: [] };

  const sortedDirs = naturalSort(dirs.filter((d) => d.rel !== ''), (d) => d.rel);

  // Track which directory each section came from so orphan resources can
  // attach to their nearest video-containing ancestor section.
  const sectionByRel = new Map<string, ScannedSection>();

  for (const { rel } of sortedDirs) {
    const content = contentByDir.get(rel);
    if (!content || !hasLessons(content)) continue;
    const section: ScannedSection = {
      title: titleFromFolderName(path.posix.basename(rel)),
      lessons: buildLessons(content.videos, content.practice),
      resources: naturalSort(content.resources, (r) => r.fileName),
      position: sections.length + 1,
    };
    sections.push(section);
    sectionByRel.set(rel, section);
  }

  // Root-level lessons go into a default section
  if (hasLessons(rootContent)) {
    const defaultSection: ScannedSection = {
      title: DEFAULT_SECTION_TITLE,
      lessons: buildLessons(rootContent.videos, rootContent.practice),
      resources: naturalSort(rootContent.resources, (r) => r.fileName),
      position: 0,
    };
    sections.unshift(defaultSection);
    sectionByRel.set('', defaultSection);
  }

  // Resources in directories without lessons attach to the nearest ancestor
  // section (e.g. "02 - EC2/Resources/notes.pdf" belongs to "02 - EC2").
  // Anything without a lesson-containing ancestor gets a "Resources" section.
  const leftover: ScannedResource[] = [];
  for (const { rel } of dirs) {
    if (rel === '') continue;
    const content = contentByDir.get(rel);
    if (!content || hasLessons(content) || content.resources.length === 0) continue;

    let probe: string | null = rel;
    let target: ScannedSection | undefined;
    while (probe !== null) {
      target = sectionByRel.get(probe);
      if (target) break;
      const slash = probe.lastIndexOf('/');
      probe = slash >= 0 ? probe.slice(0, slash) : null;
    }
    // Fall back to the root default section when one exists
    if (!target) target = sectionByRel.get('');

    if (target) {
      target.resources.push(...content.resources);
      target.resources = naturalSort(target.resources, (r) => r.fileName);
    } else {
      leftover.push(...content.resources);
    }
  }
  if (leftover.length > 0) {
    sections.push({
      title: 'Resources',
      lessons: [],
      resources: naturalSort(leftover, (r) => r.fileName),
      position: sections.length + 1,
    });
  }

  // Re-number positions after all merges
  sections.forEach((s, i) => {
    s.position = i + 1;
    s.lessons.forEach((l, j) => {
      l.position = j + 1;
    });
  });

  // Thumbnail: prefer an image at the root, else the first image found in natural order
  let thumbnailPath: string | null = null;
  const rootImages = (contentByDir.get('')?.resources ?? []).filter((r) => r.kind === 'image');
  if (rootImages.length > 0) {
    thumbnailPath = rootImages[0].filePath;
  } else {
    outer: for (const { rel } of sortedDirs) {
      const imgs = (contentByDir.get(rel)?.resources ?? []).filter((r) => r.kind === 'image');
      if (imgs.length > 0) {
        thumbnailPath = imgs[0].filePath;
        break outer;
      }
    }
  }

  const lessonCount = sections.reduce((sum, s) => sum + s.lessons.length, 0);

  return {
    title: titleFromFolderName(path.basename(root)),
    rootPath: root,
    sections,
    thumbnailPath,
    lessonCount,
  };
}
