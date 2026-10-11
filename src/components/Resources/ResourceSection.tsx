import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Download, ExternalLink, Eye, FileImage, FileText, File as FileIcon, FolderInput, Search,
} from 'lucide-react';
import type { CourseResource, ResourceKind, ResourceSearchHit } from '../../types';
import { api } from '../../services/api';
import { renderMarkdown } from '../../utils/markdown';
import Modal from '../Modal/Modal';
import styles from './ResourceSection.module.css';

interface Props {
  courseId: number;
}

function kindIcon(kind: ResourceKind) {
  switch (kind) {
    case 'image':
      return <FileImage size={17} />;
    case 'pdf':
      return <FileText size={17} />;
    default:
      return <FileIcon size={17} />;
  }
}

function kindLabel(kind: ResourceKind): string {
  switch (kind) {
    case 'pdf': return 'PDF';
    case 'image': return 'Image';
    case 'text': return 'Text';
    case 'markdown': return 'Markdown';
    case 'subtitle': return 'Subtitles';
    default: return 'File';
  }
}

function formatSize(bytes: number): string {
  if (bytes < 0) return 'missing';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ResourceSection({ courseId }: Props) {
  const [resources, setResources] = useState<CourseResource[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ResourceSearchHit[] | null>(null);
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = () => {
    setLoadError(false);
    api()
      .resources.listForCourse(courseId)
      .then(setResources)
      .catch(() => setLoadError(true));
  };

  useEffect(load, [courseId]);

  const previewResource = resources.find((r) => r.id === previewId) ?? null;

  const openPreview = async (resource: CourseResource) => {
    setPreviewId(resource.id);
    setPreviewUrl(null);
    setPreviewText(null);
    try {
      const url = await api().resources.previewUrl(resource.id);
      // Text-based resources render from their text (theme-friendly).
      if (resource.kind === 'text' || resource.kind === 'markdown' || resource.kind === 'subtitle') {
        setPreviewText(await api().resources.readText(resource.id));
      }
      setPreviewUrl(url);
    } catch {
      // previewUrl stays null -> error state below
    }
  };

  const closePreview = () => {
    setPreviewId(null);
    setPreviewUrl(null);
    setPreviewText(null);
  };

  const handleSearch = (value: string) => {
    setQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = value.trim();
    if (!q) {
      setHits(null);
      return;
    }
    searchTimer.current = setTimeout(() => {
      api()
        .resources.search(courseId, q)
        .then(setHits)
        .catch(() => setHits([]));
    }, 300);
  };

  const grouped = useMemo(() => {
    const map = new Map<string, CourseResource[]>();
    for (const r of resources) {
      const list = map.get(r.sectionTitle) ?? [];
      list.push(r);
      map.set(r.sectionTitle, list);
    }
    return [...map.entries()];
  }, [resources]);

  const visibleHits = hits ?? [];
  const showSearch = query.trim().length > 0;

  if (loadError) {
    return null; // resources are auxiliary; a quiet miss keeps the page clean
  }
  if (resources.length === 0) return null;

  return (
    <section className={styles.section} aria-label="Course resources">
      <div className={styles.sectionHeader}>
        <h2>Resources · {resources.length}</h2>
        <div className={styles.searchWrap}>
          <span className={styles.searchIcon} aria-hidden="true">
            <Search size={15} />
          </span>
          <input
            className={`input ${styles.searchInput}`}
            placeholder="Search resources..."
            aria-label="Search resources"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
          />
        </div>
      </div>

      {showSearch ? (
        <div className={styles.resourceList}>
          {visibleHits.length === 0 && (
            <div className="muted" style={{ fontSize: 13 }}>No resources match "{query.trim()}".</div>
          )}
          {visibleHits.map((hit) => {
            const resource = resources.find((r) => r.id === hit.resourceId);
            if (!resource) return null;
            return (
              <div key={hit.resourceId} className={`card ${styles.resourceRow}`}>
                <span className={styles.resourceIcon}>{kindIcon(hit.kind)}</span>
                <div className={styles.resourceInfo}>
                  <div className={styles.resourceTitle}>{hit.title}</div>
                  {hit.snippet ? (
                    <div className={styles.resourceSnippet}>{hit.snippet}</div>
                  ) : (
                    <div className={styles.resourceMeta}>
                      <span>{kindLabel(hit.kind)}</span>
                    </div>
                  )}
                </div>
                <div className={styles.resourceActions}>
                  <button className="btn btn-ghost btn-sm" onClick={() => openPreview(resource)}>
                    <Eye size={14} /> Preview
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        grouped.map(([sectionTitle, items]) => (
          <div key={sectionTitle}>
            <div className={styles.groupLabel}>{sectionTitle}</div>
            <div className={styles.resourceList}>
              {items.map((resource) => (
                <div key={resource.id} className={`card ${styles.resourceRow}`}>
                  <span className={styles.resourceIcon}>{kindIcon(resource.kind)}</span>
                  <div className={styles.resourceInfo}>
                    <div className={styles.resourceTitle} title={resource.title}>{resource.title}</div>
                    <div className={styles.resourceMeta}>
                      <span>{kindLabel(resource.kind)}</span>
                      <span>·</span>
                      <span>{formatSize(resource.sizeBytes)}</span>
                    </div>
                  </div>
                  <div className={styles.resourceActions}>
                    <button className="btn btn-ghost btn-sm" onClick={() => openPreview(resource)}>
                      <Eye size={14} /> Preview
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      title="Open with system default app"
                      aria-label={`Open ${resource.title} with system app`}
                      onClick={() => void api().resources.open(resource.id)}
                    >
                      <ExternalLink size={14} />
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      title="Download a copy"
                      aria-label={`Download a copy of ${resource.title}`}
                      onClick={() => void api().resources.download(resource.id)}
                    >
                      <Download size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {previewResource && (
        <Modal label={`Preview ${previewResource.title}`} onClose={closePreview} wide>
          <h2>{previewResource.title}</h2>
          <div className={styles.previewBody}>
            {previewResource.kind === 'image' && previewUrl ? (
              <img className={styles.previewImage} src={previewUrl} alt={previewResource.title} />
            ) : previewResource.kind === 'pdf' && previewUrl ? (
              <iframe className={styles.previewFrame} title={previewResource.title} src={previewUrl} />
            ) : previewText !== null ? (
              previewResource.kind === 'markdown' ? (
                <div className={styles.previewMarkdown}>
                  {renderMarkdown(previewText)}
                </div>
              ) : (
                <pre className={styles.previewText}>{previewText}</pre>
              )
            ) : (
              <p className="muted">Preview unavailable — the file may have been moved.</p>
            )}
            <div className={styles.previewActions}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => void api().resources.open(previewResource.id)}
              >
                <ExternalLink size={14} /> Open with system app
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => void api().resources.reveal(previewResource.id)}
              >
                <FolderInput size={14} /> Show in folder
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => void api().resources.download(previewResource.id)}
              >
                <Download size={14} /> Download copy
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
