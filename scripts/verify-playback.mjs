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
const DEBUG_PORT = await pickPort(9333);

async function pickPort(from) {
  // Orphaned runs can linger on the default port; never attach to a stale instance.
  for (let port = from; port < from + 20; port++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) continue; // taken
    } catch {
      return port; // connection refused: free
    }
  }
  throw new Error('no free debug port');
}

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
    const networkResponses = [];
    const timer = setTimeout(() => {
      try { ws.close(); } catch { /* noop */ }
      reject(new Error('CDP evaluate timed out'));
    }, timeoutMs);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id: 2, method: 'Network.enable', params: {} }));
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
      if (msg.method === 'Network.responseReceived' && msg.params?.response) {
        networkResponses.push({
          url: msg.params.response.url,
          status: msg.params.response.status,
          mimeType: msg.params.response.mimeType,
        });
        return;
      }
      if (msg.id !== 1) return;
      clearTimeout(timer);
      try { ws.close(); } catch { /* noop */ }
      if (msg.error) reject(new Error(`CDP error: ${JSON.stringify(msg.error)}`));
      else if (msg.result?.exceptionDetails) {
        reject(new Error(`page exception: ${JSON.stringify(msg.result.exceptionDetails).slice(0, 500)}`));
      } else resolve({ value: msg.result?.result?.value, network: networkResponses });
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
  fs.writeFileSync(
    path.join(courseDir, '02 - Practice Test #1.html'),
    '<!doctype html><html><body><script>const quizData = ' + JSON.stringify({
      quiz_title: 'Verify Exam',
      questions: [
        {
          assessment_type: 'multiple-choice',
          prompt: {
            question: '<p>What is 2+2?</p>',
            answers: ['<p>3</p>', '<p>4</p>'],
            explanation: '<p>Basic math</p>',
          },
          correct_response: ['b'],
        },
        {
          assessment_type: 'multi-select',
          prompt: {
            question: '<p>Select evens.</p>',
            answers: ['<p>1</p>', '<p>2</p>', '<p>4</p>'],
            explanation: '',
          },
          correct_response: ['b', 'c'],
        },
      ],
    }) + ';</script></body></html>',
  );

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
  const htmlPathJson = JSON.stringify(path.join(courseDir, '02 - Practice Test #1.html'));
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
      if (!out.ok) return out;

      // Practice test: served as text/html and readable in an in-app frame
      var practice = detail.sections.flatMap(function(s) { return s.lessons; })
        .find(function(l) { return l.fileType === 'practice'; });
      if (!practice) return { ok: false, stage: 'no-practice-lesson' };
      var practiceUrl = await api.media.getUrl(practice.id);
      var frameOut = await new Promise(function(resolve) {
        var done = false;
        var timer = setTimeout(function() {
          if (done) return; done = true;
          resolve({ loaded: false, stage: 'practice-timeout' });
        }, 15000);
        var f = document.createElement('iframe');
        // NOTE: cross-origin reads are blocked by design (opaque media://
        // origin), so a fired load event is the success signal here.
        f.addEventListener('load', function() {
          if (done) return; done = true; clearTimeout(timer);
          f.remove();
          resolve({ loaded: true });
        });
        f.addEventListener('error', function() {
          if (done) return; done = true; clearTimeout(timer);
          f.remove();
          resolve({ loaded: false, stage: 'practice-error' });
        });
        f.src = practiceUrl;
        f.style.display = 'none';
        document.body.appendChild(f);
      });
      return { ok: out.ok, video: out, practiceUrl: practiceUrl, frameLoaded: frameOut.loaded,
        examCheck: await (async function() {
          // Register the course folder as an exam source, load the file-direct
          // exam, and answer everything correctly.
          await api.practice.addFolderPath(${courseDirJson});
          var exam = await api.practice.load(${htmlPathJson});
          if (!exam || exam.questions.length !== 2) {
            return { ok: false, stage: 'exam-load', exam: exam };
          }
          if (exam.questions[1].correctIndices.join(',') !== '1,2') {
            return { ok: false, stage: 'exam-multi', q: exam.questions[1] };
          }
          var selections = exam.questions.map(function(q) { return q.correctIndices; });
          var attempt = await api.practice.submit(${htmlPathJson}, selections);
          var history = await api.practice.history(${htmlPathJson});
          return { ok: attempt.percent === 100 && history.length === 1, percent: attempt.percent,
            history: history.length };
        })() };
    } catch (e) {
      return { ok: false, stage: 'exception', message: String((e && e.message) || e) };
    }
  })()`;

  const { value: result, network } = await cdpEvaluate(page.webSocketDebuggerUrl, expression);
  console.log('[verify] result:', JSON.stringify(result));

  // Ground truth for the practice test: a 200 text/html subresource response.
  // (The renderer itself cannot read it back — opaque cross-origin, by design.)
  const practiceHit = (network ?? []).find((r) => r.url === result?.practiceUrl);
  console.log('[verify] practice response:', JSON.stringify(practiceHit ?? null));

  if (result?.ok && result.frameLoaded && practiceHit && practiceHit.status === 200 && practiceHit.mimeType === 'text/html' && result.examCheck?.ok) {
    console.log('[verify] PASS: video + seek work, practice HTML served, file-direct exam submit (100%) + history OK');
    console.log('[verify] exam:', JSON.stringify(result.examCheck));
  } else {
    console.error('[verify] FAIL:', JSON.stringify(result?.examCheck ?? result));
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
