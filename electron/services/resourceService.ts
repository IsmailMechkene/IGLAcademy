import fs from 'node:fs';
import type Database from 'better-sqlite3';
import type { ResourceSearchHit } from '../../src/types';
import { listResourcesForCourse } from '../database/repositories/resources';

const MAX_FILE_BYTES = 1024 * 1024; // don't slurp huge files for search
const MAX_HITS = 50;

/** Full-text search over text-based resources (names always match too). */
export function searchResources(
  db: Database.Database,
  courseId: number,
  query: string,
): ResourceSearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: ResourceSearchHit[] = [];

  for (const resource of listResourcesForCourse(db, courseId)) {
    if (hits.length >= MAX_HITS) break;
    if (resource.title.toLowerCase().includes(q)) {
      hits.push({ resourceId: resource.id, title: resource.title, kind: resource.kind, snippet: '' });
      continue;
    }
    if (resource.kind !== 'text' && resource.kind !== 'markdown' && resource.kind !== 'subtitle') {
      continue; // PDFs and images match by file name only
    }
    let content: string;
    try {
      const stat = fs.statSync(resource.filePath);
      if (stat.size > MAX_FILE_BYTES || !stat.isFile()) continue;
      content = fs.readFileSync(resource.filePath, 'utf8');
    } catch {
      continue;
    }
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const at = line.toLowerCase().indexOf(q);
      if (at < 0) continue;
      const start = Math.max(0, at - 60);
      const snippet = `${start > 0 ? '…' : ''}${line.slice(start, start + 160).trim()}${start + 160 < line.length ? '…' : ''}`;
      hits.push({ resourceId: resource.id, title: resource.title, kind: resource.kind, snippet });
      break; // first match per file
    }
  }
  return hits;
}
