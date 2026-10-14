import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareVersions, entriesSince, parseChangelog } from '../src/utils/changelog';

const sample = [
  '# Changelog',
  '',
  'Intro text that is not a release.',
  '',
  '## 1.2.0',
  '',
  '- **New**: first item',
  '  continues here.',
  '- Second item',
  '',
  '## v1.1.0',
  '- Older item',
  '',
  '## 1.0.0',
  '- First release',
].join('\n');

describe('parseChangelog', () => {
  it('reads one entry per version heading, joining wrapped bullets', () => {
    expect(parseChangelog(sample)).toEqual([
      { version: '1.2.0', items: ['**New**: first item continues here.', 'Second item'] },
      { version: '1.1.0', items: ['Older item'] },
      { version: '1.0.0', items: ['First release'] },
    ]);
  });
});

describe('compareVersions', () => {
  it('compares numerically, not as text', () => {
    expect(compareVersions('1.0.10', '1.0.9')).toBeGreaterThan(0);
    expect(compareVersions('1.2.0', '1.10.0')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0);
  });
});

describe('entriesSince', () => {
  const entries = parseChangelog(sample);
  it('returns what is new after the last seen version, newest first', () => {
    expect(entriesSince(entries, '1.0.0', '1.2.0').map((e) => e.version)).toEqual(['1.2.0', '1.1.0']);
  });
  it('never shows notes for versions newer than the running app', () => {
    expect(entriesSince(entries, '1.0.0', '1.1.0').map((e) => e.version)).toEqual(['1.1.0']);
  });
  it('shows nothing when already up to date', () => {
    expect(entriesSince(entries, '1.2.0', '1.2.0')).toEqual([]);
  });
});

describe('CHANGELOG.md', () => {
  const root = path.join(__dirname, '..');
  const entries = parseChangelog(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'));
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };

  it('has notes for the current package.json version', () => {
    const entry = entries.find((e) => e.version === version);
    expect(entry, `add a "## ${version}" section to CHANGELOG.md`).toBeDefined();
    expect(entry!.items.length).toBeGreaterThan(0);
  });

  it('lists versions newest first, each with notes', () => {
    const versions = entries.map((e) => e.version);
    expect([...versions].sort((a, b) => compareVersions(b, a))).toEqual(versions);
    for (const e of entries) expect(e.items.length, e.version).toBeGreaterThan(0);
  });
});
