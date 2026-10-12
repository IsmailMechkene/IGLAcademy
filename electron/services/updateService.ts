import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { autoUpdater } from 'electron-updater';
import type { UpdateStatus } from '../../src/types';
import { getDb } from '../database/connection';
import { getAllSettings } from '../database/repositories/settings';
import { flushLogSync, log } from './logger';
import { describeUpdateError } from './updateErrors';

/**
 * In-app updates from GitHub Releases (the `publish` block in
 * electron-builder.yml). An installed build checks shortly after launch and
 * every few hours, downloads a newer version in the background, and installs
 * it on "Restart to update" — or the next time the app is closed.
 *
 * Development builds have no update feed and report `unsupported`, except
 * when ISMALEARN_UPDATE_FEED points at a test server (the e2e suite does).
 * That override is ignored in installed builds.
 */

const FIRST_CHECK_DELAY_MS = 15_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

let status: UpdateStatus = { state: 'unsupported' };
let checking: Promise<void> | null = null;

function setStatus(next: UpdateStatus): void {
  status = next;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('updates:status', status);
  }
}

export function getUpdateStatus(): UpdateStatus {
  return status;
}

/** Points the updater at a test feed. Development builds only. */
function useTestFeed(feed: string): void {
  const config = path.join(app.getPath('userData'), 'test-app-update.yml');
  fs.writeFileSync(
    config,
    `provider: generic\nurl: ${JSON.stringify(feed)}\nupdaterCacheDirName: ismalearn-test-updater\n`,
  );
  autoUpdater.updateConfigPath = config;
  autoUpdater.forceDevUpdateConfig = true;
}

function autoUpdateEnabled(): boolean {
  try {
    return getAllSettings(getDb()).autoUpdate;
  } catch {
    return false;
  }
}

/** Starts a check unless one is running or an update is already on its way. */
export async function checkForUpdates(): Promise<UpdateStatus> {
  if (status.state === 'unsupported' || status.state === 'downloading' || status.state === 'ready') return status;
  if (!checking) {
    checking = autoUpdater
      .checkForUpdates()
      .then(() => undefined)
      .catch(() => undefined) // reported through the 'error' event
      .finally(() => {
        checking = null;
      });
  }
  await checking;
  return status;
}

/** Quits, installs the downloaded update silently, and relaunches. */
export function installUpdate(): void {
  if (status.state !== 'ready') return;
  log('info', `installing update ${status.version}`);
  flushLogSync();
  autoUpdater.quitAndInstall(true, true);
}

export function initUpdates(): void {
  const feed = app.isPackaged ? undefined : process.env.ISMALEARN_UPDATE_FEED;
  if (!app.isPackaged && !feed) return; // stays 'unsupported'
  if (feed) useTestFeed(feed);

  autoUpdater.logger = {
    info: (m: unknown) => log('info', `updater: ${String(m)}`),
    warn: (m: unknown) => log('warn', `updater: ${String(m)}`),
    error: (m: unknown) => log('error', `updater: ${String(m)}`),
    debug: () => undefined,
  };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => setStatus({ state: 'checking' }));
  autoUpdater.on('update-not-available', () => setStatus({ state: 'up-to-date', checkedAt: Date.now() }));
  autoUpdater.on('update-available', (info) => setStatus({ state: 'downloading', version: info.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => {
    if (status.state === 'downloading') setStatus({ ...status, percent: Math.floor(p.percent) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    log('info', `update ${info.version} downloaded`);
    setStatus({ state: 'ready', version: info.version });
  });
  autoUpdater.on('error', (err) => {
    const code = (err as { code?: string }).code ?? 'no code';
    log('warn', `update check failed (${code})`, String(err?.message ?? err).slice(0, 500));
    setStatus({ state: 'error', message: describeUpdateError(err) });
  });

  status = { state: 'idle' };
  const scheduled = () => {
    if (autoUpdateEnabled()) void checkForUpdates();
  };
  if (feed) return; // tests drive checks themselves
  setTimeout(scheduled, FIRST_CHECK_DELAY_MS);
  setInterval(scheduled, CHECK_EVERY_MS).unref();
}
