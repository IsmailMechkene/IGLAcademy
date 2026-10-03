// End-to-end playback verification (run after `npm run build`).
// Launches the production app with a fresh profile, imports a temp course
// containing a real MP4, and checks inside the renderer that a <video> tag
// reaches loadedmetadata + completes a seek through the media:// protocol.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const DEBUG_PORT = 9333;

const SAMPLE_URLS = [
  'https://www.w3schools.com/html/mov_bbb.mp4',
  'https://filesamples.com/samples/video/mp4/sample_640x360.mp4',
  'https://download.samplelib.com/mp4/sample-5s.mp4',
];

async function downloadSample(dest) {
  for (const url of SAMPLE_URLS) {
    try {
      console.log(`[verify] downloading ${url}`);
      const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 10_000) throw new Error(`suspiciously small (${buf.length} bytes)`);
      fs.writeFileSync(dest, buf);
      console.log(`[verify] got ${(buf.length / 1024).toFixed(0)} KB`);
      return;
    } catch (err) {
      console.log(`[verify] failed: ${err.message}`);
    }
  }
  throw new Error('could not download any sample video');
}

async function waitForDebugger() {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      if (res.ok) {
        const targets = await res.json();
        const page = targets.find((t) => t.type === 'page');
        if (page) return page;
      }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('debugger port never came up');
}

function cdpEvaluate(wsUrl, expression, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      try { ws.close(); } catch { /* noop */ }
      reject(new Error('CDP evaluate timed out'));
    }, timeoutMs);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }));
    });
    ws.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
      } catch {
        return;
      }
      if (msg.id !== 1) return;
      clearTimeout(timer);
      try { ws.close(); } catch { /* noop */ }
      if (msg.error) reject(new Error(`CDP error: ${JSON.stringify(msg.error)}`));
      else if (msg.result?.exceptionDetails) {
        reject(new Error(`page exception: ${JSON.stringify(msg.result.exceptionDetails).slice(0, 500)}`));
      } else resolve(msg.result?.result?.value);
    });
    ws.addEventListener('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`websocket error: ${e.message ?? e.type}`));
    });
  });
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ismalearn-verify-'));
const courseDir = path.join(workDir, 'course', '01 - Basics');
const userDataDir = path.join(workDir, 'profile');
fs.mkdirSync(courseDir, { recursive: true });
fs.mkdirSync(userDataDir, { recursive: true });

let child = null;
try {
  await downloadSample(path.join(courseDir, '01 - Sample Lesson.mp4'));

  const electronBin = process.platform === 'win32'
    ? path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
    : path.join(root, 'node_modules', '.bin', 'electron');

  console.log('[verify] launching app...');
  child = spawn(
    electronBin,
    [`--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${userDataDir}`, '.'],
    { cwd: root, stdio: 'ignore', windowsHide: false },
  );

  const page = await waitForDebugger();
  console.log(`[verify] attached to "${page.title}"`);

  const courseDirJson = JSON.stringify(courseDir);
  const expression = `(async function() {
    try {
      var api = null;
      for (var i = 0; i < 150 && !api; i++) {
        api = window.ismaLearn;
        if (!api) await new Promise(function(r) { setTimeout(r, 100); });
      }
      if (!api) return { ok: false, stage: 'no-preload-api' };
      var imp = await api.courses.importPath(${courseDirJson});
      if (!imp || imp.status !== 'imported') return { ok: false, stage: 'import', detail: imp };
      var detail = await api.courses.get(imp.courseId);
      var lesson = detail.sections[0].lessons[0];
      var url = await api.media.getUrl(lesson.id);
      var v = document.createElement('video');
      v.muted = true;
      v.preload = 'auto';
      document.body.appendChild(v);
      var out = await new Promise(function(resolve) {
        var done = false;
        var timer = setTimeout(function() {
          if (done) return; done = true;
          resolve({ ok: false, stage: 'timeout', readyState: v.readyState,
            networkState: v.networkState,
            err: v.error ? { code: v.error.code, message: v.error.message } : null });
        }, 25000);
        v.addEventListener('loadedmetadata', function() {
          try {
            v.currentTime = Math.min(2, (v.duration || 4) / 2);
          } catch (e) {
            if (done) return; done = true; clearTimeout(timer);
            resolve({ ok: false, stage: 'seek-threw', duration: v.duration });
          }
        });
        v.addEventListener('seeked', function() {
          if (done) return; done = true; clearTimeout(timer);
          setTimeout(function() {
            var ranges = [];
            try {
              for (var i = 0; i < v.seekable.length; i++) {
                ranges.push([v.seekable.start(i), v.seekable.end(i)]);
              }
            } catch (e) { /* noop */ }
            resolve({ ok: true, duration: v.duration, readyState: v.readyState,
              currentTime: v.currentTime, videoWidth: v.videoWidth, videoHeight: v.videoHeight,
              seekable: ranges });
          }, 500);
        });
        v.addEventListener('error', function() {
          if (done) return; done = true; clearTimeout(timer);
          resolve({ ok: false, stage: 'video-error',
            err: v.error ? { code: v.error.code, message: v.error.message } : null,
            src: v.currentSrc });
        });
        v.src = url;
      });
      v.remove();
      return out;
    } catch (e) {
      return { ok: false, stage: 'exception', message: String((e && e.message) || e) };
    }
  })()`;

  const result = await cdpEvaluate(page.webSocketDebuggerUrl, expression);
  console.log('[verify] result:', JSON.stringify(result));

  if (result?.ok) {
    console.log('[verify] PASS: video metadata + seek work through media://');
  } else {
    console.error('[verify] FAIL');
    process.exitCode = 1;
  }
} catch (err) {
  console.error(`[verify] ERROR: ${err.message}`);
  process.exitCode = 1;
} finally {
  if (child && !child.killed) {
    child.kill('SIGKILL');
  }
  // belt and braces: make sure no electron lingers
  try {
    const { execSync } = await import('node:child_process');
    if (process.platform === 'win32') {
      execSync('taskkill /F /IM electron.exe /T', { stdio: 'ignore' });
    }
  } catch {
    // nothing running — fine
  }
  fs.rmSync(workDir, { recursive: true, force: true });
}
