// Applies the IGLAcademy icon and version metadata to the packaged Windows
// executable using rcedit (normally done by electron-builder, which cannot run
// here because the winCodeSign tools need symlink privileges to extract).
//
// Usage: node scripts/brand-exe.mjs [path-to-exe]
// Defaults to release/win-unpacked/IGLAcademy.exe
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const exePath =
  process.argv[2] ?? path.join(root, 'release', 'win-unpacked', 'IGLAcademy.exe');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

if (!fs.existsSync(exePath)) {
  console.error(`[brand-exe] not found: ${exePath}`);
  console.error('[brand-exe] run `npm run dist` first (it produces release/win-unpacked).');
  process.exit(1);
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ismalearn-rcedit-'));
const builderCache = path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), 'electron-builder', 'Cache');

/** Files named `name` one level below `dir` (electron-builder's cache layout). */
function inSubdirs(dir, ...name) {
  try {
    return fs.readdirSync(dir).map((d) => path.join(dir, d, ...name)).filter((p) => fs.existsSync(p));
  } catch {
    return [];
  }
}

// electron-builder 26 dropped the 7zip-bin package; it downloads 7-Zip into
// its cache instead. Check the old location, that cache, then electron-winstaller's copy.
const sevenZip = [
  path.join(root, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe'),
  ...inSubdirs(path.join(builderCache, '7zip@1.0.0'), 'bin', '7za.exe'),
  path.join(root, 'node_modules', 'electron-winstaller', 'vendor', '7z.exe'),
].find((p) => fs.existsSync(p));

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed (${res.status}): ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

let rcedit;
const cached = path.join(workDir, 'rcedit-x64.exe');
// A previous electron-builder run may already have unpacked winCodeSign.
const fromBuilderCache = inSubdirs(path.join(builderCache, 'winCodeSign'), 'rcedit-x64.exe')[0];
if (process.env.RCEDIT_PATH && fs.existsSync(process.env.RCEDIT_PATH)) {
  rcedit = process.env.RCEDIT_PATH;
  console.log(`[brand-exe] using provided rcedit: ${rcedit}`);
} else if (fromBuilderCache) {
  rcedit = fromBuilderCache;
  console.log(`[brand-exe] using cached rcedit: ${rcedit}`);
} else {
  if (!sevenZip) throw new Error('7-Zip not found; set RCEDIT_PATH to an rcedit-x64.exe instead');
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
    '--set-version-string', 'CompanyName', 'IGLAcademy',
    '--set-version-string', 'FileDescription', 'IGLAcademy — Your courses. Your pace. Your progress.',
    '--set-version-string', 'ProductName', 'IGLAcademy',
  ],
  { stdio: 'inherit' },
);
console.log('[brand-exe] done');
