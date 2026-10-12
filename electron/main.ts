import { app, BrowserWindow, dialog, shell, protocol } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type Database from 'better-sqlite3';
import { getDb, quarantineDatabase } from './database/connection';
import { resolveLessonFile, resolveThumbnailFile, resolveResourceFile, serveMediaFile } from './services/fileService';
import { registerCourseIpc } from './ipc/courses';
import { registerProgressIpc } from './ipc/progress';
import { registerNotesIpc } from './ipc/notes';
import { registerQuizIpc } from './ipc/quizzes';
import { registerSettingsIpc } from './ipc/settings';
import { registerMediaIpc } from './ipc/media';
import { registerResourceIpc } from './ipc/resources';
import { registerStudyIpc } from './ipc/study';
import { registerBackupIpc } from './ipc/backup';
import { registerPracticeIpc } from './ipc/practice';
import { registerAppIpc } from './ipc/app';
import { registerSearchIpc } from './ipc/search';
import { initLogger, installCrashHandlers, log, flushLogSync } from './services/logger';
import { initThumbnailCache } from './services/thumbnailService';
import { createAutoBackup } from './services/backupService';
import { getAllSettings } from './database/repositories/settings';

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

// Custom schemes must be registered as privileged BEFORE the app is ready.
// Without standard+secure privileges, Chromium silently refuses to load
// media:// URLs in <video>/<img> tags (black player, no error surfaced).
//
// Deliberately NO `supportFetchAPI`: nothing in the app fetch()es media://
// (text previews go through `resources:readText`, subtitles through
// `media:subtitleText`), and a fetch-enabled scheme without CORS is the
// precondition of GHSA-v3j7-r9gq-3gjw (cross-origin reads of local files).
// Without it, script can't read media:// responses at all — only <video>,
// <img> and <iframe> can load them. (<track> can't either: it loads in CORS
// mode, which is why subtitles arrive as blob: URLs.)
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      standard: true,
      secure: true,
      stream: true,
    },
  },
]);

/**
 * Serves course media (videos, thumbnails) to the renderer through an opaque
 * `media://lesson/<id>` / `media://thumb/<courseId>` scheme. The renderer
 * never sees real filesystem paths, and playback works in both dev and
 * production builds. Range requests (video seeking) are handled by net.fetch.
 */
function registerMediaProtocol(): void {
  protocol.handle('media', async (request) => {
    try {
      const url = new URL(request.url);
      const db = getDb();

      const id = Number(url.pathname.replace(/^\//, ''));
      if (!Number.isInteger(id) || id <= 0) {
        return new Response('Bad request', { status: 400 });
      }
      const filePath =
        url.host === 'lesson'
          ? resolveLessonFile(db, id)
          : url.host === 'thumb'
            ? resolveThumbnailFile(db, id)
            : url.host === 'resource'
              ? resolveResourceFile(db, id)
              : null;
      if (!filePath) return new Response('Not found', { status: 404 });
      return serveMediaFile(filePath, request.headers.get('range'));
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: 'IsmaLearn',
    icon: path.join(__dirname, '../assets/icon.png'),
    backgroundColor: '#0f1117',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  // Start maximized so the app fills the screen by default.
  win.maximize();

  // Open external links in the system browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // The window only ever shows the app bundle. Anything that would navigate
  // it elsewhere (a dropped file, a link that slipped past the handler above)
  // is refused rather than loaded with the preload bridge attached.
  const appEntry = isDev
    ? new URL(process.env.VITE_DEV_SERVER_URL!).origin
    : pathToFileURL(path.join(__dirname, '../dist/index.html')).href;
  win.webContents.on('will-navigate', (event) => {
    const target = event.url;
    const allowed = isDev ? new URL(target).origin === appEntry : target.split(/[?#]/)[0] === appEntry;
    if (!allowed) {
      event.preventDefault();
      log('warn', 'blocked navigation away from the app', target.slice(0, 300));
    }
  });

  // Capture renderer console errors/warnings into the log file.
  // Only warnings and errors: info/debug chatter would just churn the log.
  win.webContents.on('console-message', ({ level, message, lineNumber, sourceId }) => {
    if (level !== 'warning' && level !== 'error') return;
    log(level === 'error' ? 'error' : 'warn', `renderer console: ${message.slice(0, 500)}`, `${sourceId}:${lineNumber}`);
  });

  if (isDev) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL!);
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

/**
 * Opens the database, and if that is impossible (corrupt file, half-applied
 * migration) quarantines it and starts on a fresh one rather than dying on
 * every launch. The broken file is renamed, never deleted.
 */
function openDatabaseOrRecover(): Database.Database | null {
  try {
    return getDb();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log('error', 'database could not be opened', message);
    const choice = dialog.showMessageBoxSync({
      type: 'error',
      buttons: ['Start with a new database', 'Quit'],
      defaultId: 0,
      cancelId: 1,
      title: 'IsmaLearn cannot open its database',
      message: 'Your learning database could not be opened.',
      detail:
        `${message}\n\nIsmaLearn can set the file aside (nothing is deleted) and start with a new, ` +
        'empty database. Your existing file stays in the IsmaLearn folder, and backups are kept in ' +
        'its "backups" subfolder — both can be restored from Settings → Export / import data.',
    });
    if (choice !== 0) return null;

    const moved = quarantineDatabase();
    log('warn', `quarantined unreadable database${moved ? ` to ${path.basename(moved)}` : ' (rename failed)'}`);
    try {
      return getDb();
    } catch (err2) {
      log('error', 'database still unusable after quarantine', err2 instanceof Error ? err2.message : String(err2));
      dialog.showErrorBox(
        'IsmaLearn cannot start',
        'A new database could not be created either. Check that the IsmaLearn folder is writable, then try again.',
      );
      return null;
    }
  }
}

app.whenReady().then(() => {
  const userData = app.getPath('userData');
  initLogger(userData);
  initThumbnailCache(userData);
  installCrashHandlers();
  log('info', `IsmaLearn starting (v${app.getVersion()})`);

  // Packaging smoke test: verify boot + database, then exit without UI.
  if (process.argv.includes('--smoke-test')) {
    try {
      const smokeDb = getDb();
      const settings = getAllSettings(smokeDb);
      log('info', 'smoke test ok');
      console.log(JSON.stringify({ ok: true, version: app.getVersion(), theme: settings.theme }));
      flushLogSync();
      app.exit(0);
    } catch (err) {
      log('error', 'smoke test failed', err instanceof Error ? err.message : String(err));
      flushLogSync();
      app.exit(1);
    }
    return;
  }

  // Initialize database (runs migrations) before any IPC handler fires
  const db = openDatabaseOrRecover();
  if (!db) {
    flushLogSync();
    app.exit(1);
    return;
  }
  registerMediaProtocol();

  // Automatic safety backup (before anything else touches the database)
  try {
    const settings = getAllSettings(db);
    if (settings.autoBackup !== false) {
      const dest = createAutoBackup(db, userData, settings.backupKeep);
      if (dest) log('info', `automatic backup: ${dest}`);
    }
  } catch (err) {
    log('error', 'automatic backup failed', err instanceof Error ? err.message : String(err));
  }

  registerCourseIpc();
  registerProgressIpc();
  registerNotesIpc();
  registerQuizIpc();
  registerSettingsIpc();
  registerMediaIpc();
  registerResourceIpc();
  registerStudyIpc();
  registerBackupIpc();
  registerPracticeIpc();
  registerAppIpc();
  registerSearchIpc();

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
