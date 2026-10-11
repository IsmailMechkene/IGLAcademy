import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, BarChart3, ChevronRight, Clock3, FileCheck, FileUp, FolderOpen, FolderPlus, History,
  PlayCircle, Trash2, X,
} from 'lucide-react';
import type { ExamSource, PracticeExamFile, QuizAttemptDetail, QuizAttemptSummary } from '../../types';
import { api } from '../../services/api';
import { useApp } from '../../App';
import { formatDate, formatDateTime } from '../../utils/format';
import { examGroupInfo, shortExamTitle } from '../../utils/titles';
import QuizReview from '../../components/Quiz/QuizReview';
import LoadError from '../../components/LoadError/LoadError';
import Modal from '../../components/Modal/Modal';
import styles from './PracticeExams.module.css';

interface ExamGroup {
  key: string;
  name: string;
  code: string | null;
  files: PracticeExamFile[];
}

export default function PracticeExams() {
  const { navigate, refreshKey, settings } = useApp();
  const [sources, setSources] = useState<ExamSource[]>([]);
  const [files, setFiles] = useState<PracticeExamFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [historyFile, setHistoryFile] = useState<PracticeExamFile | null>(null);
  const [history, setHistory] = useState<QuizAttemptSummary[]>([]);
  const [review, setReview] = useState<{ attempt: QuizAttemptDetail; title: string } | null>(null);
  const [removingSource, setRemovingSource] = useState<ExamSource | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = () => {
    setLoading(true);
    setLoadError(false);
    Promise.all([api().practice.listSources(), api().practice.scan()])
      .then(([s, f]) => {
        setSources(s);
        setFiles(f);
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  };

  useEffect(load, [refreshKey]);

  const groups = useMemo<ExamGroup[]>(() => {
    const map = new Map<string, ExamGroup>();
    for (const file of files) {
      // The title usually names the certification; when it does not carry a
      // known exam code, the folder name often does ("… CLF-C02").
      let info = examGroupInfo(file.title);
      if (!info.code) {
        const folder = file.filePath.split(/[\\/]/).slice(-2, -1)[0] ?? '';
        const fromFolder = examGroupInfo(folder);
        if (fromFolder.code && fromFolder.name !== fromFolder.code) info = fromFolder;
      }
      const key = info.code ?? info.name;
      const group = map.get(key) ?? { key, name: info.name, code: info.code, files: [] };
      group.files.push(file);
      map.set(key, group);
    }
    return [...map.values()];
  }, [files]);

  // If the selected certification disappears (source removed), fall back.
  const selected = selectedKey !== null
    ? groups.find((g) => g.key === selectedKey) ?? null
    : null;

  const openHistory = async (file: PracticeExamFile) => {
    try {
      const attempts = await api().practice.history(file.filePath);
      setHistory(attempts);
      setHistoryFile(file);
      setReview(null);
    } catch (err) {
      await api().app.showError('History unavailable', err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const openReview = async (file: PracticeExamFile, attemptId: number) => {
    try {
      const detail = await api().practice.attemptDetail(attemptId);
      if (!detail) throw new Error('This attempt no longer exists.');
      if (detail.unavailableReason) {
        await api().app.showError('Review unavailable', detail.unavailableReason);
        return;
      }
      setReview({ attempt: detail, title: file.title });
    } catch (err) {
      await api().app.showError('Review unavailable', err instanceof Error ? err.message : 'Unknown error');
    }
  };

  const handleAddFolder = async () => {
    setWorking(true);
    try {
      await api().practice.addFolder();
    } finally {
      setWorking(false);
      load();
    }
  };

  const handleAddFile = async () => {
    setWorking(true);
    try {
      await api().practice.addFile();
    } finally {
      setWorking(false);
      load();
    }
  };

  const groupStats = (group: ExamGroup) => {
    const bests = group.files.map((f) => f.bestPercent).filter((b): b is number => b !== null);
    const attempted = group.files.filter((f) => f.attemptCount > 0).length;
    const questions = group.files.reduce((s, f) => s + f.questionCount, 0);
    return {
      total: group.files.length,
      attempted,
      questions,
      avg: bests.length > 0 ? Math.round(bests.reduce((s, b) => s + b, 0) / bests.length) : null,
    };
  };

  return (
    <div className="page fade-in">
      <div className="page-header">
        <div>
          <h1>Practice Exams</h1>
          <p>Timed and practice runs of your HTML practice tests — read live, never copied.</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={handleAddFile} disabled={working}>
            <FileUp size={15} />
            Add file
          </button>
          <button className="btn btn-primary" onClick={handleAddFolder} disabled={working}>
            <FolderPlus size={16} />
            {working ? 'Working…' : 'Add folder'}
          </button>
        </div>
      </div>

      {sources.length > 0 && (
        <div className={styles.sourcesBar} aria-label="Registered exam sources">
          <span className={styles.sourcesLabel}>Sources</span>
          {sources.map((s) => (
            <span key={s.id} className={styles.sourceChip} title={s.path}>
              {s.kind === 'file' ? <FileUp size={13} /> : <FolderOpen size={13} />}
              <span className={styles.sourcePath}>{shortenPath(s.path)}</span>
              <button
                className={styles.sourceRemove}
                title={`Remove ${s.path}`}
                aria-label={`Remove exam source ${s.path}`}
                onClick={() => setRemovingSource(s)}
              >
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      )}

      {loading ? (
        <div className="muted">Scanning exam files...</div>
      ) : loadError ? (
        <LoadError message="Could not load your practice exams." onRetry={load} />
      ) : files.length === 0 ? (
        <div className={`card emptyState ${styles.emptyCard}`}>
          <div className="emptyIcon">
            <FileCheck size={30} strokeWidth={1.8} />
          </div>
          <h2>No practice exams yet</h2>
          <p>
            Register a folder of HTML practice tests (or a single file) and they will
            appear here, grouped by certification.
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-primary" onClick={handleAddFile} disabled={working}>
              <FileUp size={16} />
              Add file
            </button>
            <button className="btn btn-ghost" onClick={handleAddFolder} disabled={working}>
              <FolderPlus size={16} />
              Add folder
            </button>
          </div>
        </div>
      ) : selected ? (
        <section aria-label={selected.name}>
          <button className="btn btn-ghost btn-sm" onClick={() => setSelectedKey(null)} style={{ marginBottom: 18 }}>
            <ArrowLeft size={14} /> All certifications
          </button>
          <div className={styles.groupHeader}>
            <span className={styles.groupIcon}><FileCheck size={22} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2>{selected.name}</h2>
              <span className={styles.groupMeta}>
                {selected.code && <span className="badge">{selected.code}</span>}
                {selected.files.length} test{selected.files.length === 1 ? '' : 's'} ·{' '}
                {selected.files.reduce((n, f) => n + f.questionCount, 0)} questions
              </span>
            </div>
          </div>
          <div className={styles.examList}>
            {selected.files.map((file) => (
              <div key={file.filePath} className={`card ${styles.examRow}`}>
                <div className={styles.examScore} data-state={file.bestPercent === null ? 'none' : file.bestPercent >= settings.examPassPercent ? 'pass' : 'fail'}>
                  {file.bestPercent === null ? '—' : `${file.bestPercent}%`}
                  <span>best</span>
                </div>
                <div className={styles.examInfo}>
                  <div className={styles.examTitle} title={file.title}>{shortExamTitle(file.title, selected)}</div>
                  <div className={styles.examMeta}>
                    <span>{file.questionCount} questions</span>
                    {file.multiCount > 0 && (
                      <>
                        <span>·</span>
                        <span>{file.multiCount} multi-select</span>
                      </>
                    )}
                    <span>·</span>
                    {file.error ? (
                      <span style={{ color: 'var(--danger)' }}>Unsupported file</span>
                    ) : file.bestPercent !== null ? (
                      <span
                        className={styles.bestScore}
                        style={{ color: file.bestPercent >= settings.examPassPercent ? 'var(--success)' : 'var(--warning)' }}
                      >
                        Best {file.bestPercent}%
                      </span>
                    ) : (
                      <span>Not attempted yet</span>
                    )}
                    {file.attemptCount > 0 && (
                      <>
                        <span>·</span>
                        <span>
                          {file.attemptCount} attempt{file.attemptCount === 1 ? '' : 's'}
                          {file.lastAttemptAt ? ` · last ${formatDate(file.lastAttemptAt)}` : ''}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <div className={styles.examActions}>
                  {!file.error && (
                    <button
                      className="btn btn-soft btn-sm"
                      onClick={() => navigate({ name: 'examfile', filePath: file.filePath })}
                    >
                      <PlayCircle size={14} /> {file.attemptCount > 0 ? 'Retake' : 'Start'}
                    </button>
                  )}
                  <button
                    className="iconBtn"
                    title="Review this exam later"
                    aria-label={`Review ${file.title} later`}
                    onClick={() => {
                      void api().review.add({
                        courseId: null,
                        kind: 'exam',
                        refId: file.filePath,
                        title: file.title,
                      });
                    }}
                  >
                    <Clock3 size={14} />
                  </button>
                  {file.attemptCount > 0 && (
                    <>
                      <button
                        className="iconBtn"
                        title="Exam analytics"
                        aria-label={`Analytics for ${file.title}`}
                        onClick={() => navigate({ name: 'examstats', filePath: file.filePath })}
                      >
                        <BarChart3 size={14} />
                      </button>
                      <button
                        className="iconBtn"
                        title="Attempt history"
                        aria-label={`Attempt history for ${file.title}`}
                        onClick={() => openHistory(file)}
                      >
                        <History size={14} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <div className={styles.certGrid}>
          {groups.map((group) => {
            const stats = groupStats(group);
            return (
              <button
                key={group.key}
                type="button"
                className={`card ${styles.certCard}`}
                onClick={() => setSelectedKey(group.key)}
                aria-label={`${group.name}: ${stats.total} tests. View tests.`}
              >
                <span className={styles.certTop}>
                  <span className={styles.certIcon}>
                    <FileCheck size={20} />
                  </span>
                  {group.code && <span className="badge">{group.code}</span>}
                  <ChevronRight size={16} className={styles.certChevron} aria-hidden="true" />
                </span>
                <span className={styles.certName}>{group.name}</span>
                <span className={styles.certStats}>
                  {stats.total} test{stats.total === 1 ? '' : 's'} · {stats.questions} questions
                </span>
                <span className={styles.certProgress}>
                  <span className={styles.certProgressRow}>
                    <span>
                      {stats.attempted === 0 ? 'Not attempted yet' : `${stats.attempted} of ${stats.total} attempted`}
                    </span>
                    {stats.avg !== null && <strong>avg best {stats.avg}%</strong>}
                  </span>
                  <span className={styles.certBar}>
                    <span style={{ width: `${stats.total ? (stats.attempted / stats.total) * 100 : 0}%` }} />
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {removingSource && (
        <Modal label="Remove exam source" onClose={() => setRemovingSource(null)}>
          <h2>Remove exam source?</h2>
          <p>
            <strong>{shortenPath(removingSource.path)}</strong> will no longer be scanned,
            and its recorded attempts will be deleted. Your files are not touched.
          </p>
          <div className={styles.dialogActions}>
            <button className="btn btn-ghost" onClick={() => setRemovingSource(null)}>Cancel</button>
            <button
              className="btn btn-danger"
              data-autofocus
              onClick={() => {
                void api().practice.removeSource(removingSource.id).then(() => {
                  setRemovingSource(null);
                  load();
                });
              }}
            >
              <Trash2 size={15} /> Remove
            </button>
          </div>
        </Modal>
      )}

      {historyFile && !review && (
        <Modal label={`Attempt history for ${historyFile.title}`} onClose={() => setHistoryFile(null)} wide>
          <h2>Attempt history</h2>
          <p className="muted" style={{ margin: 0 }}>{historyFile.title}</p>
          <div className={styles.resultList}>
            {history.length === 0 && <p className="muted">No attempts recorded.</p>}
            {history.map((a) => (
              <div key={a.id} className={styles.historyRow}>
                <span
                  className={styles.bestScore}
                  style={{ color: a.percent >= settings.examPassPercent ? 'var(--success)' : 'var(--danger)' }}
                >
                  {a.percent}%
                </span>
                <span className="secondary" style={{ fontSize: 13 }}>
                  {a.score}/{a.total} correct
                </span>
                <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>
                  {formatDateTime(a.createdAt)}
                </span>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => openReview(historyFile, a.id)}
                >
                  Review
                </button>
              </div>
            ))}
          </div>
          <div className={styles.dialogActions}>
            <button className="btn btn-ghost" onClick={() => setHistoryFile(null)}>
              <ArrowLeft size={14} /> Back
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                setHistoryFile(null);
                navigate({ name: 'examfile', filePath: historyFile.filePath });
              }}
            >
              <PlayCircle size={14} /> New attempt
            </button>
          </div>
        </Modal>
      )}

      {review && (
        <Modal label="Attempt review" onClose={() => setReview(null)} wide>
          <QuizReview
            attempt={review.attempt}
            quizTitle={review.title}
            onClose={() => setReview(null)}
          />
        </Modal>
      )}
    </div>
  );
}

function shortenPath(full: string): string {
  const parts = full.split(/[/\\]/).filter(Boolean);
  if (parts.length <= 3) return full;
  return `…/${parts.slice(-3).join('/')}`;
}
