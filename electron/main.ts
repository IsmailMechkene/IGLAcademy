import { app, BrowserWindow, shell, protocol } from 'electron';
import path from 'node:path';
import { getDb } from './database/connection';
import { resolveLessonFile, resolveThumbnailFile, resolveResourceFile, resolveSubtitleFile, serveMediaFile } from './services/fileService';
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
import { initLogger, installCrashHandlers, log } from './services/logger';
import { createAutoBackup } from './services/backupService';
import { getAllSettings } from './database/repositories/settings';

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);

// Custom schemes must be registered as privileged BEFORE the app is ready.
// Without standard+secure privileges, Chromium silently refuses to load
// media:// URLs in <video>/<img> tags (black player, no error surfaced).
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
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
      const id = Number(url.pathname.replace(/^\//, ''));
      if (!Number.isInteger(id) || id <= 0) {
        return new Response('Bad request', { status: 400 });
      }
      const db = getDb();
      if (url.host === 'sub') {
        // media://sub/<lessonId>/<index> — converted to VTT on the fly
        const parts = url.pathname.replace(/^\//, '').split('/');
        const lessonId = Number(parts[0]);
        const index = Number(parts[1]);
        if (!Number.isInteger(lessonId) || lessonId <= 0 || !Number.isInteger(index) || index < 0) {
          return new Response('Bad request', { status: 400 });
        }
        const { content } = resolveSubtitleFile(db, lessonId, index);
        return new Response(content, {
          status: 200,
          headers: { 'Content-Type': 'text/vtt; charset=utf-8' },
        });
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

  // Open external links in the system browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Capture renderer console errors/warnings into the log file.
  win.webContents.on('console-message', (_e, _level, message, line, sourceId) => {
    log('warn', `renderer console: ${message.slice(0, 500)}`, `${sourceId}:${line}`);
  });

  if (isDev) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL!);
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  const userData = app.getPath('userData');
  initLogger(userData);
  installCrashHandlers();
  log('info', `IsmaLearn starting (v${app.getVersion()})`);

  // Packaging smoke test: verify boot + database, then exit without UI.
  if (process.argv.includes('--smoke-test')) {
    try {
      const db = getDb();
      const settings = getAllSettings(db);
      log('info', 'smoke test ok');
      console.log(JSON.stringify({ ok: true, version: app.getVersion(), theme: settings.theme }));
      app.exit(0);
    } catch (err) {
      log('error', 'smoke test failed', err instanceof Error ? err.message : String(err));
      app.exit(1);
    }
    return;
  }

  // Initialize database (runs migrations) before any IPC handler fires
  const db = getDb();
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

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
