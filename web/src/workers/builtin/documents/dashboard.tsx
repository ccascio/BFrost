import { useEffect, useRef, useState } from 'react';
import type { WorkerDashboardViewDefinition } from '../../types';

interface DocumentFile {
  id: string;
  filename: string;
  size: number;
  chunkCount: number;
  createdAt: string;
}

interface DocumentChunk {
  id: string;
  ordinal: number;
  text: string;
  hasEmbedding: boolean;
  charCount: number;
}

type UploadPhase =
  | { name: 'idle' }
  | { name: 'reading' }
  | { name: 'uploading'; pct: number }
  | { name: 'indexing' }
  | { name: 'done'; chunkCount: number }
  | { name: 'error'; message: string };

type DetailNav = 'overview' | number;

function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

const STYLE_ID = 'bfrost-docs-modal-styles';
const STYLES = `
/* ── overlay & shell ── */
.docs-modal-overlay {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center;
}
.docs-modal {
  background: var(--surface, #1e1e2e);
  border: 1px solid var(--border, #2a2a3e);
  border-radius: 12px;
  width: min(780px, 96vw);
  max-height: 84vh;
  display: flex; flex-direction: column;
  box-shadow: 0 20px 60px rgba(0,0,0,0.45);
  overflow: hidden;
}
.docs-modal-header {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.875rem 1.25rem;
  border-bottom: 1px solid var(--border, #2a2a3e);
  flex-shrink: 0;
}
.docs-modal-back {
  background: none; border: none; cursor: pointer;
  color: var(--muted, #888); padding: 0.2rem 0.4rem;
  border-radius: 4px; font-size: 0.85rem; line-height: 1;
}
.docs-modal-back:hover { color: var(--fg, #eee); background: rgba(255,255,255,0.06); }
.docs-modal-title { margin: 0; font-size: 0.95rem; font-weight: 600; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.docs-modal-close {
  background: none; border: none; cursor: pointer; flex-shrink: 0;
  color: var(--muted, #888); font-size: 1rem; padding: 0.25rem 0.45rem;
  line-height: 1; border-radius: 4px;
}
.docs-modal-close:hover { color: var(--fg, #eee); background: rgba(255,255,255,0.06); }

/* ── file list view ── */
.docs-modal-body {
  flex: 1; overflow-y: auto; padding: 0.75rem 1.25rem;
  min-height: 0;
}
.docs-file-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
.docs-file-table th {
  text-align: left; color: var(--muted, #888);
  font-weight: 500; font-size: 0.72rem; text-transform: uppercase;
  letter-spacing: 0.05em; padding: 0 0.5rem 0.5rem;
  border-bottom: 1px solid var(--border, #2a2a3e);
}
.docs-file-table td {
  padding: 0.55rem 0.5rem;
  border-bottom: 1px solid color-mix(in srgb, var(--border, #2a2a3e) 50%, transparent);
  vertical-align: middle;
}
.docs-file-table tbody tr:last-child td { border-bottom: none; }
.docs-file-table tbody tr { cursor: pointer; transition: background 0.1s; }
.docs-file-table tbody tr:hover td { background: rgba(255,255,255,0.03); }
.docs-file-name { font-weight: 500; word-break: break-all; max-width: 240px; }
.docs-file-meta { color: var(--muted, #888); white-space: nowrap; }
.docs-file-delete {
  background: none; border: none; cursor: pointer;
  color: var(--muted, #888); padding: 0.2rem 0.45rem; border-radius: 4px;
  transition: color 0.15s, background 0.15s; font-size: 0.8rem;
}
.docs-file-delete:hover { color: var(--warning, #f59e0b); background: rgba(245,158,11,0.12); }
.docs-file-delete:disabled { opacity: 0.4; cursor: not-allowed; }
.docs-empty {
  text-align: center; padding: 2.5rem 1rem;
  color: var(--muted, #888); font-size: 0.875rem; margin: 0;
}

/* ── upload footer ── */
.docs-modal-footer {
  border-top: 1px solid var(--border, #2a2a3e);
  padding: 1rem 1.25rem; flex-shrink: 0;
}
.docs-drop-zone {
  border: 2px dashed var(--border, #2a2a3e);
  border-radius: 8px; padding: 1.1rem 1rem;
  text-align: center; cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  position: relative; overflow: hidden;
}
.docs-drop-zone:hover, .docs-drop-zone.drag-over {
  border-color: var(--brand, #6366f1); background: rgba(99,102,241,0.05);
}
.docs-drop-zone.uploading { cursor: default; opacity: 0.6; pointer-events: none; }
.docs-drop-zone input[type="file"] {
  position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%;
}
.docs-drop-zone-text { color: var(--muted, #888); font-size: 0.85rem; pointer-events: none; margin: 0; }
.docs-drop-zone-text strong { color: var(--fg, #eee); }
.docs-drop-hint { font-size: 0.75rem; margin-top: 0.2rem; color: var(--muted, #888); pointer-events: none; }
.docs-progress { padding: 0.625rem 0 0; }
.docs-phase-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.3rem; }
.docs-phase { display: flex; align-items: center; gap: 0.6rem; font-size: 0.8rem; color: var(--muted, #888); }
.docs-phase.active { color: var(--fg, #eee); }
.docs-phase.done-step { color: var(--good, #4ade80); }
.docs-phase-icon { width: 1rem; text-align: center; flex-shrink: 0; font-size: 0.75rem; }
.docs-phase-bar { margin-top: 0.4rem; height: 3px; background: var(--border, #2a2a3e); border-radius: 2px; overflow: hidden; }
.docs-phase-bar-fill { height: 100%; background: var(--brand, #6366f1); border-radius: 2px; transition: width 0.15s; }
.docs-done-msg { margin: 0; font-size: 0.8rem; color: var(--good, #4ade80); padding-top: 0.625rem; }
.docs-err-msg  { margin: 0; font-size: 0.8rem; color: var(--warning, #f59e0b); padding-top: 0.625rem; }

/* ── detail split layout ── */
.docs-detail {
  flex: 1; display: flex; min-height: 0; overflow: hidden;
}
.docs-detail-nav {
  width: 88px; flex-shrink: 0;
  border-right: 1px solid var(--border, #2a2a3e);
  overflow-y: auto; padding: 0.625rem 0.5rem;
  display: flex; flex-direction: column; gap: 0.5rem;
}
.docs-detail-nav-section { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted, #888); padding: 0 0.15rem; }
.docs-nav-icon {
  width: 100%; aspect-ratio: 1;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  border-radius: 6px; cursor: pointer; border: 1px solid transparent;
  font-size: 1.3rem; gap: 0.15rem;
  transition: background 0.12s, border-color 0.12s;
  background: rgba(255,255,255,0.03);
}
.docs-nav-icon:hover { background: rgba(255,255,255,0.07); }
.docs-nav-icon.active { background: rgba(99,102,241,0.15); border-color: rgba(99,102,241,0.4); }
.docs-nav-icon-label { font-size: 0.6rem; color: var(--muted, #888); pointer-events: none; }
.docs-nav-icon.active .docs-nav-icon-label { color: var(--brand, #6366f1); }
.docs-nav-divider { height: 1px; background: var(--border, #2a2a3e); margin: 0.1rem 0; }
.docs-chunk-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
.docs-chunk-btn {
  display: flex; align-items: center; justify-content: center;
  aspect-ratio: 1; border-radius: 5px; cursor: pointer;
  font-size: 0.65rem; font-weight: 700; border: 1px solid transparent;
  background: rgba(255,255,255,0.04); color: var(--muted, #888);
  transition: background 0.1s, border-color 0.1s, color 0.1s;
}
.docs-chunk-btn:hover { background: rgba(255,255,255,0.08); color: var(--fg, #eee); }
.docs-chunk-btn.active { background: rgba(99,102,241,0.15); border-color: rgba(99,102,241,0.4); color: var(--brand, #6366f1); }
.docs-chunk-btn.embedded::after { content: ''; display: block; width: 4px; height: 4px; border-radius: 50%; background: var(--good, #4ade80); position: absolute; top: 3px; right: 3px; }
.docs-chunk-btn { position: relative; }

/* ── detail content pane ── */
.docs-detail-content {
  flex: 1; overflow-y: auto; padding: 1.25rem 1.5rem; min-width: 0;
}
.docs-detail-kicker { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted, #888); margin: 0 0 0.4rem; }
.docs-detail-heading { font-size: 1rem; font-weight: 600; margin: 0 0 1rem; word-break: break-all; }
.docs-meta-grid {
  display: grid; grid-template-columns: max-content 1fr; gap: 0.3rem 1rem;
  font-size: 0.8rem; margin-bottom: 1.25rem;
}
.docs-meta-label { color: var(--muted, #888); white-space: nowrap; }
.docs-meta-value { color: var(--fg, #eee); }
.docs-section-label {
  font-size: 0.72rem; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.06em; color: var(--muted, #888); margin: 0 0 0.5rem;
}
.docs-summary-text {
  font-size: 0.85rem; line-height: 1.65;
  white-space: pre-wrap; word-break: break-word;
  color: var(--fg, #eee);
}
.docs-summary-loading {
  display: flex; align-items: center; gap: 0.5rem;
  font-size: 0.8rem; color: var(--muted, #888);
}
.docs-regen-btn {
  background: none; border: 1px solid var(--border, #2a2a3e); cursor: pointer;
  color: var(--muted, #888); font-size: 0.72rem; padding: 0.2rem 0.6rem;
  border-radius: 4px; margin-top: 0.75rem; transition: color 0.12s, border-color 0.12s;
}
.docs-regen-btn:hover { color: var(--fg, #eee); border-color: var(--brand, #6366f1); }
.docs-chunk-text {
  font-size: 0.82rem; line-height: 1.7;
  white-space: pre-wrap; word-break: break-word;
  background: rgba(255,255,255,0.03); border: 1px solid var(--border, #2a2a3e);
  border-radius: 6px; padding: 0.875rem 1rem; color: var(--fg, #eee);
}
.docs-embed-badge {
  display: inline-flex; align-items: center; gap: 0.3rem;
  font-size: 0.72rem; padding: 0.15rem 0.5rem; border-radius: 999px;
  border: 1px solid;
}
.docs-embed-badge.yes { color: var(--good, #4ade80); border-color: color-mix(in srgb, var(--good, #4ade80) 35%, transparent); background: color-mix(in srgb, var(--good, #4ade80) 8%, transparent); }
.docs-embed-badge.no  { color: var(--muted, #888); border-color: var(--border, #2a2a3e); }

@keyframes docs-spin { to { transform: rotate(360deg); } }
.docs-spinner {
  display: inline-block; width: 0.7rem; height: 0.7rem;
  border: 1.5px solid currentColor; border-top-color: transparent;
  border-radius: 50%; animation: docs-spin 0.65s linear infinite;
  vertical-align: middle;
}
`;

