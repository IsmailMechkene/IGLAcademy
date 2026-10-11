// UI-path verification for the file-direct Practice Exams library.
// Registers the real SAA practice-test folder (read-only), then clicks through
// sidebar -> grouped library -> exam file -> mode picker -> exam mode (timer)
// -> practice mode (instant feedback), asserting each stage renders.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const DEBUG_PORT = await pickPort(9334);

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
const SAA_DIR = 'G:/Education/downloadly/Udemy - Practice Exams  AWS Certified Solutions Architect Associate 2026-4/01. practice-test';

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
      else if (msg.result?.exceptionDetails) {
        const ex = msg.result.exceptionDetails;
        const text = ex.exception ? JSON.stringify(ex.exception).slice(0, 500) : ex.text;
        reject(new Error(`page exception: ${text} @${JSON.stringify(ex.stackTrace)}`.slice(0, 800)));
      }
      else resolve(msg.result?.result?.value);
    });
    ws.addEventListener('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`websocket error: ${e.message ?? e.type}`));
    });
  });
}

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ismalearn-examui-'));
const userDataDir = path.join(workDir, 'profile');
fs.mkdirSync(userDataDir, { recursive: true });

let child = null;
try {
  const electronBin = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  child = spawn(
    electronBin,
    [`--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${userDataDir}`, '.'],
    { cwd: root, stdio: 'ignore' },
  );

  const page = await waitForDebugger();
  const saaDirJson = JSON.stringify(SAA_DIR);
  const expression = `(async function() {
    try {
      var api = null;
      for (var i = 0; i < 150 && !api; i++) {
        api = window.ismaLearn;
        if (!api) await new Promise(function(r) { setTimeout(r, 100); });
      }
      if (!api || !api.practice) return { ok: false, stage: 'no-api' };
      function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
      async function navTo(label) {
        for (var w = 0; w < 60; w++) {
          var items = Array.prototype.slice.call(document.querySelectorAll('nav button'));
          var item = items.find(function(b) { return (b.textContent || '').indexOf(label) !== -1; });
          if (item) { item.click(); return true; }
          await sleep(500);
        }
        return false;
      }
      function bodyText() { return document.body.innerText || ''; }
      function mainText() { var m = document.querySelector('main'); return m ? (m.innerText || '') : ''; }
      function mainButtons() {
        var m = document.querySelector('main');
        return m ? Array.prototype.slice.call(m.querySelectorAll('button')) : [];
      }
      // Wait for a condition instead of sleeping a fixed time: fixed sleeps
      // were the source of the flakiness the runner used to paper over.
      async function waitFor(fn, ms) {
        var end = Date.now() + (ms || 20000);
        while (Date.now() < end) {
          var v = fn();
          if (v) return v;
          await sleep(200);
        }
        return null;
      }
      // register the real SAA folder (dialog-free IPC)
      var source = await api.practice.addFolderPath(${saaDirJson});
      if (!source || !source.id) return { ok: false, stage: 'no-source' };
      // sidebar -> grouped library: certifications first, no test rows yet
      if (!await navTo('Practice Exams')) return { ok: false, stage: 'no-practice-nav' };
      await waitFor(function() { return mainText().indexOf('Solutions Architect') !== -1; });
      var lib = mainText();
      if (lib.indexOf('Solutions Architect') === -1) return { ok: false, stage: 'no-group', snippet: lib.slice(0, 300) };
      if (lib.indexOf('Practice Test #1') !== -1) return { ok: false, stage: 'tests-not-grouped' };
      // pick the certification -> its tests appear
      var cert = mainButtons().find(function(b) { return (b.textContent || '').indexOf('Solutions Architect') !== -1; });
      if (!cert) return { ok: false, stage: 'no-cert-card' };
      cert.click();
      await waitFor(function() {
        var t = mainText();
        return t.indexOf('Practice Test #1') !== -1 && t.indexOf('65 questions') !== -1;
      });
      var detail = mainText();
      if (detail.indexOf('Practice Test #1') === -1) return { ok: false, stage: 'no-row', snippet: detail.slice(0, 300) };
      if (detail.indexOf('65 questions') === -1) return { ok: false, stage: 'no-counts' };
      // start the first exam -> mode picker
      var startBtns = Array.prototype.slice.call(document.querySelectorAll('button'));
      var card = null;
      var buttons = Array.prototype.slice.call(document.querySelectorAll('button'));
      var start = buttons.find(function(b) {
        if ((b.textContent || '').trim() !== 'Start') return false;
        var el = b.parentElement;
        while (el && el !== document.body) {
          if ((el.textContent || '').indexOf('Practice Test #1') !== -1) return true;
          el = el.parentElement;
        }
        return false;
      });
      if (!start) return { ok: false, stage: 'no-start-btn' };
      start.click();
      var seen = [];
      for (var t = 0; t < 8; t++) {
        await sleep(1000);
        var bt = document.body.innerText || '';
        seen.push(bt.slice(0, 80).replace(/\\n/g, ' | '));
        if (bt.indexOf('Practice mode') !== -1 && bt.indexOf('Exam mode') !== -1) break;
      }
      var picker = bodyText();
      if (picker.indexOf('Practice mode') === -1 || picker.indexOf('Exam mode') === -1) {
        return { ok: false, stage: 'no-mode-picker', seen: seen, snippet: picker.slice(0, 300) };
      }
      // exam mode: 65 questions x 2 min = 2:10:00 countdown + navigator
      var modeBtns = Array.prototype.slice.call(document.querySelectorAll('button'));
      var examMode = modeBtns.find(function(b) { return (b.textContent || '').indexOf('Exam mode') !== -1; });
      if (!examMode) return { ok: false, stage: 'no-exam-mode-btn' };
      examMode.click();
      await waitFor(function() {
        var t = bodyText();
        return /[0-9]+:[0-9]{2}(:[0-9]{2})?/.test(t) && t.indexOf('Flag') !== -1;
      });
      var exam = bodyText();
      if (!/[0-9]+:[0-9]{2}(:[0-9]{2})?/.test(exam)) return { ok: false, stage: 'no-timer', snippet: exam.slice(0, 300) };
      if (exam.indexOf('Flag') === -1) return { ok: false, stage: 'no-flag', snippet: exam.slice(0, 300) };
      // back to picker -> practice mode -> instant feedback on first answer
      var exits = Array.prototype.slice.call(document.querySelectorAll('button'));
      var exit = exits.find(function(b) { return (b.textContent || '').trim() === 'Exit'; });
      if (!exit) return { ok: false, stage: 'no-exit' };
      exit.click();
      await waitFor(function() { return bodyText().indexOf('Practice mode') !== -1; });
      var practiceBtns = Array.prototype.slice.call(document.querySelectorAll('button'));
      var practiceMode = practiceBtns.find(function(b) { return (b.textContent || '').indexOf('Practice mode') !== -1; });
      if (!practiceMode) {
        var allBtns = practiceBtns.map(function(b) { return (b.textContent || '').trim().slice(0, 40); });
        return { ok: false, stage: 'no-practice-mode-btn', buttons: allBtns, snippet: (document.body.innerText || '').slice(0, 300) };
      }
      practiceMode.click();
      await waitFor(function() { return document.querySelectorAll('button[aria-pressed="false"]').length > 0; });
      var options = Array.prototype.slice.call(document.querySelectorAll('button[aria-pressed="false"]'));
      if (options.length === 0) return { ok: false, stage: 'no-options' };
      options[0].click();
      await waitFor(function() { return bodyText().indexOf('Next') !== -1; });
      var revealed = bodyText();
      if (revealed.indexOf('Next') === -1) return { ok: false, stage: 'no-feedback', snippet: revealed.slice(0, 400) };
      return { ok: true };
    } catch (e) {
      return { ok: false, stage: 'exception', message: String((e && e.message) || e) };
    }
  })()`;

  const result = await cdpEvaluate(page.webSocketDebuggerUrl, expression);
  console.log('[exam-ui] result:', JSON.stringify(result));
  if (result?.ok) {
    console.log('[exam-ui] PASS: file-direct library, grouping, picker, timer, practice feedback');
  } else {
    console.error('[exam-ui] FAIL');
    process.exitCode = 1;
  }
} catch (err) {
  console.error(`[exam-ui] ERROR: ${err.message}`);
  process.exitCode = 1;
} finally {
  if (child && !child.killed) child.kill('SIGKILL');
  try {
    const { execSync } = await import('node:child_process');
    execSync('taskkill /F /IM electron.exe /T', { stdio: 'ignore' });
  } catch { /* nothing running */ }
  fs.rmSync(workDir, { recursive: true, force: true });
}
