import { useEffect, useRef } from 'react';
import { ChevronRight, Moon, Search, Sun, X } from 'lucide-react';
import { useApp } from '../../App';
import type { Crumb, Route } from '../../App';
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
  const { route, navigate, searchQuery, setSearchQuery, crumbs, settings, updateSettings } = useApp();
  const searchRef = useRef<HTMLInputElement>(null);
  const trail = crumbs ?? defaultCrumbs(route);

  // Ctrl/Cmd+K focuses search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleSearch = (value: string) => {
    setSearchQuery(value);
    // Typing in global search jumps to the library, which filters by it
    if (value && route.name !== 'library' && route.name !== 'in-progress' && route.name !== 'completed') {
      navigate({ name: 'library' });
    }
  };

  const resolvedTheme =
    settings.theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark'
      : settings.theme;

  return (
    <header className={styles.topbar}>
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

      <div className={styles.searchWrap}>
        <Search size={15} className={styles.searchIcon} aria-hidden="true" />
        <input
          ref={searchRef}
          className={styles.searchInput}
          placeholder="Search courses"
          aria-label="Search courses"
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setSearchQuery('');
              e.currentTarget.blur();
            }
          }}
        />
        {searchQuery ? (
          <button className={styles.clearBtn} onClick={() => setSearchQuery('')} aria-label="Clear search">
            <X size={13} />
          </button>
        ) : (
          <span className={styles.shortcut} aria-hidden="true">
            <kbd>Ctrl</kbd>
            <kbd>K</kbd>
          </span>
        )}
      </div>

      <button
        className="iconBtn"
        onClick={() => updateSettings({ theme: resolvedTheme === 'dark' ? 'light' : 'dark' })}
        aria-label={resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        title={resolvedTheme === 'dark' ? 'Light theme' : 'Dark theme'}
      >
        {resolvedTheme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
      </button>
    </header>
  );
}