function ensureStyles() {
  if (typeof document !== 'undefined' && !document.getElementById(STYLE_ID)) {
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = STYLES;
    document.head.appendChild(el);
  }
}

ensureStyles();

const PHASE_ORDER = ['reading', 'uploading', 'indexing'];
const PHASE_STEPS = [
  { key: 'reading', label: 'Reading file' },
  { key: 'uploading', label: 'Uploading' },
  { key: 'indexing', label: 'Indexing' },
];

function UploadProgress({ phase }: { phase: UploadPhase }) {
  if (phase.name === 'idle') return null;
  if (phase.name === 'done') {
    return <p className="docs-done-msg">✓ Uploaded — {phase.chunkCount} chunk{phase.chunkCount === 1 ? '' : 's'} indexed.</p>;
  }
  if (phase.name === 'error') {
    return <p className="docs-err-msg">✕ {phase.message}</p>;
  }
  const activeIdx = PHASE_ORDER.indexOf(phase.name);
  const uploadPct = phase.name === 'uploading' ? phase.pct : 0;
  return (
    <div className="docs-progress">
      <ul className="docs-phase-list">
        {PHASE_STEPS.map((step, i) => {
          const isDone = i < activeIdx;
          const isActive = i === activeIdx;
          return (
            <li key={step.key} className={`docs-phase${isActive ? ' active' : isDone ? ' done-step' : ''}`}>
              <span className="docs-phase-icon">
                {isDone ? '✓' : isActive ? <span className="docs-spinner" /> : '·'}
              </span>
              <span>
                {step.key === 'uploading' && isActive
                  ? `Uploading${uploadPct > 0 ? ` — ${uploadPct}%` : '…'}`
                  : step.label}
              </span>
            </li>
          );
        })}
      </ul>
      {phase.name === 'uploading' && uploadPct > 0 && (
        <div className="docs-phase-bar">
          <div className="docs-phase-bar-fill" style={{ width: `${uploadPct}%` }} />
        </div>
      )}
    </div>
  );
}

