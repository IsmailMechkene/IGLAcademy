// Applies the IsmaLearn icon and version metadata to the packaged Windows
// executable using rcedit (normally done by electron-builder, which cannot run
// here because the winCodeSign tools need symlink privileges to extract).
//
// Usage: node scripts/brand-exe.mjs [path-to-exe]
// Defaults to release/win-unpacked/IsmaLearn.exe
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const exePath =
  process.argv[2] ?? path.join(root, 'release', 'win-unpacked', 'IsmaLearn.exe');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

if (!fs.existsSync(exePath)) {
  console.error(`[brand-exe] not found: ${exePath}`);
  console.error('[brand-exe] run `npm run dist` first (it produces release/win-unpacked).');
  process.exit(1);
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ismalearn-rcedit-'));
const sevenZip = path.join(
  root, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe',
);

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed (${res.status}): ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

let rcedit;
const cached = path.join(workDir, 'rcedit-x64.exe');
if (process.env.RCEDIT_PATH && fs.existsSync(process.env.RCEDIT_PATH)) {
  rcedit = process.env.RCEDIT_PATH;
  console.log(`[brand-exe] using provided rcedit: ${rcedit}`);
} else {
  // Extract only rcedit from the winCodeSign bundle (single-file extraction
  // avoids the macOS symlinks that break full extraction without privileges).
  const url =
    'https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z';
  const archive = path.join(workDir, 'winCodeSign.7z');
  console.log(`[brand-exe] downloading ${url}`);
  await download(url, archive);
  execFileSync(sevenZip, ['e', archive, '-o' + workDir, 'rcedit-x64.exe', '-y'], {
    stdio: 'inherit',
  });
  rcedit = cached;
}

console.log(`[brand-exe] branding ${exePath}`);
execFileSync(
  rcedit,
  [
    exePath,
    '--set-icon', path.join(root, 'build', 'icon.ico'),
    '--set-file-version', pkg.version,
    '--set-product-version', pkg.version,
    '--set-version-string', 'CompanyName', 'IsmaLearn',
    '--set-version-string', 'FileDescription', 'IsmaLearn — Your courses. Your pace. Your progress.',
    '--set-version-string', 'ProductName', 'IsmaLearn',
  ],
  { stdio: 'inherit' },
);
console.log('[brand-exe] done');
