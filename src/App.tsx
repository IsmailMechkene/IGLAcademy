import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { AppSettings } from './types';
import { DEFAULT_SETTINGS } from './types';
import { api } from './services/api';
import Sidebar from './components/Sidebar/Sidebar';
import Topbar from './components/Topbar/Topbar';
import CommandPalette from './components/CommandPalette/CommandPalette';
import WhatsNew from './components/WhatsNew/WhatsNew';
import { entriesSince, parseChangelog, type ChangelogEntry } from './utils/changelog';
import changelogText from '../CHANGELOG.md?raw';
import Dashboard from './pages/Dashboard/Dashboard';
import Library from './pages/Library/Library';
import CourseDetail from './pages/CourseDetail/CourseDetail';
import Player from './pages/Player/Player';
import FileExamPage from './components/Quiz/FileExamPage';
import ExamStats from './pages/ExamStats/ExamStats';
import ReviewPage from './pages/Review/ReviewPage';
import PracticeExams from './pages/PracticeExams/PracticeExams';
import NotesPage from './pages/Notes/NotesPage';
import Settings from './pages/Settings/Settings';

export type Route =
  | { name: 'dashboard' }
  | { name: 'library' }
  | { name: 'in-progress' }
  | { name: 'completed' }
  | { name: 'course'; courseId: number }
  | { name: 'player'; courseId: number; lessonId: number; startAt?: number }
  | { name: 'examfile'; filePath: string }
  | { name: 'examstats'; filePath: string }
  | { name: 'practice' }
  | { name: 'review' }
  | { name: 'notes' }
  | { name: 'settings' };

/** One step of the header breadcrumb; the last one is the current page. */
export interface Crumb {
  label: string;
  route?: Route;
}

interface AppContextValue {
  route: Route;
  navigate: (route: Route) => void;
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
  refreshKey: number;
  refreshAll: () => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  /** Page-provided breadcrumb (e.g. Courses › <course title>); null = route default. */
  crumbs: Crumb[] | null;
  setCrumbs: (crumbs: Crumb[] | null) => void;
  /** Opens the Ctrl+K search palette. */
  openSearch: () => void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppContext');
  return ctx;
}

/** Lets a page put its own trail in the header (cleared on every navigation). */
export function useCrumbs(crumbs: Crumb[] | null): void {
  const { setCrumbs } = useApp();
  const key = JSON.stringify(crumbs);
  useEffect(() => {
    setCrumbs(crumbs);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on content, not identity
  }, [key, setCrumbs]);
}

