import fs from 'node:fs';
import path from 'node:path';
import { naturalSort } from './naturalSort';
import { canonicalDir, canonicalDirAsync } from './pathIdentity';

// Supported media / resource formats
export const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mkv'] as const;
// HTML practice tests (e.g. downloaded Udemy practice exams)
export const PRACTICE_EXTENSIONS = ['.html', '.htm'] as const;
export const RESOURCE_EXTENSIONS = [
  '.pdf', '.txt', '.md', '.vtt', '.srt',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg',
] as const;
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'] as const;

/** File names (without extension) that mark an image as course artwork. */
const COVER_NAME = /^(cover|thumbnail|thumb|poster|folder|banner|artwork)([\s._-].*)?$/i;

/**
 * Whether `imagePath` can serve as the cover of the course at `root`: any
 * image directly in the root, or a cover-named image anywhere below it.
 */
export function isCoverImage(root: string, imagePath: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(imagePath));
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  if (!IMAGE_EXTENSIONS.includes(path.extname(rel).toLowerCase() as (typeof IMAGE_EXTENSIONS)[number])) return false;
  return path.dirname(rel) === '.' || COVER_NAME.test(path.parse(rel).name);
}

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
  /**
   * The section's identity: its folder relative to the course root, with
   * forward slashes ('' = the root's default section). Null only for the
   * synthetic "Resources" section, which has no folder of its own.
   */
  relPath: string | null;
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

const RESOURCE_KIND_BY_EXT: Record<string, 'pdf' | 'image' | 'text' | 'markdown' | 'subtitle'> = {
  '.pdf': 'pdf',
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.gif': 'image', '.webp': 'image', '.svg': 'image',
  '.txt': 'text',
  '.md': 'markdown',
  '.vtt': 'subtitle', '.srt': 'subtitle',
};

/** Database resource kind for a file name. */
export function resourceKindFor(fileName: string): 'pdf' | 'image' | 'text' | 'markdown' | 'subtitle' | 'other' {
  return RESOURCE_KIND_BY_EXT[extOf(fileName)] ?? 'other';
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

/**
 * Section titles a scan can generate for a folder: the leaf name, and the
 * "Parent / Leaf" form used when sibling trees share a leaf name. Rescan uses
 * this to tell a scanner-made title (safe to update) from a user's rename.
 */
export function generatedSectionTitles(rel: string): string[] {
  const parts = rel.split('/').filter(Boolean);
  if (parts.length === 0) return [];
  const leaf = titleFromFolderName(parts[parts.length - 1]);
  if (parts.length === 1) return [leaf];
  return [leaf, `${titleFromFolderName(parts[parts.length - 2])} / ${leaf}`];
}

interface DirEntry {
  dir: string; // absolute path
  rel: string; // relative path from course root ('' for root)
}

interface DirContent {
  videos: string[];
  practice: string[];
  resources: ScannedResource[];
}

/** What one directory read yields: its subfolders and its classified files. */
function classifyEntries(dir: string, rel: string, entries: fs.Dirent[]): { subdirs: DirEntry[]; content: DirContent } {
  const subdirs: DirEntry[] = [];
  const content: DirContent = { videos: [], practice: [], resources: [] };
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue; // skip hidden files and folders
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      subdirs.push({ dir: full, rel: rel ? path.posix.join(rel, entry.name) : entry.name });
    } else if (!entry.isFile()) {
      continue;
    } else if (isVideoFile(entry.name)) {
      content.videos.push(full);
    } else if (isPracticeFile(entry.name)) {
      content.practice.push(full);
    } else if (isResourceFile(entry.name)) {
      content.resources.push({
        fileName: entry.name,
        filePath: full,
        kind: isImageFile(entry.name) ? 'image' : 'resource',
      });
    }
  }
  return { subdirs, content };
}

interface CollectedTree {
  /** Every directory, depth-first in listing order (root first). */
  dirs: DirEntry[];
  contentByDir: Map<string, DirContent>;
}

