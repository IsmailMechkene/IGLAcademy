// Reliable end-to-end runner: kills stray Electron processes, then runs the
// playback + exam UI verifiers sequentially. Exits non-zero on any failure.
// Usage: npm run test:e2e  (requires `npm run build` first)
import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function killStrays() {
  try {
    if (process.platform === 'win32') {
      execSync('taskkill /F /IM electron.exe /T', { stdio: 'ignore' });
    } else {
      execSync('pkill -f electron', { stdio: 'ignore' });
    }
  } catch {
    // nothing running
  }
}

function runScript(name) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts', name)], {
      cwd: root,
      stdio: 'inherit',
    });
    child.on('exit', (code) => resolve(code ?? 1));
    child.on('error', () => resolve(1));
  });
}

const scripts = ['verify-playback.mjs', 'verify-exam-ui.mjs'];
let failed = false;
for (const name of scripts) {
  console.log(`[test:e2e] running ${name}...`);
  // No retries: the scripts wait for real conditions (debugger target, UI
  // text) rather than sleeping, so a failure is a failure, not a flake to
  // re-roll until it passes.
  killStrays();
  await new Promise((r) => setTimeout(r, 2000));
  const code = await runScript(name);
  killStrays();
  if (code !== 0) {
    console.error(`[test:e2e] ${name} FAILED (exit ${code})`);
    failed = true;
  } else {
    console.log(`[test:e2e] ${name} passed`);
  }
}
process.exit(failed ? 1 : 0);
