import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { AppSettings } from './types';
import { DEFAULT_SETTINGS } from './types';
import { api } from './services/api';
import Sidebar from './components/Sidebar/Sidebar';
import Topbar from './components/Topbar/Topbar';
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

interface AppContextValue {
  route: Route;
  navigate: (route: Route) => void;
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => void;
  refreshKey: number;
  refreshAll: () => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppContext');
  return ctx;
}

export default function App() {
  const [route, setRoute] = useState<Route>({ name: 'dashboard' });
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [refreshKey, setRefreshKey] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');

  const navigate = useCallback((r: Route) => {
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

  return (
    <AppContext.Provider value={{ route, navigate, settings, updateSettings, refreshKey, refreshAll, searchQuery, setSearchQuery }}>
      <div className="app-shell">
        <Sidebar />
        <div className="app-main">
          <Topbar />
          {/*
            The key remounts a page when the ROUTE changes (a different course
            or lesson needs fresh component state). It deliberately does not
            include refreshKey: every page re-fetches on it as an effect
            dependency instead, because remounting on a data refresh also tore
            down the video element mid-lesson.
          */}
          <main className="app-content" key={`${route.name}-${'courseId' in route ? route.courseId : ''}-${'lessonId' in route ? route.lessonId : ''}`}>
            {renderPage()}
          </main>
        </div>
      </div>
    </AppContext.Provider>
  );
}
