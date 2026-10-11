import fs from 'node:fs';
import path from 'node:path';

/**
 * Path identity helpers. Windows paths are case-insensitive, so the same
 * folder can arrive as "C:\Courses\AWS" or "c:\courses\aws"; comparing raw
 * strings made those two different courses (and different lessons).
 */

const caseInsensitive = process.platform === 'win32';

/** Comparison key for a filesystem path. Never stored or shown — compare only. */
export function pathKey(p: string): string {
  const resolved = path.resolve(p);
  return caseInsensitive ? resolved.toLowerCase() : resolved;
}

/** Comparison key for a course-relative folder ("Part 1/Videos"). */
export function relKey(rel: string): string {
  return caseInsensitive ? rel.toLowerCase() : rel;
}

/**
 * Canonical spelling of an existing directory: resolves symlinks/junctions and
 * the true on-disk casing, so the stored source path does not depend on how
 * the user happened to type or pick it. Falls back to `path.resolve`.
 */
export function canonicalDir(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

/** True when `file` is `root` itself or somewhere beneath it. */
export function isInsideDir(root: string, file: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(file));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/**
 * The course-relative folder that contains `filePath`, with forward slashes
 * ('' for the course root), or null when the file is outside the course.
 */
export function relDirOf(root: string, filePath: string): string | null {
  const dir = path.dirname(path.resolve(filePath));
  if (!isInsideDir(root, dir)) return null;
  return path.relative(path.resolve(root), dir).split(path.sep).join('/');
}
