import { ChevronRight, Moon, Search, Sun } from 'lucide-react';
import { useApp } from '../../App';
import type { Crumb, Route } from '../../App';
import WindowControls from '../WindowControls/WindowControls';
import styles from './Topbar.module.css';

/** The trail shown when a page does not provide its own. */
function defaultCrumbs(route: Route): Crumb[] {
  switch (route.name) {
    case 'dashboard':
      return [{ label: 'Home' }];
    case 'library':
    case 'in-progress':
    case 'completed':
    case 'course':
    case 'player':
      return [{ label: 'Courses', route: { name: 'library' } }];
    case 'practice':
      return [{ label: 'Practice Exams' }];
    case 'examfile':
      return [{ label: 'Practice Exams', route: { name: 'practice' } }, { label: 'Exam' }];
    case 'examstats':
      return [{ label: 'Practice Exams', route: { name: 'practice' } }, { label: 'Analytics' }];
    case 'review':
      return [{ label: 'Review' }];
    case 'notes':
      return [{ label: 'Notes' }];
    case 'settings':
      return [{ label: 'Settings' }];
  }
}

export default function Topbar() {
  const { route, navigate, crumbs, settings, updateSettings, openSearch } = useApp();
  const trail = crumbs ?? defaultCrumbs(route);
  const resolvedTheme =
    settings.theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark'
      : settings.theme;

  return (
    <header className={`${styles.topbar} drag-region`}>
      <nav className={styles.crumbs} aria-label="Breadcrumb">
        {trail.map((crumb, i) => {
          const last = i === trail.length - 1;
          return (
            <span key={`${crumb.label}-${i}`} className={styles.crumbItem}>
              {i > 0 && <ChevronRight size={14} className={styles.crumbSep} aria-hidden="true" />}
              {crumb.route && !last ? (
                <button className={styles.crumbLink} onClick={() => navigate(crumb.route!)}>
                  {crumb.label}
                </button>
              ) : (
                <span className={last ? styles.crumbCurrent : styles.crumbPlain} aria-current={last ? 'page' : undefined}>
                  {crumb.label}
                </span>
              )}
            </span>
          );
        })}
      </nav>

      <button className={styles.searchTrigger} onClick={openSearch} aria-label="Search everything" aria-keyshortcuts="Control+K">
        <Search size={15} className={styles.searchIcon} aria-hidden="true" />
        <span className={styles.searchPlaceholder}>Search courses, lessons, notes…</span>
        <span className={styles.shortcut} aria-hidden="true">
          <kbd>Ctrl</kbd>
          <kbd>K</kbd>
        </span>
      </button>

      <button
        className="iconBtn"
        onClick={() => updateSettings({ theme: resolvedTheme === 'dark' ? 'light' : 'dark' })}
        aria-label={resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        title={resolvedTheme === 'dark' ? 'Light theme' : 'Dark theme'}
      >
        {resolvedTheme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
      </button>
      <WindowControls />
    </header>
  );
}
