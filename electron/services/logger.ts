import fs from 'node:fs';
import path from 'node:path';

// File logging for the main process (plus captured renderer console errors).
// Single log file with size-based rotation; safe to call before init (no-op).
//
// Writes are buffered and appended asynchronously: the main process also
// streams video and answers every IPC call, so a burst of log lines must not
// turn into a burst of synchronous disk I/O on that thread. The file size is
// tracked in memory instead of stat()ing the file on every line.

const MAX_BYTES = 2 * 1024 * 1024;
const KEEP_ROTATED = 4;
const FLUSH_DELAY_MS = 250;

let logFile: string | null = null;
let currentSize = 0;
let buffer: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let writing = false;

export function logDirectory(userDataDir: string): string {
  const dir = path.join(userDataDir, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function initLogger(userDataDir: string): void {
  logFile = path.join(logDirectory(userDataDir), 'app.log');
  try {
    currentSize = fs.statSync(logFile).size;
  } catch {
    currentSize = 0;
  }
  rotateIfNeeded();
  // Whatever is still buffered when the process ends goes out synchronously.
  process.once('exit', flushLogSync);
}

function rotateIfNeeded(): void {
  if (!logFile || currentSize < MAX_BYTES) return;
  try {
    for (let i = KEEP_ROTATED - 1; i >= 1; i--) {
      const older = `${logFile}.${i}`;
      const newer = `${logFile}.${i + 1}`;
      if (fs.existsSync(older)) fs.renameSync(older, newer);
    }
    fs.renameSync(logFile, `${logFile}.1`);
    currentSize = 0;
  } catch {
    // logging must never crash the app
  }
}

function takeBuffer(): string {
  const chunk = buffer.join('');
  buffer = [];
  return chunk;
}

function scheduleFlush(): void {
  if (flushTimer || writing) return;
  flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
  // Never keep the process alive just to write a log line.
  flushTimer.unref?.();
}

function flush(): void {
  flushTimer = null;
  if (!logFile || writing || buffer.length === 0) return;
  rotateIfNeeded();
  const chunk = takeBuffer();
  writing = true;
  fs.appendFile(logFile, chunk, () => {
    writing = false;
    if (buffer.length > 0) scheduleFlush();
  });
  currentSize += Buffer.byteLength(chunk);
}

/** Writes anything still buffered, synchronously. For exit and crash paths. */
export function flushLogSync(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!logFile || buffer.length === 0) return;
  rotateIfNeeded();
  const chunk = takeBuffer();
  try {
    fs.appendFileSync(logFile, chunk);
    currentSize += Buffer.byteLength(chunk);
  } catch {
    // ignore
  }
}

export type LogLevel = 'info' | 'warn' | 'error';

export function log(level: LogLevel, message: string, detail?: string): void {
  if (!logFile) return;
  buffer.push(`${new Date().toISOString()} [${level}] ${message}${detail ? ` :: ${detail.slice(0, 2000)}` : ''}\n`);
  scheduleFlush();
}

export function installCrashHandlers(): void {
  process.on('uncaughtException', (err) => {
    log('error', 'uncaughtException', err instanceof Error ? err.stack ?? err.message : String(err));
    flushLogSync();
  });
  process.on('unhandledRejection', (reason) => {
    log('error', 'unhandledRejection', reason instanceof Error ? reason.stack ?? reason.message : String(reason));
    flushLogSync();
  });
}