export default function App() {
  const [route, setRoute] = useState<Route>({ name: 'dashboard' });
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [refreshKey, setRefreshKey] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [crumbs, setCrumbs] = useState<Crumb[] | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const openSearch = useCallback(() => setSearchOpen(true), []);

  // Ctrl/Cmd+K opens search from anywhere, including the player.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const navigate = useCallback((r: Route) => {
    setCrumbs(null);
    setRoute(r);
  }, []);

  const refreshAll = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Optimistic: the UI updates at once, the writes happen outside the state
  // updater (StrictMode runs updaters twice, which doubled every write), and
  // a rejected write rolls the UI back to what is actually stored.
  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
    Promise.all(Object.entries(patch).map(([key, value]) => api().settings.set(key, value))).catch(
      async (err: unknown) => {
        const stored = await api().settings.getAll().catch(() => null);
        if (stored) setSettings(stored);
        void api().app.showError(
          'Setting not saved',
          err instanceof Error ? err.message : 'The setting could not be saved.',
        );
      },
    );
  }, []);

  // Load settings and apply theme
  useEffect(() => {
    api()
      .settings.getAll()
      .then(setSettings)
      .catch(() => undefined);
  }, []);

  // "What's new" once after an update. A fresh install (no courses yet) just
  // records its version. 1.0.0 never recorded one, so an existing library with
  // no recorded version is an upgrade: it gets the current version's notes.
  const [whatsNew, setWhatsNew] = useState<{ version: string; entries: ChangelogEntry[] } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [version, lastSeen, library] = await Promise.all([
        api().app.getVersion(),
        api().settings.get<string>('lastSeenVersion'),
        api().app.getLibraryInfo(),
      ]);
      if (cancelled || !version || lastSeen === version) return;
      const entries = parseChangelog(changelogText);
      const unseen = lastSeen
        ? entriesSince(entries, lastSeen, version)
        : library.courseCount > 0
          ? entries.filter((e) => e.version === version)
          : [];
      if (unseen.length > 0) setWhatsNew({ version, entries: unseen });
      else void api().settings.set('lastSeenVersion', version);
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  const closeWhatsNew = useCallback(() => {
    if (whatsNew) updateSettings({ lastSeenVersion: whatsNew.version });
    setWhatsNew(null);
  }, [whatsNew, updateSettings]);

  // Apply theme; 'system' follows the OS color scheme and tracks changes
  useEffect(() => {
    const resolveTheme = () => {
      if (settings.theme === 'system') {
        return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
      }
      return settings.theme;
    };
    document.documentElement.setAttribute('data-theme', resolveTheme());
    if (settings.theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const listener = () => document.documentElement.setAttribute('data-theme', resolveTheme());
    mq.addEventListener('change', listener);
    return () => mq.removeEventListener('change', listener);
  }, [settings.theme]);

  // Save playback position when the window closes
  useEffect(() => {
    const handler = () => {
      const event = new CustomEvent('ismalearn:window-closing');
      window.dispatchEvent(event);
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // Optional watched-folder rescan on startup (Settings → Course imports)
  useEffect(() => {
    let cancelled = false;
    api()
      .settings.get<boolean>('rescanOnStartup')
      .then((enabled) => {
        if (cancelled || enabled !== true) return;
        return api()
          .courses.rescanAll()
          .then(() => {
            if (!cancelled) refreshAll();
          })
          .catch(() => undefined);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderPage = () => {
    switch (route.name) {
      case 'dashboard':
        return <Dashboard />;
      case 'library':
        return <Library />;
      case 'in-progress':
        return <Library filter="in-progress" />;
      case 'completed':
        return <Library filter="completed" />;
      case 'course':
        return <CourseDetail courseId={route.courseId} />;
      case 'player':
        return <Player courseId={route.courseId} lessonId={route.lessonId} startAt={route.startAt} />;
      case 'review':
        return <ReviewPage />;
      case 'examfile':
        return <FileExamPage filePath={route.filePath} />;
      case 'examstats':
        return <ExamStats filePath={route.filePath} />;
      case 'practice':
        return <PracticeExams />;
      case 'notes':
        return <NotesPage />;
      case 'settings':
        return <Settings />;
    }
  };

  /*
    The key remounts a page when the ROUTE changes (a different course or
    lesson needs fresh component state). It deliberately does not include
    refreshKey: every page re-fetches on it as an effect dependency instead,
    because remounting on a data refresh also tore down the video element
    mid-lesson.
  */
  const pageKey = `${route.name}-${'courseId' in route ? route.courseId : ''}-${'lessonId' in route ? route.lessonId : ''}`;
  // The player is a focus mode: no app sidebar or header competing with the video.
  const focus = route.name === 'player';

  return (
    <AppContext.Provider
      value={{
        route, navigate, settings, updateSettings, refreshKey, refreshAll, searchQuery, setSearchQuery,
        crumbs, setCrumbs, openSearch,
      }}
    >
      {searchOpen && <CommandPalette onClose={() => setSearchOpen(false)} navigate={navigate} />}
      {whatsNew && <WhatsNew entries={whatsNew.entries} onClose={closeWhatsNew} />}
      {focus ? (
        <main className="app-focus" key={pageKey}>
          {renderPage()}
        </main>
      ) : (
        <div className="app-shell">
          <Sidebar />
          <div className="app-main">
            <Topbar />
            <main className="app-content" key={pageKey}>
              {renderPage()}
            </main>
          </div>
        </div>
      )}
    </AppContext.Provider>
  );
}
