// The in-app updater against a local release feed: "up to date", "no release
// published", and a real download of a newer version (checksum-verified by
// electron-updater) that ends at "Restart to update". Nothing is installed:
// the checks never press the restart button.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { assert, launch, root, runChecks } from './harness.mjs';

const CURRENT = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const NEXT = '99.0.0';
// Matches updaterCacheDirName in electron/services/updateService.ts (test feed).
const CACHE_DIR = path.join(process.env.LOCALAPPDATA ?? os.tmpdir(), 'ismalearn-test-updater');

/** A feed whose latest.yml can be swapped between checks. */
function startFeed() {
  const installer = crypto.randomBytes(256 * 1024);
  const name = `IsmaLearn-Setup-${NEXT}.exe`;
  const sha512 = crypto.createHash('sha512').update(installer).digest('base64');
  const manifests = {
    current: `version: ${CURRENT}\nfiles:\n  - url: IsmaLearn-Setup-${CURRENT}.exe\n    sha512: ${sha512}\n    size: ${installer.length}\npath: IsmaLearn-Setup-${CURRENT}.exe\nsha512: ${sha512}\nreleaseDate: '2026-01-01T00:00:00.000Z'\n`,
    // Same file, but the published checksum doesn't match it (a tampered or
    // truncated download).
    tampered: `version: ${NEXT}
files:
  - url: ${name}
    sha512: ${crypto.createHash('sha512').update('other').digest('base64')}
    size: ${installer.length}
path: ${name}
releaseDate: '2026-01-02T00:00:00.000Z'
`,
    next: `version: ${NEXT}\nfiles:\n  - url: ${name}\n    sha512: ${sha512}\n    size: ${installer.length}\npath: ${name}\nsha512: ${sha512}\nreleaseDate: '2026-01-02T00:00:00.000Z'\n`,
  };
  const feed = { serve: 'none', downloads: 0 };
  const server = http.createServer((req, res) => {
    const url = (req.url ?? '').split('?')[0];
    if (url === '/latest.yml' && feed.serve !== 'none') {
      res.writeHead(200, { 'Content-Type': 'text/yaml' });
      res.end(manifests[feed.serve]);
    } else if (url === `/${name}`) {
      feed.downloads++;
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': installer.length });
      res.end(installer);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      feed.url = `http://127.0.0.1:${server.address().port}/`;
      feed.close = () => new Promise((r) => server.close(r));
      resolve(feed);
    });
  });
}

/** Presses "Check now" on Settings and waits for the status line to match. */
async function checkNow(page, expected) {
  return page.run(async (expected) => {
    const button = await waitFor(() => byText('main button', 'Check now'), '"Check now"');
    await waitFor(() => !button.disabled, '"Check now" enabled');
    button.click();
    const re = new RegExp(expected);
    return await waitFor(() => {
      const t = document.querySelector('[data-testid="update-status"]')?.textContent ?? '';
      return re.test(t) ? t : null;
    }, `update status /${expected}/`, 30000);
  }, expected);
}

export async function run() {
  fs.rmSync(CACHE_DIR, { recursive: true, force: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ismalearn-e2e-updates-'));
  const feed = await startFeed();
  const app = await launch(profile, { env: { ISMALEARN_UPDATE_FEED: feed.url } });

  try {
    await app.page.run(async () => {
      await click('aside button', 'Settings');
      await waitFor(() => document.querySelector('[data-testid="update-status"]'), 'Updates section');
    });

    return await runChecks('updates', [
      ['with no release published, says so instead of failing vaguely', async () => {
        feed.serve = 'none';
        const text = await checkNow(app.page, 'No release has been published yet');
        assert(text.includes('No release'), text);
      }],
      ['with the running version published, reports up to date', async () => {
        feed.serve = 'current';
        await checkNow(app.page, 'You have the latest version');
        assert(feed.downloads === 0, `downloaded ${feed.downloads} times while up to date`);
      }],
      ['a download that fails its checksum is rejected, not offered', async () => {
        feed.serve = 'tampered';
        await checkNow(app.page, 'damaged');
        const r = await app.page.run(async () => ({
          status: (await api.updates.status()).state,
          sidebar: !!byText('aside button', 'Restart to update'),
        }));
        assert(r.status === 'error' && !r.sidebar, JSON.stringify(r));
        feed.downloads = 0;
      }],
      ['a newer release downloads, verifies and offers a restart', async () => {
        feed.serve = 'next';
        await checkNow(app.page, `Version ${NEXT} is ready`);
        const r = await app.page.run(async () => ({
          status: await api.updates.status(),
          sidebar: !!byText('aside button', 'Restart to update'),
          settings: !!byText('main button', 'Restart to update'),
          checkNow: !!byText('main button', 'Check now'),
        }));
        assert(r.status.state === 'ready' && r.status.version === '99.0.0', JSON.stringify(r.status));
        assert(r.sidebar, 'no "Restart to update" in the sidebar');
        assert(r.settings && !r.checkNow, 'Settings should offer the restart instead of another check');
        assert(feed.downloads === 1, `installer downloaded ${feed.downloads} times`);
        const cached = fs.readdirSync(path.join(CACHE_DIR, 'pending')).filter((f) => f.endsWith('.exe'));
        assert(cached.length === 1, `pending installers: ${cached.join(', ') || 'none'}`);
      }],
      ['the automatic-check setting persists', async () => {
        const r = await app.page.run(async () => {
          const before = (await api.settings.getAll()).autoUpdate;
          const group = await waitFor(() => document.querySelector('[aria-label="Check for updates automatically"]'), 'toggle');
          byText('button', 'Off', group).click();
          await sleep(300);
          const after = (await api.settings.getAll()).autoUpdate;
          byText('button', 'On', group).click();
          await sleep(300);
          return { before, after, restored: (await api.settings.getAll()).autoUpdate };
        });
        assert(r.before === true && r.after === false && r.restored === true, JSON.stringify(r));
      }],
    ]);
  } finally {
    await app.stop();
    await feed.close();
    fs.rmSync(CACHE_DIR, { recursive: true, force: true });
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
