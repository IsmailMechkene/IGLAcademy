import { useEffect, useState } from 'react';
import {
  Brain, ChevronsLeft, Download, FileCheck2, Home, LibraryBig, Play,
  Settings as SettingsIcon, StickyNote,
} from 'lucide-react';
import { useApp } from '../../App';
import type { Route } from '../../App';
import type { CourseWithProgress } from '../../types';
import { api } from '../../services/api';
import { useUpdateStatus } from '../../services/updates';
import { cleanTitle } from '../../utils/titles';
import CourseCover from '../CourseCover/CourseCover';
import logo from '../../../assets/icon.png';
import styles from './Sidebar.module.css';

interface NavItem {
  label: string;
  icon: typeof Home;
  route: Route;
  match: (route: Route) => boolean;
}

const LEARN: NavItem[] = [
  { label: 'Home', icon: Home, route: { name: 'dashboard' }, match: (r) => r.name === 'dashboard' },
  {
    label: 'Courses',
    icon: LibraryBig,
    route: { name: 'library' },
    match: (r) => r.name === 'library' || r.name === 'in-progress' || r.name === 'completed' || r.name === 'course' || r.name === 'player',
  },
  {
    label: 'Practice Exams',
    icon: FileCheck2,
    route: { name: 'practice' },
    match: (r) => r.name === 'practice' || r.name === 'examfile' || r.name === 'examstats',
  },
];

const STUDY: NavItem[] = [
  { label: 'Review', icon: Brain, route: { name: 'review' }, match: (r) => r.name === 'review' },
  { label: 'Notes', icon: StickyNote, route: { name: 'notes' }, match: (r) => r.name === 'notes' },
];

const SETTINGS: NavItem = {
  label: 'Settings',
  icon: SettingsIcon,
  route: { name: 'settings' },
  match: (r) => r.name === 'settings',
};

const COLLAPSE_KEY = 'ismalearn.sidebarCollapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

export default function Sidebar() {
  const { route, navigate, refreshKey } = useApp();
  const [version, setVersion] = useState('');
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [current, setCurrent] = useState<{ course: CourseWithProgress; lessonId: number | null } | null>(null);
  const [dueCount, setDueCount] = useState(0);
  const update = useUpdateStatus();

  useEffect(() => {
    api()
      .app.getVersion()
      .then(setVersion)
      .catch(() => undefined);
  }, []);

  // "Continue learning" + review badge. Re-read on data refresh and whenever
  // the user comes back from another page (the player changes progress).
  useEffect(() => {
    let cancelled = false;
    Promise.all([api().progress.mostRecentCourseId(), api().courses.list()])
      .then(async ([id, courses]) => {
        const course = courses.find((c) => c.id === id) ?? null;
        if (!course) {
          if (!cancelled) setCurrent(null);
          return;
        }
        const activity = await api().progress.lastActivity(course.id).catch(() => null);
        if (!cancelled) setCurrent({ course, lessonId: activity?.lessonId ?? null });
      })
      .catch(() => undefined);
    api()
      .review.dueCounts()
      .then((d) => {
        if (!cancelled) setDueCount(d.itemsDue + d.cardsDue);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [refreshKey, route.name]);

  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? '0' : '1');
      } catch {
        // per-device convenience only
      }
      return !c;
    });
  };

  const renderItem = (item: NavItem, badge?: number) => {
    const active = item.match(route);
    const Icon = item.icon;
    return (
      <button
        key={item.label}
        className={`${styles.navItem} ${active ? styles.active : ''}`}
        onClick={() => navigate(item.route)}
        aria-current={active ? 'page' : undefined}
        title={collapsed ? item.label : undefined}
      >
        <span className={styles.navIcon}>
          <Icon size={18} strokeWidth={active ? 2.2 : 1.9} />
        </span>
        <span className={styles.navLabel}>{item.label}</span>
        {badge ? <span className={styles.navBadge}>{badge > 99 ? '99+' : badge}</span> : null}
      </button>
    );
  };

  return (
    <aside className={`${styles.sidebar} ${collapsed ? styles.collapsed : ''}`}>
      <div className={`${styles.brand} drag-region`}>
        <div className={styles.logoMark}>
          <img src={logo} alt="" draggable={false} />
        </div>
        <span className={styles.logoName}>IGLAcademy</span>
        <button
          className={styles.collapseBtn}
          onClick={toggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <ChevronsLeft size={16} className={styles.collapseIcon} />
        </button>
      </div>

      <nav className={styles.nav} aria-label="Main">
        <div className={styles.group}>
          <span className={styles.groupLabel}>Learn</span>
          {LEARN.map((item) => renderItem(item))}
        </div>
        <div className={styles.group}>
          <span className={styles.groupLabel}>Study</span>
          {STUDY.map((item) => renderItem(item, item.label === 'Review' ? dueCount : undefined))}
        </div>
      </nav>

      <div className={styles.footer}>
        {current && (
          // Stays mounted while collapsed so it can fold away instead of vanishing.
          <div className={styles.reveal} aria-hidden={collapsed || undefined}>
            <div className={styles.revealInner}>
              <button
                className={styles.continueCard}
                tabIndex={collapsed ? -1 : undefined}
                onClick={() =>
                  navigate(
                    current.lessonId !== null
                      ? { name: 'player', courseId: current.course.id, lessonId: current.lessonId }
                      : { name: 'course', courseId: current.course.id },
                  )
                }
                title={`Continue ${cleanTitle(current.course.title)}`}
              >
                <span className={styles.continueEyebrow}>Continue learning</span>
                <span className={styles.continueRow}>
                  <span className={styles.continueThumb}>
                    <CourseCover courseId={current.course.id} title={current.course.title} compact />
                  </span>
                  <span className={styles.continueTitle}>{cleanTitle(current.course.title)}</span>
                  <span className={styles.continuePlay} aria-hidden="true">
                    <Play size={12} fill="currentColor" />
                  </span>
                </span>
                <span className={styles.continueProgress}>
                  <span style={{ width: `${current.course.progressPercent}%` }} />
                </span>
                <span className={styles.continueMeta}>
                  {current.course.completedCount}/{current.course.lessonCount} lessons · {current.course.progressPercent}%
                </span>
              </button>
            </div>
          </div>
        )}
        {update.state === 'ready' && (
          <button
            className={styles.updateReady}
            onClick={() => void api().updates.install()}
            title={`IGLAcademy ${update.version} is ready. Restart to update.`}
          >
            <Download size={16} aria-hidden="true" />
            <span className={styles.updateText}>
              <span className={styles.updateTitle}>Restart to update</span>
              <span className={styles.updateMeta}>Version {update.version} is ready</span>
            </span>
          </button>
        )}
        {renderItem(SETTINGS)}
        {version && (
          <div className={styles.reveal} aria-hidden={collapsed || undefined}>
            <div className={styles.revealInner}>
              <div className={styles.version}>Version {version} · stored on this device</div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
