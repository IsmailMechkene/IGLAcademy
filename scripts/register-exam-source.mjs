// Registers practice-exam folders into the app's database so they appear in
// the Practice Exams section (parsed live from disk — nothing is imported).
//
// Usage (app must be closed — Windows locks SQLite/WAL files while running):
//   node scripts/register-exam-source.mjs --db "<path-to-ismalearn.db>" --dir "<exams-folder>" [--dir ...]
import esbuild from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const args = process.argv.slice(2);
const dbPath = argValue('--db');
const dirs = argValues('--dir');
if (!dbPath || dirs.length === 0) {
  console.error('usage: register-exam-source.mjs --db <ismalearn.db> --dir <folder> [--dir ...]');
  process.exit(1);
}
function argValue(flag) {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
}
function argValues(flag) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length) out.push(args[i + 1]);
  }
  return out;
}

// Bundle the real app modules (repositories + services) to run them under Node.
const entry = `
import { createDatabase } from ${JSON.stringify(path.join(root, 'electron/database/connection.ts'))};
import { registerSource, scanLibrary } from ${JSON.stringify(path.join(root, 'electron/services/practiceLibraryService.ts'))};
import { listSources } from ${JSON.stringify(path.join(root, 'electron/database/repositories/practice.ts'))};
const [dbPath, ...dirs] = JSON.parse(process.env.SEED_ARGS || '[]');
const db = createDatabase(dbPath);
try {
  for (const dir of dirs) {
    const source = registerSource(db, dir, 'dir');
    console.log('registered source #' + source.id + ': ' + source.path);
  }
  const files = scanLibrary(db);
  const groups = new Map();
  for (const f of files) {
    const key = f.error ? 'unreadable' : f.title.split(' - ')[0];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  console.log('sources:', listSources(db).length);
  console.log('files found:', files.length);
  for (const [key, list] of groups) {
    const qs = list.reduce((s, f) => s + f.questionCount, 0);
    console.log('  [' + key + '] ' + list.length + ' files, ' + qs + ' questions');
  }
} finally {
  db.close();
}
`;
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ismalearn-seed-'));
const entryFile = path.join(workDir, 'entry.js');
// Bundle must live inside the project so bare imports (better-sqlite3,
// electron) resolve via the project's node_modules.
const outFile = path.join(root, 'scripts', '.seed-bundle.cjs');
fs.writeFileSync(entryFile, entry);
esbuild.buildSync({
  entryPoints: [entryFile],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: outFile,
  external: ['electron', 'better-sqlite3'],
  logLevel: 'error',
});

process.env.SEED_ARGS = JSON.stringify([dbPath, ...dirs]);
try {
  await import(pathToFileURL(outFile).href);
} finally {
  // Always clean up: a failed run used to leave the bundle behind, and it
  // ended up committed. It is also gitignored now.
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.rmSync(outFile, { force: true });
}
console.log('done');
