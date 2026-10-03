import { app, BrowserWindow, shell, protocol } from 'electron';
import path from 'node:path';
import { getDb } from './database/connection';
import { resolveLessonFile, resolveThumbnailFile, serveMediaFile } from './services/fileService';
import { registerCourseIpc } from './ipc/courses';
import { registerProgressIpc } from './ipc/progress';
import { registerNotesIpc } from './ipc/notes';
import { registerQuizIpc } from './ipc/quizzes';
import { registerSettingsIpc } from './ipc/settings';
import { registerMediaIpc } from './ipc/media';
import { registerPracticeIpc } from './ipc/practice';
import { registerAppIpc } from './ipc/app';

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
      const filePath =
        url.host === 'lesson'
          ? resolveLessonFile(db, id)
          : url.host === 'thumb'
            ? resolveThumbnailFile(db, id)
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

  if (isDev) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL!);
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  // Initialize database (runs migrations) before any IPC handler fires
  getDb();
  registerMediaProtocol();

  registerCourseIpc();
  registerProgressIpc();
  registerNotesIpc();
  registerQuizIpc();
  registerSettingsIpc();
  registerMediaIpc();
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
