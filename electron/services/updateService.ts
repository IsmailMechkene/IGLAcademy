import { app } from 'electron';

// Lightweight update check (no auto-download): compares the running version
// against the latest GitHub release tag. Works unsigned and offline-safe.
// For fully automatic signed updates, wire electron-updater with a published
// feed instead (see README).

/** Set to "owner/repo" to enable update checks for a published build. */
export const UPDATE_REPO = '';

export type UpdateStatus =
  | { status: 'disabled' }
  | { status: 'up-to-date'; version: string }
  | { status: 'update-available'; version: string; current: string; url: string }
  | { status: 'offline' | 'error'; message: string };

function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  const repo = (process.env.ISMALEARN_UPDATE_REPO ?? UPDATE_REPO).trim();
  if (!repo || !repo.includes('/')) return { status: 'disabled' };
  const current = app.getVersion();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      signal: controller.signal,
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return { status: 'error', message: `Release check failed (HTTP ${res.status}).` };
    const data = (await res.json()) as { tag_name?: string; html_url?: string };
    const latest = (data.tag_name ?? '').replace(/^v/, '');
    if (!latest) return { status: 'error', message: 'No releases published yet.' };
    if (compareVersions(latest, current) > 0) {
      return {
        status: 'update-available',
        version: latest,
        current,
        url: data.html_url ?? `https://github.com/${repo}/releases/latest`,
      };
    }
    return { status: 'up-to-date', version: current };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return {
      status: aborted ? 'offline' : 'error',
      message: aborted ? 'No internet connection.' : 'Could not reach the update server.',
    };
  } finally {
    clearTimeout(timer);
  }
}
