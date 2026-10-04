// Acceptance check against the REAL app profile (read-only navigation):
// Practice Exams page must show the registered data folder grouped by cert.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

async function pickPort(from) {
  for (let port = from; port < from + 20; port++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) continue;
    } catch {
      return port;
    }
  }
  throw new Error('no free debug port');
}

async function waitForDebugger(port) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (res.ok) {
        const targets = await res.json();
        const page = targets.find((t) => t.type === 'page');
        if (page) return page;
      }
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('debugger port never came up');
}

function cdpEvaluate(wsUrl, expression, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      try { ws.close(); } catch { /* noop */ }
      reject(new Error('CDP evaluate timed out'));
    }, timeoutMs);
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        id: 1, method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }));
    });
    ws.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString());
      } catch { return; }
      if (msg.id !== 1) return;
      clearTimeout(timer);
      try { ws.close(); } catch { /* noop */ }
      if (msg.error) reject(new Error(`CDP error: ${JSON.stringify(msg.error)}`));
      else if (msg.result?.exceptionDetails) reject(new Error('page exception'));
      else resolve(msg.result?.result?.value);
    });
    ws.addEventListener('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`websocket error: ${e.message ?? e.type}`));
    });
  });
}

let child = null;
try {
  const port = await pickPort(9354);
  const electronBin = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  // No --user-data-dir: uses the real profile, like a normal launch.
  child = spawn(electronBin, [`--remote-debugging-port=${port}`, '.'], { cwd: root, stdio: 'ignore' });
  const page = await waitForDebugger(port);
  const expression = `(async function() {
    try {
      var api = null;
      for (var i = 0; i < 150 && !api; i++) {
        api = window.ismaLearn;
        if (!api) await new Promise(function(r) { setTimeout(r, 100); });
      }
      if (!api || !api.practice) return { ok: false, stage: 'no-api' };
      function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
      var sources = await api.practice.listSources();
      var files = await api.practice.scan();
      // navigate via sidebar
      var navOk = false;
      for (var w = 0; w < 60 && !navOk; w++) {
        var items = Array.prototype.slice.call(document.querySelectorAll('nav button'));
        var item = items.find(function(b) { return (b.textContent || '').indexOf('Practice Exams') !== -1; });
        if (item) { item.click(); navOk = true; } else { await sleep(500); }
      }
      if (!navOk) return { ok: false, stage: 'no-nav' };
      await sleep(2500);
      var text = document.body.innerText || '';
      var groups = ['Cloud Practitioner', 'Developer', 'Solutions Architect', 'AI Practitioner'].map(function(g) {
        return { name: g, present: text.indexOf(g) !== -1 };
      });
      return { ok: true, sources: sources.length, files: files.length,
        questions: files.reduce(function(s, f) { return s + f.questionCount; }, 0),
        groups: groups };
    } catch (e) {
      return { ok: false, stage: 'exception', message: String((e && e.message) || e) };
    }
  })()`;
  const result = await cdpEvaluate(page.webSocketDebuggerUrl, expression);
  console.log('[prod-exams] result:', JSON.stringify(result));
  const groupsOk = result?.ok && (result.groups || []).every((g) => g.present);
  if (groupsOk && result.files === 22) {
    console.log('[prod-exams] PASS: 22 files grouped by certification in the real app');
  } else {
    console.error('[prod-exams] FAIL');
    process.exitCode = 1;
  }
} catch (err) {
  console.error(`[prod-exams] ERROR: ${err.message}`);
  process.exitCode = 1;
} finally {
  if (child && !child.killed) child.kill('SIGKILL');
  try {
    const { execSync } = await import('node:child_process');
    execSync('taskkill /F /IM electron.exe /T', { stdio: 'ignore' });
  } catch { /* nothing running */ }
}
