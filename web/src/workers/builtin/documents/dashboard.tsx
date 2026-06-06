import { useEffect, useRef, useState } from 'react';
import type { WorkerDashboardViewDefinition } from '../../types';

interface DocumentFile {
  id: string;
  filename: string;
  size: number;
  chunkCount: number;
  createdAt: string;
}

function textToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function FileSidebarPanel({ projectId }: { projectId: string }) {
  const [files, setFiles] = useState<DocumentFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
    setNotice(null);
    void loadFiles();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function uploadFile(file: File) {
    setBusy(true);
    setNotice(null);
    try {
      const text = await file.text();
      const res = await fetch('/api/documents/upload', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          filename: file.name,
          contentBase64: textToBase64(text),
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? 'Upload failed');
      }
      setNotice({ ok: true, text: `Uploaded ${file.name}.` });
      await loadFiles();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Upload failed' });
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function removeFile(fileId: string, filename: string) {
    if (!window.confirm(`Remove "${filename}"?`)) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch('/api/documents/delete', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId }),
      });
      if (!res.ok) throw new Error('Delete failed');
      await loadFiles();
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : 'Delete failed' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="docs-sidebar">
      <div className="docs-sidebar-head">
        <span>Files</span>
        <label className={`docs-sidebar-upload-btn${busy ? ' disabled' : ''}`} title="Upload a .txt or .md file">
          + Upload
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.markdown,.text,text/plain,text/markdown"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void uploadFile(file);
            }}
          />
        </label>
      </div>
      {notice ? (
        <p className="docs-sidebar-notice" style={{ color: notice.ok ? 'var(--good)' : 'var(--warning)' }}>
          {notice.text}
        </p>
      ) : null}
      <div className="docs-sidebar-list">
        {files.length === 0 ? (
          <p className="docs-sidebar-empty">No files yet. Upload a .txt or .md file to let the assistant read it.</p>
        ) : (
          files.map((file) => (
            <div key={file.id} className="docs-sidebar-file">
              <span className="docs-sidebar-filename" title={`${file.filename} — ${Math.max(1, Math.round(file.size / 1024))} KB, ${file.chunkCount} chunk${file.chunkCount === 1 ? '' : 's'}`}>
                {file.filename}
              </span>
              <button
                type="button"
                className="docs-sidebar-remove"
                disabled={busy}
                title="Remove file"
                onClick={() => void removeFile(file.id, file.filename)}
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>
    </div>
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
