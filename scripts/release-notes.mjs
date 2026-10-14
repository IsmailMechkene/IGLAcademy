// Prints one version's section of CHANGELOG.md as GitHub release notes.
//
//   node scripts/release-notes.mjs 1.0.2 > notes.md
//
// Exits 1 when the version has no entry, so a release can't ship without notes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = (process.argv[2] ?? '').replace(/^v/, '');
if (!version) {
  console.error('usage: release-notes.mjs <version>');
  process.exit(1);
}

const lines = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').split(/\r?\n/);
const start = lines.findIndex((l) => new RegExp(`^##\\s+v?${version.replace(/\./g, '\\.')}(\\s|$)`).test(l.trim()));
if (start < 0) {
  console.error(`CHANGELOG.md has no "## ${version}" section. Add the release notes, then tag again.`);
  process.exit(1);
}
let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l.trim()));
if (end < 0) end = lines.length;
const body = lines.slice(start + 1, end).join('\n').trim();
if (!body) {
  console.error(`The "## ${version}" section of CHANGELOG.md is empty.`);
  process.exit(1);
}

process.stdout.write(
  `## What's new in IGLAcademy ${version}\n\n${body}\n\n` +
    `### Install\n\nDownload **IGLAcademy-Setup-${version}.exe** below and run it. ` +
    'Already installed? The app updates itself.\n\n' +
    'Windows may say "Windows protected your PC": choose **More info → Run anyway** (the installer is not code-signed yet).\n',
);
