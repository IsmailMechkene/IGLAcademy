// Ensures the better-sqlite3 native module matches the needed ABI,
// rebuilding only when stale (tracked via a stamp file).
//
//   node scripts/ensure-abi.mjs node       # for Vitest / plain Node
//   node scripts/ensure-abi.mjs electron   # for Electron dev/build/package
//
// `npm test`, `npm run dev` and `npm run build` call this automatically,
// so a fresh clone or a switched binary heals itself.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const binding = path.join(root, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
const stampFile = path.join(root, 'node_modules', '.better-sqlite3-abi');

const target = process.argv[2] || 'node';

function signature() {
  try {
    const st = fs.statSync(binding);
    return `${st.size}:${st.mtimeMs}`;
  } catch {
    return null;
  }
}

function readStamp() {
  try {
    const raw = fs.readFileSync(stampFile, 'utf8').trim();
    const sep = raw.indexOf(':');
    if (sep < 0) return null;
    return { abi: raw.slice(0, sep), sig: raw.slice(sep + 1) };
  } catch {
    return null;
  }
}

function writeStamp(abi) {
  fs.writeFileSync(stampFile, `${abi}:${signature() ?? ''}`);
}

if (target === 'node') {
  // Authoritative check: actually open a database (require() alone only
  // loads the JS wrapper — dlopen happens in the constructor).
  try {
    const Database = createRequire(path.join(root, 'package.json'))('better-sqlite3');
    new Database(':memory:').close();
    writeStamp('node');
    console.log('[ensure-abi] better-sqlite3 loads under Node — no rebuild needed');
  } catch {
    console.log('[ensure-abi] rebuilding better-sqlite3 for Node...');
    execSync('npm rebuild better-sqlite3', { cwd: root, stdio: 'inherit', shell: true });
    writeStamp('node');
  }
} else if (target === 'electron') {
  const stamp = readStamp();
  const sig = signature();
  if (stamp?.abi === 'electron' && sig !== null && stamp.sig === sig) {
    console.log('[ensure-abi] better-sqlite3 already built for Electron — skipping rebuild');
  } else {
    console.log('[ensure-abi] rebuilding better-sqlite3 for Electron...');
    execSync('npx electron-rebuild -f -w better-sqlite3', { cwd: root, stdio: 'inherit', shell: true });
    writeStamp('electron');
  }
} else {
  console.error('usage: ensure-abi.mjs [node|electron]');
  process.exit(1);
}
