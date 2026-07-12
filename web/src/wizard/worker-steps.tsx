import { useState } from 'react';
import type { DashboardSnapshot, WorkerSummary } from './types';
import type { JobDashboardField, JobParamDraftValue, WorkerDashboardSurface } from '../app-types';
import { buildSurfaceDraft, serializeDashboardFields } from '../app-helpers';
import { DashboardFieldEditor } from '../tabs/DashboardFieldEditor';

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

function isWebSearchWorker(worker: WorkerSummary): boolean {
  if (!worker.enabled || worker.missing) return false;
  const text = [
    worker.displayName,
    worker.name,
    worker.tagline,
    worker.description,
    ...(worker.health ?? []).map((row) => `${row.key} ${row.label}`),
  ].filter(Boolean).join(' ').toLowerCase();
  return text.includes('web search') || text.includes('search credentials');
}

function webSearchSurface(worker: WorkerSummary): WorkerDashboardSurface | null {
  const surfaces = worker.dashboard?.settings ?? [];
  return (surfaces.find((surface) => surface.path && !surface.path.includes('#') && (surface.fields ?? []).length > 0) as WorkerDashboardSurface | undefined) ?? null;
}

export function StepWebSearch({
  dashboard,
  onRefresh,
  onNavigate,
}: {
  dashboard: DashboardSnapshot;
  onRefresh: () => Promise<void>;
  onNavigate: (tab: string) => void;
}) {
  const webSearchWorkers = dashboard.workers.filter(isWebSearchWorker);
  const [drafts, setDrafts] = useState<Record<string, Record<string, JobParamDraftValue>>>({});
  const [customListItemDrafts, setCustomListItemDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ status: 'success' | 'error'; text: string } | null>(null);

  async function saveSurface(worker: WorkerSummary, surface: WorkerDashboardSurface) {
    if (!surface.path) return;
    const key = `${worker.id}:${surface.id}`;
    const fields = (surface.fields ?? []) as JobDashboardField[];
    const draft = drafts[key] ?? buildSurfaceDraft(surface, dashboard.workerData, dashboard.cron.jobs);
    setBusy(key);
    setMessage(null);
    try {
      const response = await fetch(surface.path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serializeDashboardFields(fields, draft)),
      });
      if (!response.ok) throw new Error((await response.text()) || 'Failed to save web search credentials.');
      await onRefresh();
      setMessage({ status: 'success', text: `${worker.displayName ?? worker.name} saved.` });
    } catch (err) {
      setMessage({ status: 'error', text: err instanceof Error ? err.message : 'Failed to save web search credentials.' });
    } finally {
      setBusy(null);
    }
  }

  if (webSearchWorkers.length === 0) {
    return (
      <div className="wizard-step-body">
        <h2>Web search</h2>
        <p className="wizard-lead">
          No enabled web-search worker was found. You can continue, but live web lookup features will not work until a search worker is installed and configured.
        </p>
      </div>
    );
  }

  return (
    <div className="wizard-step-body">
      <h2>Web search</h2>
      <p className="wizard-lead">
        Configure web search now. Without it, the assistant cannot look up current information, and workers that discover sources from the web will fail until credentials are added.
      </p>
      <div className="wizard-worker-list">
        {webSearchWorkers.map((worker) => {
          const surface = webSearchSurface(worker);
          const key = surface ? `${worker.id}:${surface.id}` : worker.id;
          const fields = ((surface?.fields ?? []) as JobDashboardField[]);
          const draft = surface ? drafts[key] ?? buildSurfaceDraft(surface, dashboard.workerData, dashboard.cron.jobs) : {};
          const healthy = worker.healthState === 'healthy';
          return (
            <div key={worker.id} className={`wizard-worker-item${healthy ? ' enabled' : ''}`}>
              <div className="wizard-worker-meta">
                <strong>{worker.displayName ?? worker.name}</strong>
                <span className="wizard-worker-desc">{healthy ? 'Configured - web search is ready.' : worker.healthDetail || 'Web search credentials are required.'}</span>
                {healthy ? <span className="wizard-worker-badge">Configured</span> : null}
                {!surface ? (
                  <button type="button" onClick={() => onNavigate('config')}>
                    Go to Config →
                  </button>
                ) : (
                  <div className="wizard-worker-list" style={{ marginTop: '0.75rem' }}>
                    {fields.map((field) => (
                      <DashboardFieldEditor
                        key={field.key}
                        field={field}
                        value={draft[field.key]}
                        formValues={draft}
                        onChange={(value) => {
                          setDrafts((current) => ({
                            ...current,
                            [key]: { ...(current[key] ?? draft), [field.key]: value },
                          }));
                        }}
                        customListItemDrafts={customListItemDrafts}
                        setCustomListItemDrafts={setCustomListItemDrafts}
                        modelOptions={dashboard.models ?? []}
                        draftKey={`${key}:${field.key}`}
                        onActionComplete={onRefresh}
                      />
                    ))}
                    <div className="panel-actions">
                      <button
                        type="button"
                        className="primary"
                        disabled={busy === key}
                        onClick={() => void saveSurface(worker, surface)}
                      >
                        {busy === key ? 'Saving...' : 'Save web search'}
                      </button>
                      <button type="button" onClick={() => onNavigate(surface.tab ?? 'config')}>
                        Open full settings →
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {message ? (
        <p className={message.status === 'success' ? 'wizard-status-ok' : 'wizard-error'}>
          {message.status === 'success' ? '✓ ' : '✗ '}
          {message.text}
        </p>
      ) : null}
      <p className="wizard-footnote">This is optional to finish setup, but web lookup features stay unavailable until it is configured.</p>
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