function OverviewPane({ file, chunks }: { file: DocumentFile; chunks: DocumentChunk[] }) {
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadSummary(force = false) {
    if (loading) return;
    if (summary && !force) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/documents/summarize', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: file.id }),
      });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        throw new Error(json.error ?? 'Failed to generate summary');
      }
      const json = await res.json() as { summary: string };
      setSummary(json.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate summary');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadSummary(); }, [file.id]);

  const embeddedCount = chunks.filter((c) => c.hasEmbedding).length;

  return (
    <div className="docs-detail-content">
      <p className="docs-detail-kicker">Overview</p>
      <p className="docs-detail-heading">{file.filename}</p>

      <div className="docs-meta-grid">
        <span className="docs-meta-label">Size</span>
        <span className="docs-meta-value">{formatSize(file.size)}</span>
        <span className="docs-meta-label">Chunks</span>
        <span className="docs-meta-value">{file.chunkCount}</span>
        <span className="docs-meta-label">Embeddings</span>
        <span className="docs-meta-value">
          {embeddedCount > 0
            ? `${embeddedCount} / ${chunks.length} chunks`
            : <span style={{ color: 'var(--muted, #888)' }}>None (no embed model configured)</span>}
        </span>
        <span className="docs-meta-label">Uploaded</span>
        <span className="docs-meta-value">{formatDate(file.createdAt)}</span>
      </div>

      <p className="docs-section-label">Summary</p>
      {loading && (
        <div className="docs-summary-loading">
          <span className="docs-spinner" />
          Generating…
        </div>
      )}
      {error && <p className="docs-err-msg" style={{ paddingTop: 0 }}>✕ {error}</p>}
      {summary && !loading && (
        <>
          <p className="docs-summary-text">{summary}</p>
          <button type="button" className="docs-regen-btn" onClick={() => void loadSummary(true)}>
            ↺ Regenerate
          </button>
        </>
      )}
    </div>
  );
}

