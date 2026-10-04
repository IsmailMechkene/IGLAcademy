import { useEffect, useState } from 'react';
import {
  GraduationCap, Home, BookOpen, PlayCircle, CheckCircle2, FileCheck, Brain, StickyNote, Settings as SettingsIcon,
} from 'lucide-react';
import { useApp } from '../../App';
import type { Route } from '../../App';
import { api } from '../../services/api';
import styles from './Sidebar.module.css';

interface NavItem {
  label: string;
  icon: typeof Home;
  route: Route;
  match: (route: Route) => boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Home', icon: Home, route: { name: 'dashboard' }, match: (r) => r.name === 'dashboard' },
  { label: 'My Courses', icon: BookOpen, route: { name: 'library' }, match: (r) => r.name === 'library' || r.name === 'course' || r.name === 'player' },
  { label: 'Practice Exams', icon: FileCheck, route: { name: 'practice' }, match: (r) => r.name === 'practice' || r.name === 'examfile' || r.name === 'examstats' },
  { label: 'In Progress', icon: PlayCircle, route: { name: 'in-progress' }, match: (r) => r.name === 'in-progress' },
  { label: 'Completed', icon: CheckCircle2, route: { name: 'completed' }, match: (r) => r.name === 'completed' },
  { label: 'Review', icon: Brain, route: { name: 'review' }, match: (r) => r.name === 'review' },
  { label: 'Notes', icon: StickyNote, route: { name: 'notes' }, match: (r) => r.name === 'notes' },
  { label: 'Settings', icon: SettingsIcon, route: { name: 'settings' }, match: (r) => r.name === 'settings' },
];

export default function Sidebar() {
  const { route, navigate } = useApp();
  const [version, setVersion] = useState('');

  useEffect(() => {
    api()
      .app.getVersion()
      .then(setVersion)
      .catch(() => undefined);
  }, []);

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo}>
        <div className={styles.logoIcon}>
          <GraduationCap size={20} strokeWidth={2.2} />
        </div>
        <div className={styles.logoText}>
          <span className={styles.logoName}>IsmaLearn</span>
          <span className={styles.logoTag}>Your courses. Your pace.</span>
        </div>
      </div>

      <nav className={styles.nav}>
        {NAV_ITEMS.map((item) => {
          const active = item.match(route);
          const Icon = item.icon;
          return (
            <button
              key={item.label}
              className={`${styles.navItem} ${active ? styles.active : ''}`}
              onClick={() => navigate(item.route)}
            >
              <span className={styles.navIcon}>
                <Icon size={18} strokeWidth={active ? 2.4 : 2} />
              </span>
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className={styles.sidebarFooter}>
        {version && <div className={styles.version}>v{version}</div>}
      </div>
    </aside>
  );
}
