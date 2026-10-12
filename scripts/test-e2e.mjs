// End-to-end tests against the built app. Self-contained: fixtures come from
// scripts/e2e/fixtures (a generated test clip and synthetic exams), each suite
// uses a throwaway profile, and only the Electron processes the suites start
// are stopped. No internet (the updater suite serves its release feed on
// 127.0.0.1), no personal files.
//
// Usage: npm run build && npm run test:e2e
import { run as runMedia } from './e2e/media.e2e.mjs';
import { run as runUi } from './e2e/ui.e2e.mjs';
import { run as runUpdates } from './e2e/updates.e2e.mjs';

const suites = [
  ['media', runMedia],
  ['ui', runUi],
  ['updates', runUpdates],
];

let ok = true;
for (const [name, run] of suites) {
  console.log(`[test:e2e] ${name}`);
  try {
    if (!(await run())) ok = false;
  } catch (err) {
    ok = false;
    console.error(`[test:e2e] ${name} crashed: ${err?.stack ?? err}`);
  }
}
console.log(ok ? '[test:e2e] all suites passed' : '[test:e2e] FAILED');
process.exit(ok ? 0 : 1);
