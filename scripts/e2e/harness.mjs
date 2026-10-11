// End-to-end harness: launches the BUILT app (dist/ + dist-electron/) with a
// throwaway profile, talks to its renderer over the DevTools protocol, and can
// relaunch it on the same profile to simulate a restart. It only ever stops
// the Electron process it started — never other Electron apps on the machine.
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const root = path.join(__dirname, '..', '..');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function freePort(from) {
  for (let port = from; port < from + 50; port++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(500) });
      if (res.ok) continue; // taken by something else
    } catch {
      return port;
    }
  }
  throw new Error('no free DevTools port');
}

function electronBinary() {
  const bin = process.platform === 'win32'
    ? path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
    : path.join(root, 'node_modules', '.bin', 'electron');
  if (!fs.existsSync(bin)) throw new Error(`Electron binary not found at ${bin}`);
  if (!fs.existsSync(path.join(root, 'dist-electron', 'main.js'))) {
    throw new Error('dist-electron/main.js is missing — run `npm run build` first');
  }
  return bin;
}

/** A minimal DevTools-protocol client over the page's WebSocket. */
class Page {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.consoleErrors = [];
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.method === 'Runtime.exceptionThrown') {
        this.consoleErrors.push(msg.params.exceptionDetails?.exception?.description ?? 'exception');
      }
      const waiter = this.pending.get(msg.id);
      if (!waiter) return;
      this.pending.delete(msg.id);
      if (msg.error) waiter.reject(new Error(`${waiter.method}: ${JSON.stringify(msg.error)}`));
      else waiter.resolve(msg.result);
    });
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('DevTools socket failed')), { once: true });
    });
    const page = new Page(ws);
    await page.send('Runtime.enable');
    await page.send('Page.enable');
    // A fixed, realistic viewport so layout assertions are deterministic.
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    return page;
  }

  send(method, params = {}, timeoutMs = 60000) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        method,
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
    });
  }

  /**
   * Evaluates an async function body in the page and returns its value.
   * `fn` is a function whose source is sent verbatim; `arg` is JSON-passed.
   * Inside, `api` (the preload bridge) and the helpers below are in scope.
   */
  async run(fn, arg = null, timeoutMs = 60000) {
    const expression = `(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      let api = null;
      for (let i = 0; i < 200 && !(api = window.ismaLearn); i++) await sleep(50);
      if (!api) throw new Error('preload bridge never appeared');
      const waitFor = async (check, label, ms = 15000) => {
        const end = Date.now() + ms;
        while (Date.now() < end) {
          const v = check();
          if (v) return v;
          await sleep(100);
        }
        throw new Error('timed out waiting for ' + label);
      };
      const byText = (selector, text, rootEl = document) =>
        Array.from(rootEl.querySelectorAll(selector)).find((el) => (el.textContent || '').includes(text)) || null;
      const click = async (selector, text, label) => {
        const el = await waitFor(() => (text === undefined ? document.querySelector(selector) : byText(selector, text)), label || (selector + ' ' + (text || '')));
        el.click();
        return el;
      };
      const mainText = () => (document.querySelector('main') || document.body).innerText || '';
      return await (${fn.toString()})(${JSON.stringify(arg)});
    })()`;
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
    if (result.exceptionDetails) {
      const ex = result.exceptionDetails;
      throw new Error(ex.exception?.description ?? ex.text ?? 'page exception');
    }
    return result.result.value;
  }

  async screenshot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' }, 20000);
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  }

  close() {
    try {
      this.ws.close();
    } catch {
      // already closed
    }
  }
}

/** Launches the built app on `profileDir`; returns { page, stop }. */
export async function launch(profileDir) {
  const port = await freePort(9400);
  const child = spawn(
    electronBinary(),
    [`--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, '.'],
    { cwd: root, stdio: 'ignore', windowsHide: false },
  );
  let exited = false;
  child.on('exit', () => {
    exited = true;
  });

  const deadline = Date.now() + 60000;
  let target = null;
  while (!target && Date.now() < deadline) {
    if (exited) throw new Error('Electron exited during startup');
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
      target = (await res.json()).find((t) => t.type === 'page' && !t.url.startsWith('devtools://')) ?? null;
    } catch {
      // not listening yet
    }
    if (!target) await sleep(250);
  }
  if (!target) throw new Error('the app window never appeared');

  const page = await Page.connect(target.webSocketDebuggerUrl);
  const stop = async () => {
    page.close();
    if (exited) return;
    try {
      if (process.platform === 'win32') execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' });
      else child.kill('SIGKILL');
    } catch {
      // already gone
    }
    // Wait for the process (and its database lock) to go away.
    for (let i = 0; i < 40 && !exited; i++) await sleep(100);
  };
  return { page, stop };
}

/** Runs named checks in order, printing each; returns true when all pass. */
export async function runChecks(suite, checks) {
  let failed = 0;
  for (const [name, fn] of checks) {
    const started = Date.now();
    try {
      await fn();
      console.log(`  ✓ ${name} (${Date.now() - started} ms)`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${name}\n      ${String(err?.message ?? err).split('\n').join('\n      ')}`);
    }
  }
  console.log(`[${suite}] ${checks.length - failed}/${checks.length} passed`);
  return failed === 0;
}

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}
