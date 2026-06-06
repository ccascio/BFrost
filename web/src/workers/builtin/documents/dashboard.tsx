import { useEffect, useRef, useState } from 'react';
import type { WorkerDashboardViewDefinition } from '../../types';

interface Project {
  projectId: string;
  name: string;
}

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

function DocumentsPanel() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [files, setFiles] = useState<DocumentFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function loadProjects() {
    try {
      const res = await fetch('/api/projects', { credentials: 'include' });
      if (!res.ok) return;
      const data = (await res.json()) as { projects: Project[] };
      setProjects(data.projects);
      setSelectedProjectId((current) => current || data.projects[0]?.projectId || '');
    } catch {
      /* best-effort */
    }
  }

  async function loadFiles(projectId: string) {
    if (!projectId) {
      setFiles([]);
      return;
    }
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
    void loadProjects();
  }, []);

  useEffect(() => {
    void loadFiles(selectedProjectId);
  }, [selectedProjectId]);

  async function createProject() {
    const name = window.prompt('New project name')?.trim();
    if (!name) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error('Failed to create project');
      const { project } = (await res.json()) as { project: Project };
      await loadProjects();
      setSelectedProjectId(project.projectId);
    } catch (err) {
      setNotice({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function uploadFile(file: File) {
    if (!selectedProjectId) {
      setNotice({ ok: false, message: 'Select or create a project first.' });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const text = await file.text();
      const res = await fetch('/api/documents/upload', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: selectedProjectId,
          filename: file.name,
          contentBase64: textToBase64(text),
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? 'Upload failed');
      }
      setNotice({ ok: true, message: `Uploaded ${file.name}.` });
      await loadFiles(selectedProjectId);
    } catch (err) {
      setNotice({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function removeFile(fileId: string, filename: string) {
    if (!window.confirm(`Remove "${filename}" from this project?`)) return;
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
      await loadFiles(selectedProjectId);
    } catch (err) {
      setNotice({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel tab-page">
      <div className="panel-head">
        <div>
          <p className="panel-kicker">Project Documents</p>
          <h2>Files the assistant can read</h2>
        </div>
      </div>

      <p className="footnote" style={{ marginTop: '0.5rem' }}>
        Upload text or markdown files to a project. When you chat inside that project, the assistant
        searches these files to answer. Files stay on your machine.
      </p>

      <div className="form-grid" style={{ marginTop: '0.75rem' }}>
        <label className="field">
          <span>Project</span>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <select
              value={selectedProjectId}
              onChange={(event) => setSelectedProjectId(event.target.value)}
              style={{ flex: 1 }}
            >
              {projects.length === 0 ? <option value="">(no projects yet)</option> : null}
              {projects.map((project) => (
                <option key={project.projectId} value={project.projectId}>
                  {project.name}
                </option>
              ))}
            </select>
            <button type="button" disabled={busy} onClick={() => void createProject()}>
              + New
            </button>
          </div>
        </label>
      </div>

      <div className="panel-actions" style={{ marginTop: '0.75rem' }}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,.md,.markdown,.text,text/plain,text/markdown"
          disabled={busy || !selectedProjectId}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadFile(file);
          }}
        />
        {notice ? (
          <span
            className="footnote"
            style={{ color: notice.ok ? 'var(--good)' : 'var(--warning)', alignSelf: 'center' }}
          >
            {notice.message}
          </span>
        ) : null}
      </div>

      <div className="stack-list compact" style={{ marginTop: '1rem' }}>
        {files.length === 0 ? (
          <p className="empty-state">No documents in this project yet.</p>
        ) : (
          files.map((file) => (
            <div className="run-item" key={file.id} style={{ display: 'flex', justifyContent: 'space-between' }}>
              <div>
                <strong>{file.filename}</strong>
                <span>
                  {Math.max(1, Math.round(file.size / 1024))} KB · {file.chunkCount} chunk
                  {file.chunkCount === 1 ? '' : 's'}
                </span>
              </div>
              <button type="button" disabled={busy} onClick={() => void removeFile(file.id, file.filename)}>
                Remove
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export const dashboardView: WorkerDashboardViewDefinition = {
  workerId: 'core.documents',
  kind: 'documents-files',
  surfaceIds: ['documents-files'],
  count: () => undefined,
  render: () => <DocumentsPanel />,
};