function ChunkPane({ chunk, total }: { chunk: DocumentChunk; total: number }) {
  return (
    <div className="docs-detail-content">
      <p className="docs-detail-kicker">Chunk {chunk.ordinal + 1} of {total}</p>

      <div className="docs-meta-grid" style={{ marginBottom: '0.875rem' }}>
        <span className="docs-meta-label">Characters</span>
        <span className="docs-meta-value">{chunk.charCount.toLocaleString()}</span>
        <span className="docs-meta-label">Embedding</span>
        <span className="docs-meta-value">
          <span className={`docs-embed-badge ${chunk.hasEmbedding ? 'yes' : 'no'}`}>
            {chunk.hasEmbedding ? '● Indexed' : '○ Not embedded'}
          </span>
        </span>
      </div>

      <p className="docs-section-label">Content</p>
      <div className="docs-chunk-text">{chunk.text}</div>
    </div>
  );
}

function DetailView({
  file,
  onBack,
}: {
  file: DocumentFile;
  onBack: () => void;
}) {
  const [chunks, setChunks] = useState<DocumentChunk[] | null>(null);
  const [nav, setNav] = useState<DetailNav>('overview');

  useEffect(() => {
    setChunks(null);
    setNav('overview');
    void fetch(`/api/documents/chunks?fileId=${encodeURIComponent(file.id)}`, { credentials: 'include' })
      .then((r) => r.json() as Promise<{ chunks: DocumentChunk[] }>)
      .then((d) => setChunks(d.chunks))
      .catch(() => setChunks([]));
  }, [file.id]);

  const selectedChunk = typeof nav === 'number' && chunks ? chunks[nav] : null;

  return (
    <div className="docs-detail">
      {/* Left nav */}
      <div className="docs-detail-nav">
        <button type="button" className="docs-nav-icon" title="← Back to files" onClick={onBack}
          style={{ fontSize: '1rem', aspectRatio: 'auto', padding: '0.3rem' }}>
          ←
        </button>
        <div className="docs-nav-divider" />
        <p className="docs-detail-nav-section">Info</p>
        <button
          type="button"
          className={`docs-nav-icon${nav === 'overview' ? ' active' : ''}`}
          title="Overview & summary"
          onClick={() => setNav('overview')}
        >
          <span style={{ pointerEvents: 'none' }}>📄</span>
          <span className="docs-nav-icon-label">Summary</span>
        </button>
        {chunks && chunks.length > 0 && (
          <>
            <div className="docs-nav-divider" />
            <p className="docs-detail-nav-section">Chunks</p>
            <div className="docs-chunk-grid">
              {chunks.map((chunk) => (
                <button
                  key={chunk.id}
                  type="button"
                  className={`docs-chunk-btn${chunk.hasEmbedding ? ' embedded' : ''}${nav === chunk.ordinal ? ' active' : ''}`}
                  title={`Chunk ${chunk.ordinal + 1} · ${chunk.charCount.toLocaleString()} chars${chunk.hasEmbedding ? ' · embedded' : ''}`}
                  onClick={() => setNav(chunk.ordinal)}
                >
                  {chunk.ordinal + 1}
                </button>
              ))}
            </div>
          </>
        )}
        {chunks === null && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '0.5rem' }}>
            <span className="docs-spinner" style={{ color: 'var(--muted, #888)' }} />
          </div>
        )}
      </div>

      {/* Right content */}
      {nav === 'overview' ? (
        <OverviewPane file={file} chunks={chunks ?? []} />
      ) : selectedChunk ? (
        <ChunkPane chunk={selectedChunk} total={chunks?.length ?? 0} />
      ) : null}
    </div>
  );
}

