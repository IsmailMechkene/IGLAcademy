import { useState } from 'react';
import { Search, FolderOpen } from 'lucide-react';
import { useApp } from '../../App';
import { api } from '../../services/api';
import styles from './Topbar.module.css';

const TITLES: Record<string, string> = {
  dashboard: 'Dashboard',
  library: 'My Courses',
  'in-progress': 'In Progress',
  completed: 'Completed',
  notes: 'Notes',
  settings: 'Settings',
};

export default function Topbar() {
  const { route, navigate, refreshAll, searchQuery, setSearchQuery } = useApp();
  const [importing, setImporting] = useState(false);

  const handleImport = async () => {
    setImporting(true);
    try {
      const result = await api().courses.import();
      if (result.status === 'imported') {
        refreshAll();
        navigate({ name: 'course', courseId: result.courseId! });
      } else if (result.status === 'duplicate') {
        refreshAll();
        navigate({ name: 'course', courseId: result.courseId! });
      } else if (result.status === 'error') {
        await api().app.showError('Import failed', result.error ?? 'Unknown error');
      }
    } catch (err) {
      await api().app.showError('Import failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setImporting(false);
    }
  };

  const handleSearch = (value: string) => {
    setSearchQuery(value);
    // Typing in global search jumps to the library, which filters by it
    if (value && route.name !== 'library' && route.name !== 'in-progress' && route.name !== 'completed') {
      navigate({ name: 'library' });
    }
  };

  const title = TITLES[route.name] ?? 'IsmaLearn';

  return (
    <header className={styles.topbar}>
      <div className={styles.searchWrap}>
        <span className={styles.searchIcon}>
          <Search size={16} />
        </span>
        <input
          className={`input ${styles.searchInput}`}
          placeholder="Search courses..."
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
        />
      </div>
      <div className={styles.spacer} />
      <span className={styles.title}>{title}</span>
      <button className="btn btn-primary" onClick={handleImport} disabled={importing}>
        <FolderOpen size={16} />
        {importing ? 'Importing...' : 'Import Course'}
      </button>
    </header>
  );
}
