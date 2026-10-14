/**
 * Reads CHANGELOG.md (one `## <version>` heading per release, `- ` bullets
 * under it). Shared by the in-app "What's new" dialog and, through
 * scripts/release-notes.mjs, the GitHub release text.
 */

export interface ChangelogEntry {
  version: string;
  items: string[];
}

export function parseChangelog(markdown: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let current: ChangelogEntry | null = null;
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = /^##\s+v?(\d+\.\d+\.\d+\S*)/.exec(line);
    if (heading) {
      current = { version: heading[1], items: [] };
      entries.push(current);
    } else if (current && line.startsWith('- ')) {
      current.items.push(line.slice(2).trim());
    } else if (current && line && current.items.length > 0 && !line.startsWith('#')) {
      // A wrapped bullet continues on the next line.
      current.items[current.items.length - 1] += ` ${line}`;
    }
  }
  return entries;
}

/** Negative when a < b, by numeric major.minor.patch (suffixes ignored). */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/** Entries newer than `lastSeen`, up to and including `current`, newest first. */
export function entriesSince(entries: ChangelogEntry[], lastSeen: string, current: string): ChangelogEntry[] {
  return entries
    .filter((e) => compareVersions(e.version, current) <= 0 && (!lastSeen || compareVersions(e.version, lastSeen) > 0))
    .sort((a, b) => compareVersions(b.version, a.version));
}
