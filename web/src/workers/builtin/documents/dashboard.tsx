import { useEffect, useRef, useState } from 'react';
import type { WorkerDashboardViewDefinition } from '../../types';

interface DocumentFile {
  id: string;
  filename: string;
  size: number;
  chunkCount: number;
  createdAt: string;
}

type UploadPhase =
  | { name: 'idle' }
  | { name: 'reading' }
  | { name: 'uploading'; pct: number }
  | { name: 'indexing' }
  | { name: 'done'; chunkCount: number }
  | { name: 'error'; message: string };

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
.docs-modal-overlay {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center;
}
.docs-modal {
  background: var(--surface, #1e1e2e);
  border: 1px solid var(--border, #2a2a3e);
  border-radius: 12px;
  width: min(680px, 95vw);
  max-height: 80vh;
  display: flex; flex-direction: column;
  box-shadow: 0 16px 48px rgba(0,0,0,0.4);
}
.docs-modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--border, #2a2a3e);
  flex-shrink: 0;
}
.docs-modal-title { margin: 0; font-size: 1rem; font-weight: 600; }
.docs-modal-close {
  background: none; border: none; cursor: pointer;
  color: var(--muted, #888); font-size: 1.1rem; padding: 0.25rem 0.5rem;
  line-height: 1; border-radius: 4px;
}
.docs-modal-close:hover { color: var(--fg, #eee); background: rgba(255,255,255,0.06); }
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
  padding: 0.6rem 0.5rem;
  border-bottom: 1px solid color-mix(in srgb, var(--border, #2a2a3e) 50%, transparent);
  vertical-align: middle;
}
.docs-file-table tbody tr:last-child td { border-bottom: none; }
.docs-file-name { font-weight: 500; word-break: break-all; max-width: 240px; }
.docs-file-meta { color: var(--muted, #888); white-space: nowrap; }
.docs-file-delete {
  background: none; border: none; cursor: pointer;
  color: var(--muted, #888); padding: 0.2rem 0.45rem; border-radius: 4px;
  transition: color 0.15s, background 0.15s; font-size: 0.8rem;
}
.docs-file-delete:hover { color: var(--warning, #f59e0b); background: rgba(245,158,11,0.12); }
.docs-file-delete:disabled { opacity: 0.4; cursor: not-allowed; }
.docs-modal-footer {
  border-top: 1px solid var(--border, #2a2a3e);
  padding: 1rem 1.25rem;
  flex-shrink: 0;
}
.docs-drop-zone {
  border: 2px dashed var(--border, #2a2a3e);
  border-radius: 8px;
  padding: 1.25rem 1rem;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  position: relative;
  overflow: hidden;
}
.docs-drop-zone:hover, .docs-drop-zone.drag-over {
  border-color: var(--brand, #6366f1);
  background: rgba(99,102,241,0.05);
}
.docs-drop-zone.uploading { cursor: default; opacity: 0.6; pointer-events: none; }
.docs-drop-zone input[type="file"] {
  position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%;
}
.docs-drop-zone-text { color: var(--muted, #888); font-size: 0.85rem; pointer-events: none; margin: 0; }
.docs-drop-zone-text strong { color: var(--fg, #eee); }
.docs-drop-zone-hint { font-size: 0.75rem; margin-top: 0.2rem; }
.docs-empty {
  text-align: center; padding: 2.5rem 1rem;
  color: var(--muted, #888); font-size: 0.875rem; margin: 0;
}
.docs-progress { padding: 0.75rem 0 0; }
.docs-phase-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.3rem; }
.docs-phase {
  display: flex; align-items: center; gap: 0.6rem;
  font-size: 0.8rem; color: var(--muted, #888);
}
.docs-phase.active { color: var(--fg, #eee); }
.docs-phase.done-step { color: var(--good, #4ade80); }
.docs-phase-icon { width: 1rem; text-align: center; flex-shrink: 0; font-size: 0.75rem; }
.docs-phase-bar {
  margin-top: 0.4rem; height: 3px;
  background: var(--border, #2a2a3e); border-radius: 2px; overflow: hidden;
}
.docs-phase-bar-fill {
  height: 100%; background: var(--brand, #6366f1); border-radius: 2px;
  transition: width 0.15s;
}
.docs-done-msg { margin: 0; font-size: 0.8rem; color: var(--good, #4ade80); padding-top: 0.75rem; }
.docs-err-msg  { margin: 0; font-size: 0.8rem; color: var(--warning, #f59e0b); padding-top: 0.75rem; }
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

type PhaseStep = { key: string; label: string };
const PHASE_STEPS: PhaseStep[] = [
  { key: 'reading', label: 'Reading file' },
  { key: 'uploading', label: 'Uploading' },
  { key: 'indexing', label: 'Indexing' },
];
const PHASE_ORDER = ['reading', 'uploading', 'indexing'];

function UploadProgress({ phase }: { phase: UploadPhase }) {
  if (phase.name === 'idle') return null;

  if (phase.name === 'done') {
    return (
      <p className="docs-done-msg">
        ✓ Uploaded — {phase.chunkCount} chunk{phase.chunkCount === 1 ? '' : 's'} indexed.
      </p>
    );
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
                {step.key === 'uploading' && isActive ? `Uploading${uploadPct > 0 ? ` — ${uploadPct}%` : '…'}` : step.label}
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

        xhr.upload.onload = () => {
          setUploadPhase({ name: 'indexing' });
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const resp = JSON.parse(xhr.responseText) as { file: DocumentFile };
              resolve(resp.file);
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

  return (
    <div
      className="docs-modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="docs-modal" role="dialog" aria-modal="true" aria-labelledby="docs-modal-title">
        <div className="docs-modal-header">
          <h3 className="docs-modal-title" id="docs-modal-title">
            Project files
            {files.length > 0 && (
              <span style={{ marginLeft: '0.5rem', fontSize: '0.8rem', fontWeight: 400, color: 'var(--muted, #888)' }}>
                {files.length} file{files.length === 1 ? '' : 's'}
              </span>
            )}
          </h3>
          <button type="button" className="docs-modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

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
                  <tr key={f.id}>
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
                        onClick={() => void onDelete(f.id, f.filename)}
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
            <p className="docs-drop-zone-text">
              <strong>Choose a file</strong> or drag it here
            </p>
            <p className="docs-drop-zone-text docs-drop-zone-hint">.txt or .md — up to 600 KB</p>
          </div>
          <UploadProgress phase={uploadPhase} />
        </div>
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
          <button
            type="button"
            className="docs-sidebar-upload-btn"
            onClick={() => setModalOpen(true)}
          >
            Manage
          </button>
        </div>
        <div className="docs-sidebar-list">
          {files.length === 0 ? (
            <p className="docs-sidebar-empty">No files yet.</p>
          ) : (
            files.map((file) => (
              <div key={file.id} className="docs-sidebar-file" title={`${formatSize(file.size)} · ${file.chunkCount} chunk${file.chunkCount === 1 ? '' : 's'}`}>
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