function collectTreeSync(root: string): CollectedTree {
  const tree: CollectedTree = { dirs: [], contentByDir: new Map() };
  const visit = (d: DirEntry) => {
    tree.dirs.push(d);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d.dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory — skip
    }
    const { subdirs, content } = classifyEntries(d.dir, d.rel, entries);
    tree.contentByDir.set(d.rel, content);
    for (const sub of subdirs) visit(sub);
  };
  visit({ dir: root, rel: '' });
  return tree;
}

/**
 * Same walk as `collectTreeSync`, with the directory reads off the main
 * thread. Folders are read one at a time: the libuv pool also serves video
 * streaming, and a burst of reads would stall playback during a rescan.
 */
async function collectTreeAsync(root: string): Promise<CollectedTree> {
  const tree: CollectedTree = { dirs: [], contentByDir: new Map() };
  const visit = async (d: DirEntry) => {
    tree.dirs.push(d);
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(d.dir, { withFileTypes: true });
    } catch {
      return; // unreadable directory — skip
    }
    const { subdirs, content } = classifyEntries(d.dir, d.rel, entries);
    tree.contentByDir.set(d.rel, content);
    for (const sub of subdirs) await visit(sub);
  };
  await visit({ dir: root, rel: '' });
  return tree;
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
  const root = canonicalDir(rootPath);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`Course directory not found: ${root}`);
  }
  return buildCourse(root, collectTreeSync(root));
}

/** `scanCourseDirectory` without blocking the main process on disk I/O. */
export async function scanCourseDirectoryAsync(rootPath: string): Promise<ScannedCourse> {
  const root = await canonicalDirAsync(rootPath);
  const stat = await fs.promises.stat(root).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(`Course directory not found: ${root}`);
  }
  return buildCourse(root, await collectTreeAsync(root));
}

/** Turns a collected directory tree into sections, lessons and a cover. */
function buildCourse(root: string, { dirs, contentByDir }: CollectedTree): ScannedCourse {
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
      relPath: rel,
      lessons: buildLessons(content.videos, content.practice),
      resources: naturalSort(content.resources, (r) => r.fileName),
      position: sections.length + 1,
    };
    sections.push(section);
    sectionByRel.set(rel, section);
  }

  // Sibling trees often reuse leaf names ("Part 1/Videos", "Part 2/Videos").
  // Give those the parent's name too, so the sidebar does not show two
  // indistinguishable "Videos" sections.
  const leafCounts = new Map<string, number>();
  for (const s of sections) leafCounts.set(s.title.toLowerCase(), (leafCounts.get(s.title.toLowerCase()) ?? 0) + 1);
  for (const s of sections) {
    if ((leafCounts.get(s.title.toLowerCase()) ?? 0) < 2 || !s.relPath) continue;
    const candidates = generatedSectionTitles(s.relPath);
    if (candidates.length > 1) s.title = candidates[1];
  }

  // Root-level lessons go into a default section
  if (hasLessons(rootContent)) {
    const defaultSection: ScannedSection = {
      title: DEFAULT_SECTION_TITLE,
      relPath: '',
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
      relPath: null,
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

  // Cover: an image at the root, else one named like a cover in a subfolder.
  // Any other image deeper down is lecture material (screenshots, diagrams),
  // not artwork; without a cover the app uses a frame from the first video.
  let thumbnailPath: string | null = null;
  const rootImages = (contentByDir.get('')?.resources ?? []).filter((r) => r.kind === 'image');
  if (rootImages.length > 0) {
    thumbnailPath = rootImages[0].filePath;
  } else {
    outer: for (const { rel } of sortedDirs) {
      const imgs = (contentByDir.get(rel)?.resources ?? []).filter(
        (r) => r.kind === 'image' && COVER_NAME.test(path.parse(r.fileName).name),
      );
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
