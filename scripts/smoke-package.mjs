// Packaging smoke test: verifies the installer artifacts exist and the
// packaged executable boots (main process + database) via --smoke-test.
// Usage: npm run dist && npm run smoke
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function fail(message) {
  console.error(`[smoke] FAIL: ${message}`);
  process.exit(1);
}

const unpackedExe = path.join(root, 'release', 'win-unpacked', 'IGLAcademy.exe');
const installers = fs.existsSync(path.join(root, 'release'))
  ? fs.readdirSync(path.join(root, 'release')).filter((f) => f.endsWith('.exe') && f !== 'IGLAcademy.exe')
  : [];

if (!fs.existsSync(unpackedExe)) fail('release/win-unpacked/IGLAcademy.exe is missing (run npm run dist first)');
console.log('[smoke] unpacked exe exists');
if (installers.length === 0) fail('no NSIS installer found in release/');
console.log(`[smoke] installer exists: ${installers[0]}`);

// Auto-update wiring: the installed app reads app-update.yml to find its feed,
// and the release needs latest.yml next to the installer.
const updateConfig = path.join(root, 'release', 'win-unpacked', 'resources', 'app-update.yml');
if (!fs.existsSync(updateConfig)) fail('resources/app-update.yml is missing (no publish config?)');
const feed = fs.readFileSync(updateConfig, 'utf8');
if (!/provider: github/.test(feed) || !/repo: IGLAcademy/.test(feed)) fail(`unexpected app-update.yml:
${feed}`);
const latestYml = path.join(root, 'release', 'latest.yml');
if (!fs.existsSync(latestYml)) fail('release/latest.yml is missing');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const latest = fs.readFileSync(latestYml, 'utf8');
if (!latest.includes(`version: ${version}`) || !latest.includes(`IGLAcademy-Setup-${version}.exe`)) {
  fail(`latest.yml does not describe IGLAcademy-Setup-${version}.exe:
${latest}`);
}
if (!fs.existsSync(path.join(root, 'release', `IGLAcademy-Setup-${version}.exe`))) fail(`IGLAcademy-Setup-${version}.exe is missing`);
console.log('[smoke] update feed config and latest.yml are in place');

// A throwaway profile: booting the packaged app against the real userData
// would run any new migrations on the developer's own database.
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ismalearn-smoke-'));

await new Promise((resolve, reject) => {
  const child = spawn(unpackedExe, ['--smoke-test', `--user-data-dir=${profileDir}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d.toString(); });
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  const timer = setTimeout(() => {
    child.kill('SIGKILL');
    reject(new Error('smoke test timed out after 60s'));
  }, 60000);
  child.on('error', (err) => {
    clearTimeout(timer);
    reject(err);
  });
  child.on('exit', (code) => {
    clearTimeout(timer);
    if (code === 0) resolve();
    else reject(new Error(`smoke test exited with code ${code}. stderr: ${stderr.slice(-500)}`));
  });
  void stdout;
}).finally(() => fs.rmSync(profileDir, { recursive: true, force: true }));

console.log('[smoke] PASS: packaged app boots (main process + database OK)');