function DocumentsModal({
  projectId,
  files,
  onClose,
  onDelete,
  onUploadDone,
  busy,
}: {
  projectId: string;
  files: DocumentFile[];
  onClose: () => void;
  onDelete: (fileId: string, filename: string) => Promise<void>;
  onUploadDone: () => Promise<void>;
  busy: boolean;
}) {
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>({ name: 'idle' });
  const [dragOver, setDragOver] = useState(false);
  const [detailFile, setDetailFile] = useState<DocumentFile | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isUploading = uploadPhase.name === 'reading' || uploadPhase.name === 'uploading' || uploadPhase.name === 'indexing';

  async function handleFile(file: File) {
    if (isUploading) return;
    setUploadPhase({ name: 'reading' });

    let text: string;
    try {
      text = await file.text();
    } catch {
      setUploadPhase({ name: 'error', message: 'Could not read the file.' });
      return;
    }

    const contentBase64 = textToBase64(text);
    setUploadPhase({ name: 'uploading', pct: 0 });

    try {
      const uploadedFile = await new Promise<DocumentFile>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/documents/upload');
        xhr.withCredentials = true;
        xhr.setRequestHeader('Content-Type', 'application/json');

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setUploadPhase({ name: 'uploading', pct: Math.round((e.loaded / e.total) * 100) });
          }
        };

        xhr.upload.onload = () => { setUploadPhase({ name: 'indexing' }); };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve((JSON.parse(xhr.responseText) as { file: DocumentFile }).file);
            } catch {
              reject(new Error('Invalid server response'));
            }
          } else {
            let msg = 'Upload failed';
            try { msg = (JSON.parse(xhr.responseText) as { error?: string }).error ?? msg; } catch {}
            reject(new Error(msg));
          }
        };

        xhr.onerror = () => reject(new Error('Network error'));
        xhr.send(JSON.stringify({ projectId, filename: file.name, contentBase64 }));
      });

      await onUploadDone();
      setUploadPhase({ name: 'done', chunkCount: uploadedFile.chunkCount });
    } catch (err) {
      setUploadPhase({ name: 'error', message: err instanceof Error ? err.message : 'Upload failed' });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  const inDetail = detailFile !== null;

  return (
    <div
      className="docs-modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="docs-modal" role="dialog" aria-modal="true" aria-labelledby="docs-modal-title">
        <div className="docs-modal-header">
          {inDetail && (
            <button type="button" className="docs-modal-back" onClick={() => setDetailFile(null)} title="Back to file list">
              ←
            </button>
          )}
          <h3 className="docs-modal-title" id="docs-modal-title">
            {inDetail
              ? detailFile.filename
              : <>
                  Project files
                  {files.length > 0 && (
                    <span style={{ marginLeft: '0.5rem', fontSize: '0.8rem', fontWeight: 400, color: 'var(--muted, #888)' }}>
                      {files.length} file{files.length === 1 ? '' : 's'}
                    </span>
                  )}
                </>
            }
          </h3>
          <button type="button" className="docs-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {inDetail ? (
          <DetailView file={detailFile} onBack={() => setDetailFile(null)} />
        ) : (
          <>
            <div className="docs-modal-body">
              {files.length === 0 ? (
                <p className="docs-empty">No files yet. Drop a file below to get started.</p>
              ) : (
                <table className="docs-file-table">
                  <thead>
                    <tr>
                      <th>File</th>
                      <th>Size</th>
                      <th>Chunks</th>
                      <th>Added</th>
                      <th style={{ width: '2rem' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {files.map((f) => (
                      <tr key={f.id} onClick={() => setDetailFile(f)}>
                        <td className="docs-file-name">{f.filename}</td>
                        <td className="docs-file-meta">{formatSize(f.size)}</td>
                        <td className="docs-file-meta">{f.chunkCount}</td>
                        <td className="docs-file-meta">{formatDate(f.createdAt)}</td>
                        <td>
                          <button
                            type="button"
                            className="docs-file-delete"
                            disabled={busy || isUploading}
                            title={`Remove ${f.filename}`}
                            onClick={(e) => { e.stopPropagation(); void onDelete(f.id, f.filename); }}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="docs-modal-footer">
              <div
                className={`docs-drop-zone${dragOver ? ' drag-over' : ''}${isUploading ? ' uploading' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const file = e.dataTransfer.files[0];
                  if (file) void handleFile(file);
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.md,.markdown,.text,text/plain,text/markdown"
                  disabled={isUploading || busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleFile(file);
                  }}
                />
                <p className="docs-drop-zone-text"><strong>Choose a file</strong> or drag it here</p>
                <p className="docs-drop-hint">.txt or .md — up to 600 KB</p>
              </div>
              <UploadProgress phase={uploadPhase} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function FileSidebarPanel({ projectId }: { projectId: string }) {
  const [files, setFiles] = useState<DocumentFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  async function loadFiles() {
    try {
      const res = await fetch(`/api/documents/list?projectId=${encodeURIComponent(projectId)}`, {
        credentials: 'include',
      });
      if (!res.ok) return;
      const data = (await res.json()) as { files: DocumentFile[] };
      setFiles(data.files);
    } catch {
      /* best-effort */
    }
  }

  useEffect(() => {
    setFiles([]);
    setModalOpen(false);
    void loadFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function removeFile(fileId: string, filename: string) {
    if (!window.confirm(`Remove "${filename}"?`)) return;
    setBusy(true);
    try {
      const res = await fetch('/api/documents/delete', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId }),
      });
      if (!res.ok) throw new Error('Delete failed');
      await loadFiles();
    } catch {
      /* best-effort */
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="docs-sidebar">
        <div className="docs-sidebar-head">
          <span>
            Files
            {files.length > 0 && (
              <span className="docs-sidebar-count" style={{ marginLeft: '0.4rem', fontSize: '0.72rem', opacity: 0.6 }}>
                ({files.length})
              </span>
            )}
          </span>
          <button type="button" className="docs-sidebar-upload-btn" onClick={() => setModalOpen(true)}>
            Manage
          </button>
        </div>
        <div className="docs-sidebar-list">
          {files.length === 0 ? (
            <p className="docs-sidebar-empty">No files yet.</p>
          ) : (
            files.map((file) => (
              <div
                key={file.id}
                className="docs-sidebar-file"
                title={`${formatSize(file.size)} · ${file.chunkCount} chunk${file.chunkCount === 1 ? '' : 's'}`}
              >
                <span className="docs-sidebar-filename">{file.filename}</span>
              </div>
            ))
          )}
        </div>
      </div>
      {modalOpen && (
        <DocumentsModal
          projectId={projectId}
          files={files}
          onClose={() => setModalOpen(false)}
          onDelete={removeFile}
          onUploadDone={loadFiles}
          busy={busy}
        />
      )}
    </>
  );
}

export const dashboardViews: WorkerDashboardViewDefinition[] = [
  {
    workerId: 'core.documents',
    kind: 'project-files-sidebar',
    surfaceIds: ['project-files-sidebar'],
    count: () => undefined,
    render: (ctx) => <FileSidebarPanel projectId={ctx.activeProjectId as string} />,
  },
];
