import fs from 'node:fs';
import path from 'node:path';

// File logging for the main process (plus captured renderer console errors).
// Single log file with size-based rotation; safe to call before init (no-op).

const MAX_BYTES = 2 * 1024 * 1024;
const KEEP_ROTATED = 4;

let logFile: string | null = null;

export function logDirectory(userDataDir: string): string {
  const dir = path.join(userDataDir, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function initLogger(userDataDir: string): void {
  logFile = path.join(logDirectory(userDataDir), 'app.log');
  rotateIfNeeded();
}

function rotateIfNeeded(): void {
  if (!logFile) return;
  try {
    const stat = fs.statSync(logFile);
    if (stat.size < MAX_BYTES) return;
    for (let i = KEEP_ROTATED - 1; i >= 1; i--) {
      const older = `${logFile}.${i}`;
      const newer = `${logFile}.${i + 1}`;
      if (fs.existsSync(older)) fs.renameSync(older, newer);
    }
    fs.renameSync(logFile, `${logFile}.1`);
  } catch {
    // logging must never crash the app
  }
}

export type LogLevel = 'info' | 'warn' | 'error';

export function log(level: LogLevel, message: string, detail?: string): void {
  if (!logFile) return;
  rotateIfNeeded();
  const line = `${new Date().toISOString()} [${level}] ${message}${detail ? ` :: ${detail.slice(0, 2000)}` : ''}\n`;
  try {
    fs.appendFileSync(logFile, line);
  } catch {
    // ignore
  }
}

export function installCrashHandlers(): void {
  process.on('uncaughtException', (err) => {
    log('error', 'uncaughtException', err instanceof Error ? err.stack ?? err.message : String(err));
  });
  process.on('unhandledRejection', (reason) => {
    log('error', 'unhandledRejection', reason instanceof Error ? reason.stack ?? reason.message : String(reason));
  });
}
