import { useState } from 'react';
import type { DashboardSnapshot, WorkerSummary } from './types';

async function updateWorkerEnabled(worker: WorkerSummary, onRefresh: () => Promise<void>) {
  const res = await fetch(`/api/workers/${encodeURIComponent(worker.id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled: !worker.enabled }),
  });
  if (!res.ok) throw new Error(await res.text());
  await onRefresh();
}

export function StepChannels({ dashboard, onRefresh }: { dashboard: DashboardSnapshot; onRefresh: () => Promise<void> }) {
  const channelWorkers = dashboard.workers.filter((w) => w.kind === 'channel');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggleWorker(worker: WorkerSummary) {
    setBusy(worker.id);
    setError(null);
    try {
      await updateWorkerEnabled(worker, onRefresh);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(null);
    }
  }

  if (channelWorkers.length === 0) {
    return (
      <div className="wizard-step-body">
        <h2>Connect a channel</h2>
        <p className="wizard-lead">
          Channels let BFrost send you messages or receive your commands. The dashboard chat is always available and needs no setup.
        </p>
        <div className="wizard-empty-notice">
          No channel workers are installed yet. You can install them later from the <strong>Store</strong> or <strong>Workers</strong> tab.
        </div>
        <p className="wizard-footnote">Skip this step - you can always add channels later.</p>
      </div>
    );
  }

  return (
    <div className="wizard-step-body">
      <h2>Connect a channel</h2>
      <p className="wizard-lead">
        Enable the channels you want BFrost to use. After enabling, you'll configure credentials from the Channels tab.
      </p>
      <div className="wizard-worker-list">
        {channelWorkers.map((w) => (
          <div key={w.id} className="wizard-worker-item">
            <div className="wizard-worker-meta">
              <strong>{w.displayName ?? w.name}</strong>
              <span className="wizard-worker-desc">{w.tagline ?? w.description}</span>
            </div>
            <button
              type="button"
              className={w.enabled ? '' : 'primary'}
              disabled={busy === w.id}
              onClick={() => void toggleWorker(w)}
            >
              {busy === w.id ? '...' : w.enabled ? 'Disable' : 'Enable'}
            </button>
          </div>
        ))}
      </div>
      {error ? <p className="wizard-error">{error}</p> : null}
      <p className="wizard-footnote">Configure channel credentials from the Channels tab after closing this wizard.</p>
    </div>
  );
}

export function StepWorkers({ dashboard, onRefresh }: { dashboard: DashboardSnapshot; onRefresh: () => Promise<void> }) {
  const starterWorkers = dashboard.workers.filter(
    (w) => w.kind === 'feature' && !w.missing && (!w.builtIn || w.deletable === true),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggleWorker(worker: WorkerSummary) {
    setBusy(worker.id);
    setError(null);
    try {
      await updateWorkerEnabled(worker, onRefresh);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(null);
    }
  }

  if (starterWorkers.length === 0) {
    return (
      <div className="wizard-step-body">
        <h2>Enable workers</h2>
        <p className="wizard-lead">No optional workers found. Browse the Store tab to install community workers, or check the Workers tab to see what's installed.</p>
      </div>
    );
  }

  return (
    <div className="wizard-step-body">
      <h2>Enable workers</h2>
      <p className="wizard-lead">
        Workers are the features of BFrost. Enable the ones that match what you want to do.
      </p>
      <div className="wizard-worker-list">
        {starterWorkers.map((w) => (
          <div key={w.id} className={`wizard-worker-item${w.enabled ? ' enabled' : ''}`}>
            <div className="wizard-worker-meta">
              <strong>{w.displayName ?? w.name}</strong>
              <span className="wizard-worker-desc">{w.tagline ?? w.description}</span>
              {w.enabled ? <span className="wizard-worker-badge">Enabled</span> : null}
            </div>
            <button
              type="button"
              className={w.enabled ? '' : 'primary'}
              disabled={busy === w.id}
              onClick={() => void toggleWorker(w)}
            >
              {busy === w.id ? '...' : w.enabled ? 'Disable' : 'Enable'}
            </button>
          </div>
        ))}
      </div>
      {error ? <p className="wizard-error">{error}</p> : null}
    </div>
  );
}

export function StepCredentials({
  dashboard,
  onNavigate,
}: {
  dashboard: DashboardSnapshot;
  onNavigate: (tab: string) => void;
}) {
  const unhealthyWorkers = dashboard.workers.filter(
    (w) => w.enabled && !w.missing && w.healthState !== 'healthy' && w.healthState !== 'disabled',
  );

  if (unhealthyWorkers.length === 0) {
    return (
      <div className="wizard-step-body">
        <h2>Credentials</h2>
        <p className="wizard-lead">
          All enabled workers look healthy - no credentials are missing.
        </p>
      </div>
    );
  }

  return (
    <div className="wizard-step-body">
      <h2>Credentials needed</h2>
      <p className="wizard-lead">
        The following workers need credentials before they can run. Configure them from the Config tab.
      </p>
      <div className="wizard-worker-list">
        {unhealthyWorkers.map((w) => (
          <div key={w.id} className="wizard-worker-item">
            <div className="wizard-worker-meta">
              <strong>{w.displayName ?? w.name}</strong>
              <span className="wizard-worker-desc">{w.healthDetail || 'Configuration required'}</span>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('config')}
            >
              Go to Config →
            </button>
          </div>
        ))}
      </div>
      <p className="wizard-footnote">You can skip this and configure credentials later from the Config tab.</p>
    </div>
  );
}

export function StepFirstRun({
  dashboard,
  onRefresh,
}: {
  dashboard: DashboardSnapshot;
  onRefresh: () => Promise<void>;
}) {
  const runnableJobs = dashboard.cron.jobs.filter((j) => j.workerEnabled && j.enabled);
  const [busy, setBusy] = useState<string | null>(null);
  const [triggered, setTriggered] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runJob(jobName: string) {
    setBusy(jobName);
    setError(null);
    try {
      const res = await fetch(`/api/cron-jobs/${encodeURIComponent(jobName)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run' }),
      });
      if (!res.ok) throw new Error(await res.text());
      setTriggered(jobName);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to trigger job');
    } finally {
      setBusy(null);
    }
  }

  if (runnableJobs.length === 0) {
    return (
      <div className="wizard-step-body">
        <h2>First run</h2>
        <p className="wizard-lead">
          No enabled jobs found yet. Enable a worker first - then trigger its job from the Jobs tab.
        </p>
      </div>
    );
  }

  return (
    <div className="wizard-step-body">
      <h2>Run your first job</h2>
      <p className="wizard-lead">
        Trigger a job now to see BFrost in action. It will run immediately using your configured model.
      </p>
      <div className="wizard-worker-list">
        {runnableJobs.slice(0, 5).map((j) => {
          const lastRun = j.lastStartedAt
            ? new Date(j.lastStartedAt).toLocaleString()
            : 'Never';
          return (
            <div key={j.name} className="wizard-worker-item">
              <div className="wizard-worker-meta">
                <strong>{j.label}</strong>
                <span className="wizard-worker-desc">Last run: {lastRun}</span>
                {j.lastStatus === 'success' && j.lastSummary ? (
                  <span className="wizard-worker-desc wizard-run-summary">✓ {j.lastSummary}</span>
                ) : null}
                {j.lastStatus === 'error' && j.lastError ? (
                  <span className="wizard-worker-desc wizard-run-error">✗ {j.lastError}</span>
                ) : null}
              </div>
              <button
                type="button"
                className="primary"
                disabled={busy === j.name || j.running}
                onClick={() => void runJob(j.name)}
              >
                {j.running ? 'Running...' : busy === j.name ? 'Starting...' : triggered === j.name ? 'Triggered ✓' : 'Run now'}
              </button>
            </div>
          );
        })}
      </div>
      {error ? <p className="wizard-error">{error}</p> : null}
      {triggered ? (
        <p className="wizard-status-ok">
          ✓ Job triggered. Check the Jobs tab to see the result when it finishes.
        </p>
      ) : null}
    </div>
  );
}
