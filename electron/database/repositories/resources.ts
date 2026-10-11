import fs from 'node:fs';
import type Database from 'better-sqlite3';
import type { CourseResource, ResourceKind } from '../../../src/types';

interface ResourceRow {
  id: number;
  section_id: number;
  section_title: string;
  title: string;
  file_path: string;
  kind: string;
  position: number;
}

export function toResourceKind(kind: string): ResourceKind {
  if (kind === 'pdf' || kind === 'image' || kind === 'text' || kind === 'markdown' || kind === 'subtitle') {
    return kind;
  }
  return 'other';
}

/**
 * A resource row as stored. The file size is not part of it: stat()ing every
 * file here meant one blocking syscall per row on the main thread. The IPC
 * layer adds sizes asynchronously where the UI needs them (`withFileSizes`).
 */
export type ResourceRecord = Omit<CourseResource, 'sizeBytes'>;

function toResource(row: ResourceRow): ResourceRecord {
  return {
    id: row.id,
    sectionId: row.section_id,
    sectionTitle: row.section_title,
    title: row.title,
    filePath: row.file_path,
    kind: toResourceKind(row.kind),
    position: row.position,
  };
}

/** Adds on-disk sizes (-1 = missing) without blocking the main thread. */
export async function withFileSizes(resources: ResourceRecord[]): Promise<CourseResource[]> {
  return Promise.all(
    resources.map(async (r) => ({
      ...r,
      sizeBytes: await fs.promises.stat(r.filePath).then((st) => st.size, () => -1),
    })),
  );
}

export function listResourcesForCourse(db: Database.Database, courseId: number): ResourceRecord[] {
  const rows = db
    .prepare(
      `SELECT r.*, s.title AS section_title
       FROM resources r
       JOIN sections s ON s.id = r.section_id
       WHERE s.course_id = ?
       ORDER BY s.position, r.position`,
    )
    .all(courseId) as ResourceRow[];
  return rows.map(toResource);
}

export function getResource(db: Database.Database, id: number): ResourceRecord | null {
  const row = db
    .prepare(
      `SELECT r.*, s.title AS section_title
       FROM resources r
       JOIN sections s ON s.id = r.section_id
       WHERE r.id = ?`,
    )
    .get(id) as ResourceRow | undefined;
  return row ? toResource(row) : null;
}

export function insertResource(
  db: Database.Database,
  sectionId: number,
  data: { title: string; filePath: string; kind: ResourceKind; position: number },
): number {
  const info = db
    .prepare('INSERT INTO resources (section_id, title, file_path, kind, position) VALUES (?, ?, ?, ?, ?)')
    .run(sectionId, data.title, data.filePath, data.kind, data.position);
  return Number(info.lastInsertRowid);
}

export function deleteResource(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM resources WHERE id = ?').run(id);
}
