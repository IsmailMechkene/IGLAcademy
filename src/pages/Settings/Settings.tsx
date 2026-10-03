import { useEffect, useState, type ReactNode } from 'react';
import { Database, Info, Monitor, Moon, RotateCcw, Sun, ChevronDown } from 'lucide-react';
import { PLAYBACK_SPEEDS, type AppSettings } from '../../types';
import { api } from '../../services/api';
import { useApp } from '../../App';
import { formatBytes } from '../../utils/format';
import SegmentedControl, { type SegmentOption } from '../../components/SegmentedControl/SegmentedControl';
import styles from './Settings.module.css';

const THEME_OPTIONS: Array<SegmentOption<AppSettings['theme']>> = [
  { value: 'dark', label: 'Dark', icon: <Moon size={14} /> },
  { value: 'light', label: 'Light', icon: <Sun size={14} /> },
  { value: 'system', label: 'System', icon: <Monitor size={14} /> },
];

const SPEED_OPTIONS: Array<SegmentOption<number>> = PLAYBACK_SPEEDS.map((s) => ({
  value: s,
  label: `${s}×`,
}));

function ThemedSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <span className="selectWrap">
      <select
        className="select"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {children}
      </select>
      <ChevronDown size={15} aria-hidden="true" />
    </span>
  );
}

export default function Settings() {
  const { settings, updateSettings, refreshAll } = useApp();
  const [version, setVersion] = useState('');
  const [paths, setPaths] = useState<{ userData: string; dbPath: string } | null>(null);
  const [libraryInfo, setLibraryInfo] = useState<{ courseCount: number; dbSizeBytes: number; dbPath: string } | null>(null);

  useEffect(() => {
    api().app.getVersion().then(setVersion).catch(() => undefined);
    api().app.getPaths().then(setPaths).catch(() => undefined);
    api().app.getLibraryInfo().then(setLibraryInfo).catch(() => undefined);
  }, [refreshAll]);

  return (
    <div className={`fade-in ${styles.page}`}>
      <div className={styles.header}>
        <h1>Settings</h1>
      </div>

      <section className={`card ${styles.section}`}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {settings.theme === 'light' ? <Sun size={16} /> : settings.theme === 'system' ? <Monitor size={16} /> : <Moon size={16} />}
          Appearance
        </h2>
        <div className={styles.settingRow}>
          <div className={styles.settingInfo}>
            <div className={styles.settingLabel}>Theme</div>
            <div className={styles.settingDesc}>System follows your OS light/dark setting automatically.</div>
          </div>
          <SegmentedControl
            label="Theme"
            value={settings.theme}
            onChange={(theme) => updateSettings({ theme })}
            options={THEME_OPTIONS}
          />
        </div>
      </section>

      <section className={`card ${styles.section}`}>
        <h2>Playback</h2>
        <div className={styles.settingRow}>
          <div className={styles.settingInfo}>
            <div className={styles.settingLabel}>Default playback speed</div>
            <div className={styles.settingDesc}>Applied to every lesson you open.</div>
          </div>
          <SegmentedControl
            label="Default playback speed"
            value={settings.defaultPlaybackSpeed}
            onChange={(speed) => updateSettings({ defaultPlaybackSpeed: speed })}
            options={SPEED_OPTIONS}
          />
        </div>
        <div className={styles.settingRow}>
          <div className={styles.settingInfo}>
            <div className={styles.settingLabel}>Resume playback</div>
            <div className={styles.settingDesc}>
              Decide what happens when you reopen a lesson you have already started.
            </div>
          </div>
          <ThemedSelect
            label="Resume playback"
            value={settings.resumePlayback}
            onChange={(v) => updateSettings({ resumePlayback: v as AppSettings['resumePlayback'] })}
          >
            <option value="ask">Always ask</option>
            <option value="always">Always resume</option>
            <option value="never">Always start from beginning</option>
          </ThemedSelect>
        </div>
      </section>

      <section className={`card ${styles.section}`}>
        <h2>Course imports</h2>
        <div className={styles.settingRow}>
          <div className={styles.settingInfo}>
            <div className={styles.settingLabel}>When a duplicate course is imported</div>
            <div className={styles.settingDesc}>
              IsmaLearn detects when you import a folder that is already in your library.
            </div>
          </div>
          <ThemedSelect
            label="When a duplicate course is imported"
            value={settings.duplicateImportBehavior}
            onChange={(v) => updateSettings({ duplicateImportBehavior: v as AppSettings['duplicateImportBehavior'] })}
          >
            <option value="ask">Show options</option>
            <option value="skip">Skip import</option>
            <option value="rescan">Rescan existing course</option>
          </ThemedSelect>
        </div>
      </section>

      <section className={`card ${styles.section}`}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Database size={16} />
          Data and storage
        </h2>
        <div className={styles.infoGrid}>
          <div className={styles.infoItem}>
            <span className={styles.infoLabel}>Application version</span>
            <span className={styles.infoValue}>{version || '—'}</span>
          </div>
          <div className={styles.infoItem}>
            <span className={styles.infoLabel}>Courses in library</span>
            <span className={styles.infoValue}>{libraryInfo?.courseCount ?? 0}</span>
          </div>
          <div className={styles.infoItem}>
            <span className={styles.infoLabel}>Database size</span>
            <span className={styles.infoValue}>
              {libraryInfo ? formatBytes(libraryInfo.dbSizeBytes) : '—'}
            </span>
          </div>
          <div className={styles.infoItem}>
            <span className={styles.infoLabel}>Database location</span>
            <span className={styles.infoValue} style={{ fontSize: 12 }}>
              {paths?.dbPath ?? '—'}
            </span>
          </div>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
          All data — progress, notes, quizzes and settings — is stored locally in SQLite.
          Your course files are never copied or modified.
        </p>
      </section>

      <section className={`card ${styles.section} ${styles.dangerZone}`}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <RotateCcw size={16} />
          Reset
        </h2>
        <div className={styles.settingRow}>
          <div className={styles.settingInfo}>
            <div className={styles.settingLabel}>Reset all settings</div>
            <div className={styles.settingDesc}>
              Restores default theme, playback and import settings. Your courses, progress and notes are kept.
            </div>
          </div>
          <button
            className="btn btn-ghost"
            onClick={() => {
              void api().settings.reset().then(refreshAll);
            }}
          >
            <RotateCcw size={14} /> Reset settings
          </button>
        </div>
      </section>

      <section className={`card ${styles.section}`}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Info size={16} />
          About
        </h2>
        <p className="secondary" style={{ margin: 0, fontSize: 13 }}>
          <strong>IsmaLearn</strong> — Your courses. Your pace. Your progress.
          A local-first learning platform for studying downloaded courses offline.
        </p>
      </section>
    </div>
  );
}
