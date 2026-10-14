import type { IsmaLearnApi } from '../../electron/preload';

// Typed access to the contextBridge API. Throws a friendly error when the
// API is unavailable (e.g. renderer opened outside Electron).
export function api(): IsmaLearnApi {
  const a = (window as unknown as { ismaLearn?: IsmaLearnApi }).ismaLearn;
  if (!a) throw new Error('IGLAcademy API is unavailable. Run the app with Electron.');
  return a;
}
