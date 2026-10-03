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
import PracticeExams from './pages/PracticeExams/PracticeExams';
import NotesPage from './pages/Notes/NotesPage';
import Settings from './pages/Settings/Settings';

export type Route =
  | { name: 'dashboard' }
  | { name: 'library' }
  | { name: 'in-progress' }
  | { name: 'completed' }
  | { name: 'course'; courseId: number }
  | { name: 'player'; courseId: number; lessonId: number }
  | { name: 'examfile'; filePath: string }
  | { name: 'practice' }
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

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      for (const [key, value] of Object.entries(patch)) {
        void api().settings.set(key, value);
      }
      return next;
    });
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
        return <Player courseId={route.courseId} lessonId={route.lessonId} />;
      case 'examfile':
        return <FileExamPage filePath={route.filePath} />;
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
          <main className="app-content" key={`${route.name}-${'courseId' in route ? route.courseId : ''}-${'lessonId' in route ? route.lessonId : ''}-${refreshKey}`}>
            {renderPage()}
          </main>
        </div>
      </div>
    </AppContext.Provider>
  );
}
