import { useEffect, useState, type ReactNode } from 'react';
import {
  Database, Download, FileText, FolderOpen, Info, Monitor, Moon,
  RefreshCw, RotateCcw, Save, Sun, Upload, ChevronDown,
} from 'lucide-react';
import { DAILY_GOAL_OPTIONS, PLAYBACK_SPEEDS, type AppSettings, type BackupInfo, type UpdateStatus } from '../../types';
import { api } from '../../services/api';
import { useUpdateStatus } from '../../services/updates';
import { useApp } from '../../App';
import { formatBytes, formatDateTime } from '../../utils/format';
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

function updateText(status: UpdateStatus): string {
  switch (status.state) {
    case 'unsupported':
      return 'This is a development build. Installed releases update themselves.';
    case 'idle':
      return 'New versions download in the background and install when you restart.';
    case 'checking':
      return 'Checking for updates…';
    case 'up-to-date':
      return `You have the latest version. Checked ${formatDateTime(new Date(status.checkedAt).toISOString())}.`;
    case 'downloading':
      return `Downloading version ${status.version}… ${status.percent}%`;
    case 'ready':
      return `Version ${status.version} is ready. Restart IsmaLearn to finish updating, or it installs the next time you close the app.`;
    case 'error':
      return status.message;
  }
}

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
  const { settings, updateSettings, refreshAll, refreshKey } = useApp();
  const [version, setVersion] = useState('');
  const [paths, setPaths] = useState<{ userData: string; dbPath: string } | null>(null);
  const [libraryInfo, setLibraryInfo] = useState<{ courseCount: number; dbSizeBytes: number; dbPath: string } | null>(null);
  const [backups, setBackups] = useState<BackupInfo[]>([]);
  const update = useUpdateStatus();

  useEffect(() => {
    api().app.getVersion().then(setVersion).catch(() => undefined);
    api().app.getPaths().then(setPaths).catch(() => undefined);
    api().app.getLibraryInfo().then(setLibraryInfo).catch(() => undefined);
    api().backup.list().then(setBackups).catch(() => undefined);
    // refreshKey (not refreshAll, which is a stable callback) is what changes
    // after a restore or a reset — the page no longer remounts to pick it up.
  }, [refreshKey]);

  const handleBackupNow = () => {
    void api().backup.now().then(() => {
      api().backup.list().then(setBackups).catch(() => undefined);
    });
  };

  const handleExport = async () => {
    const dest = await api().backup.exportData().catch(() => null);
    if (dest) {
      await api().app.showError('Backup exported', `Saved to:\n${dest}`);
    }
  };

  const handleImportBackup = async () => {
    const result = await api().backup.importData().catch(() => ({ status: 'error' as const, error: 'Import failed.' }));
    if (result.status === 'ok') {
      refreshAll();
      await api().app.showError('Restore complete', 'Your data was restored from backup. The app will now reload its views.');
    } else if (result.status === 'error') {
      await api().app.showError('Restore failed', result.error ?? 'Unknown error');
    }
  };

  return (
    <div className="page page-narrow fade-in">
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Playback, exams, imports and your data. Everything stays on this device.</p>
        </div>
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
        <h2>Exams</h2>
        <div className={styles.settingRow}>
          <div className={styles.settingInfo}>
            <div className={styles.settingLabel}>Passing score</div>
            <div className={styles.settingDesc}>Score required to pass an exam, shown in results and analytics.</div>
          </div>
          <ThemedSelect
            label="Passing score"
            value={String(settings.examPassPercent)}
            onChange={(v) => updateSettings({ examPassPercent: Number(v) })}
          >
            {[50, 60, 65, 70, 75, 80, 85, 90].map((p) => (
              <option key={p} value={p}>{p}%</option>
            ))}
          </ThemedSelect>
        </div>
        <div className={styles.settingRow}>
          <div className={styles.settingInfo}>
            <div className={styles.settingLabel}>Default exam pace</div>
            <div className={styles.settingDesc}>Preselected time limit for timed exams (65 questions ≈ 130 min at 2 min each).</div>
          </div>
          <ThemedSelect
            label="Default exam pace"
            value={String(settings.examSecondsPerQuestion)}
            onChange={(v) => updateSettings({ examSecondsPerQuestion: Number(v) })}
          >
            <option value={60}>1 min / question</option>
            <option value={90}>1.5 min / question</option>
            <option value={120}>2 min / question</option>
            <option value={180}>3 min / question</option>
            <option value={240}>4 min / question</option>
          </ThemedSelect>
        </div>
        <div className={styles.settingRow}>
          <div className={styles.settingInfo}>
            <div className={styles.settingLabel}>Daily study goal</div>
            <div className={styles.settingDesc}>
              Minutes of real study per day — video actually played plus time on practice-exam
              questions. Shown on Home with your streak.
            </div>
          </div>
          <ThemedSelect
            label="Daily study goal"
            value={String(settings.dailyGoalMinutes)}
            onChange={(v) => updateSettings({ dailyGoalMinutes: Number(v) })}
          >
            {DAILY_GOAL_OPTIONS.map((m) => (
              <option key={m} value={m}>{m} min / day</option>
            ))}
          </ThemedSelect>
        </div>
        <div className={styles.settingRow}>
          <div className={styles.settingInfo}>
            <div className={styles.settingLabel}>Turn mistakes into flashcards</div>
            <div className={styles.settingDesc}>
              After each practice exam, questions you got wrong are added to that exam's mistakes deck
              in Review, with the explanation on the back.
            </div>
          </div>
          <SegmentedControl<'on' | 'off'>
            label="Turn mistakes into flashcards"
            value={settings.examMistakesToFlashcards ? 'on' : 'off'}
            onChange={(v) => updateSettings({ examMistakesToFlashcards: v === 'on' })}
            options={[
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ]}
          />
        </div>
      </section>

      <section className={`card ${styles.section}`}>
        <h2>Course imports</h2>
        <div className={styles.settingRow}>
          <div className={styles.settingInfo}>
            <div className={styles.settingLabel}>Rescan library on startup</div>
            <div className={styles.settingDesc}>
              Pick up newly added files in imported course folders whenever the app opens.
            </div>
          </div>
          <SegmentedControl<'on' | 'off'>
            label="Rescan library on startup"
            value={settings.rescanOnStartup ? 'on' : 'off'}
            onChange={(v) => updateSettings({ rescanOnStartup: v === 'on' })}
            options={[
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ]}
          />
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
        <div className={styles.settingRow}>
          <div className={styles.settingInfo}>
            <div className={styles.settingLabel}>Automatic backups</div>
            <div className={styles.settingDesc}>
              Copy the database to a timestamped backup whenever the app starts.
            </div>
          </div>
          <SegmentedControl<'on' | 'off'>
            label="Automatic backups"
            value={settings.autoBackup ? 'on' : 'off'}
            onChange={(v) => updateSettings({ autoBackup: v === 'on' })}
            options={[
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ]}
          />
        </div>
        <div className={styles.settingRow}>
          <div className={styles.settingInfo}>
            <div className={styles.settingLabel}>Backups to keep</div>
            <div className={styles.settingDesc}>Older automatic backups are pruned.</div>
          </div>
          <ThemedSelect
            label="Backups to keep"
            value={String(settings.backupKeep)}
            onChange={(v) => updateSettings({ backupKeep: Number(v) })}
          >
            {[3, 5, 7, 10, 15, 30].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </ThemedSelect>
        </div>
        <div className={styles.settingRow}>
          <div className={styles.settingInfo}>
            <div className={styles.settingLabel}>Back up now</div>
            <div className={styles.settingDesc}>
              {backups.length > 0
                ? `Last backup ${formatDateTime(backups[0].createdAt)} (${formatBytes(backups[0].sizeBytes)}).`
                : 'No backups yet.'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={handleBackupNow}>
              <Save size={14} /> Back up now
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => void api().backup.openFolder()}>
              <FolderOpen size={14} /> Open folder
            </button>
          </div>
        </div>
        <div className={styles.settingRow}>
          <div className={styles.settingInfo}>
            <div className={styles.settingLabel}>Export / import data</div>
            <div className={styles.settingDesc}>
              Export everything to a JSON file, or restore from one (replaces all data after a safety backup).
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={handleExport}>
              <Download size={14} /> Export
            </button>
            <button className="btn btn-ghost btn-sm" onClick={handleImportBackup}>
              <Upload size={14} /> Import
            </button>
          </div>
        </div>
        <div className={styles.settingRow}>
          <div className={styles.settingInfo}>
            <div className={styles.settingLabel}>Diagnostic logs</div>
            <div className={styles.settingDesc}>App and error logs for troubleshooting.</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => void api().app.openLogs()}>
            <FileText size={14} /> Open logs
          </button>
        </div>
      </section>

      <section className={`card ${styles.section}`} aria-label="Updates">
        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <RefreshCw size={16} />
          Updates
        </h2>
        <div className={styles.settingRow}>
          <div className={styles.settingInfo}>
            <div className={styles.settingLabel}>IsmaLearn {version || '—'}</div>
            <div className={styles.settingDesc} data-testid="update-status" aria-live="polite">
              {updateText(update)}
            </div>
            {update.state === 'downloading' && (
              <div className={styles.updateProgress} role="progressbar" aria-valuenow={update.percent} aria-valuemin={0} aria-valuemax={100}>
                <span style={{ width: `${update.percent}%` }} />
              </div>
            )}
          </div>
          {update.state === 'ready' ? (
            <button className="btn btn-primary btn-sm" onClick={() => void api().updates.install()}>
              <RotateCcw size={14} /> Restart to update
            </button>
          ) : update.state !== 'unsupported' ? (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => void api().updates.check().catch(() => undefined)}
              disabled={update.state === 'checking' || update.state === 'downloading'}
            >
              <RefreshCw size={14} /> Check now
            </button>
          ) : null}
        </div>
        <div className={styles.settingRow}>
          <div className={styles.settingInfo}>
            <div className={styles.settingLabel}>Check for updates automatically</div>
            <div className={styles.settingDesc}>
              Look for a new version on GitHub when the app starts and every few hours. Nothing about
              your library is sent.
            </div>
          </div>
          <SegmentedControl<'on' | 'off'>
            label="Check for updates automatically"
            value={settings.autoUpdate ? 'on' : 'off'}
            onChange={(v) => updateSettings({ autoUpdate: v === 'on' })}
            options={[
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ]}
          />
        </div>
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
