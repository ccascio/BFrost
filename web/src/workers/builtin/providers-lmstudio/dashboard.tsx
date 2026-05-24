import { useEffect, useState } from 'react';
import type { WorkerDashboardViewDefinition } from '../../types';

// ─── Memory-cleanup sub-panel ────────────────────────────────────────────────

interface MemoryCleanupStatus {
  platform: 'darwin' | 'linux' | 'win32' | 'unsupported';
  supported: boolean;
  configured: boolean;
  command: string | null;
  sudoersLine: string | null;
  sudoersDropInPath: string;
}

function MemoryCleanupPanel() {
  const [status, setStatus] = useState<MemoryCleanupStatus | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function refresh() {
    try {
      const res = await fetch('/api/workers/lmstudio/memory-cleanup', { credentials: 'include' });
      if (!res.ok) return;
      setStatus(await res.json());
    } catch {
      // best-effort; panel hides on failure
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/workers/lmstudio/memory-cleanup/test', {
        method: 'POST',
        credentials: 'include',
      });
      const payload = await res.json();
      setTestResult(
        payload.ok
          ? `Memory cleanup ran in ${payload.durationMs} ms.`
          : `Cleanup did not complete${payload.errorMessage ? `: ${payload.errorMessage}` : '.'} Add the sudoers line below and try again.`,
      );
      await refresh();
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  }

  async function copySudoersLine() {
    if (!status?.sudoersLine) return;
    try {
      await navigator.clipboard.writeText(status.sudoersLine);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard denial — surface nothing, user can select manually
    }
  }

  if (!status) return null;

  if (!status.supported) {
    return (
      <p className="footnote" style={{ marginTop: '0.5rem' }}>
        Memory cleanup after model unload is not supported on this platform ({status.platform}); the
        OS reclaims memory on its own.
      </p>
    );
  }

  const toneClass = status.configured ? 'good' : 'warning';
  const statusLabel = status.configured ? 'Configured' : 'Not configured';

  return (
    <div style={{ marginTop: '0.75rem', borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit' }}
      >
        <span className={`status-pill ${toneClass}`} style={{ marginRight: '0.5rem' }}>
          {statusLabel}
        </span>
        Memory cleanup after unload {expanded ? '▾' : '▸'}
      </button>

      {expanded ? (
        <div style={{ marginTop: '0.5rem' }}>
          <p className="footnote">
            BFrost runs <code>{status.command}</code> after a model unload to help the OS reclaim
            inactive memory. The command needs <strong>passwordless sudo</strong> so it can run
            unattended (including from cron jobs).
          </p>
          {status.configured ? (
            <p className="footnote" style={{ color: 'var(--good)' }}>
              Passwordless sudo is configured — no action needed.
            </p>
          ) : (
            <>
              <p className="footnote">
                Add the line below to a sudoers drop-in file. Open a terminal and run:
              </p>
              <pre className="codeblock" style={{ userSelect: 'all' }}>
                {`sudo visudo -f ${status.sudoersDropInPath}`}
              </pre>
              <p className="footnote">Then paste this line and save:</p>
              <pre className="codeblock" style={{ userSelect: 'all' }}>
                {status.sudoersLine}
              </pre>
              <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
                <button type="button" onClick={() => void copySudoersLine()}>
                  {copied ? 'Copied!' : 'Copy line'}
                </button>
                <button type="button" disabled={testing} onClick={() => void runTest()}>
                  {testing ? 'Testing...' : 'Test memory cleanup'}
                </button>
              </div>
              <p className="footnote" style={{ marginTop: '0.5rem' }}>
                To remove this access later, delete <code>{status.sudoersDropInPath}</code>.
              </p>
            </>
          )}
          {status.configured ? (
            <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
              <button type="button" disabled={testing} onClick={() => void runTest()}>
                {testing ? 'Testing...' : 'Test memory cleanup'}
              </button>
            </div>
          ) : null}
          {testResult ? <p className="footnote" style={{ marginTop: '0.5rem' }}>{testResult}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

// ─── Main runtime panel ───────────────────────────────────────────────────────

interface LmStudioState {
  running: boolean;
  loadedCount: number;
  loadedModels: string[];
}

interface ModelOption {
  alias: string;
  id: string;
  label: string;
  provider: string;
}

function LmStudioRuntimePanel({ lmStudio, defaultModel, activeLocalProviderId, refreshDashboard }: {
  lmStudio: LmStudioState;
  defaultModel: ModelOption;
  activeLocalProviderId: string;
  refreshDashboard: () => void;
}) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(key: string, action: string, successMsg: string) {
    setBusyKey(key);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch('/api/lmstudio', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const payload = (await res.json()) as { error?: string };
      if (!res.ok || 'error' in payload) {
        throw new Error((payload as { error?: string }).error ?? 'Request failed');
      }
      setNotice(successMsg);
      refreshDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }

  const isLocalProvider = defaultModel.provider === activeLocalProviderId;

  return (
    <article className="panel">
      <div className="panel-head">
        <div>
          <p className="panel-kicker">Runtime services</p>
          <h2>LM Studio</h2>
        </div>
        <span className={`status-pill ${lmStudio.running ? 'good' : 'warning'}`}>
          {lmStudio.running ? 'Running' : 'Stopped'}
        </span>
      </div>

      <p className="footnote" style={{ marginTop: 0 }}>
        LM Studio lets you download and run open-source AI models entirely on your computer — no API
        key, no cloud. Install LM Studio from{' '}
        <a href="https://lmstudio.ai" target="_blank" rel="noreferrer">lmstudio.ai</a>, download a
        model there, then enable the LM Studio provider here so BFrost can use it.
      </p>

      <div className="metric-row">
        <div className="metric">
          <span className="metric-label">Loaded models</span>
          <span className="metric-value">{lmStudio.loadedCount}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Default model</span>
          <span className="metric-value">{defaultModel.alias}</span>
        </div>
      </div>

      <p className="mini-list">
        {lmStudio.loadedModels.length > 0
          ? lmStudio.loadedModels.join(', ')
          : 'No models are currently loaded.'}
      </p>

      <div className="panel-actions wrap">
        <button
          className="primary"
          disabled={busyKey === 'lm-start'}
          onClick={() => void act('lm-start', 'start', 'LM Studio server started.')}
        >
          Start server
        </button>
        <button
          disabled={busyKey === 'lm-stop'}
          onClick={() => void act('lm-stop', 'stop', 'LM Studio server stopped.')}
        >
          Stop server
        </button>
        <button
          disabled={busyKey === 'lm-load' || !isLocalProvider}
          onClick={() => void act('lm-load', 'load-default', 'Default model loaded in LM Studio.')}
          title={!isLocalProvider ? 'Default model is not served by the active local provider' : undefined}
        >
          Load default model
        </button>
        <button
          disabled={busyKey === 'lm-unload' || !isLocalProvider}
          onClick={() => void act('lm-unload', 'unload-default', 'Default model unloaded.')}
          title={!isLocalProvider ? 'Default model is not served by the active local provider' : undefined}
        >
          Unload default model
        </button>
        <button
          disabled={busyKey === 'lm-unload-all'}
          onClick={() => void act('lm-unload-all', 'unload-all', 'All LM Studio models unloaded.')}
        >
          Free LM Studio memory
        </button>
      </div>

      {notice ? <p className="footnote" style={{ marginTop: '0.75rem', color: 'var(--good)' }}>{notice}</p> : null}
      {error ? <p className="footnote" style={{ marginTop: '0.75rem', color: 'var(--warning)' }}>{error}</p> : null}

      <MemoryCleanupPanel />
    </article>
  );
}

// ─── View definition ──────────────────────────────────────────────────────────

export const dashboardView: WorkerDashboardViewDefinition = {
  workerId: 'core.providers.lmstudio',
  kind: 'provider-runtime',
  surfaceIds: ['lmstudio-runtime'],
  menu: {
    icon: 'server',
    group: 'Workers',
    order: 50,
    label: 'LM Studio',
  },
  count: ({ dashboard }) => {
    const lmStudio = dashboard?.lmStudio;
    if (!lmStudio) return undefined;
    return lmStudio.running ? lmStudio.loadedCount : undefined;
  },
  render: (ctx) => {
    const dashboard = ctx.dashboard as {
      lmStudio: LmStudioState;
      defaultModel: ModelOption;
      platform: { activeLocalProviderId: string };
    };
    return (
      <LmStudioRuntimePanel
        lmStudio={dashboard.lmStudio}
        defaultModel={dashboard.defaultModel}
        activeLocalProviderId={dashboard.platform.activeLocalProviderId}
        refreshDashboard={ctx.refreshDashboard as () => void}
      />
    );
  },
};
