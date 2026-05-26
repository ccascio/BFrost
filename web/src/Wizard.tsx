/**
 * First-run Setup Wizard (LOWCODE_ROADMAP Workstream A).
 *
 * A full-screen overlay that guides first-time users through 6 steps:
 *   0  Welcome
 *   1  Pick a model provider (Local / OpenAI / Anthropic)
 *   2  Pick channels (enable channel workers)
 *   3  Pick starter workers
 *   4  Credentials review (unhealthy workers → go to Config)
 *   5  First run (trigger a job, see output)
 *
 * State is persisted via POST /api/wizard/state so the user can quit and
 * resume.  The wizard auto-opens when wizard.completed === false; it can be
 * re-triggered from the "Getting started" checklist.
 */

import { useState, useEffect } from 'react';

// ── Shared types (duplicated from App.tsx to keep the component self-contained)

type WorkerKind = 'feature' | 'channel' | 'provider';
type WorkerHealthState = 'healthy' | 'degraded' | 'missing' | 'unconfigured' | 'disabled';

interface WorkerSummary {
  id: string;
  name: string;
  displayName?: string;
  tagline?: string;
  description: string;
  kind: WorkerKind;
  enabled: boolean;
  missing: boolean;
  healthState: WorkerHealthState;
  healthDetail: string;
  jobCount: number;
  enabledJobCount: number;
}

interface SchedulerJobState {
  name: string;
  label: string;
  workerId: string;
  workerEnabled: boolean;
  enabled: boolean;
  running: boolean;
  lastStartedAt: string | null;
  lastStatus: 'idle' | 'success' | 'error' | 'skipped';
  lastSummary: string | null;
  lastError: string | null;
}

interface IntegrationStatus {
  ok: boolean;
  label?: string;
}

interface DashboardSnapshot {
  workers: WorkerSummary[];
  cron: { jobs: SchedulerJobState[] };
  integrations: Record<string, IntegrationStatus>;
  lmStudio: { running: boolean; loadedModels: string[]; loadedCount: number };
}

export interface WizardProps {
  dashboard: DashboardSnapshot;
  onDismiss: () => void;
  onComplete: () => void;
  /** Called after wizard mutates data so App.tsx refreshes its dashboard snapshot. */
  onRefreshDashboard: () => Promise<void>;
  /** Navigate to a specific main-app tab (closes wizard first). */
  onNavigate: (tab: string) => void;
}

const TOTAL_STEPS = 6;

// ── Step labels for the progress bar
const STEP_LABELS = [
  'Welcome',
  'Model',
  'Channels',
  'Workers',
  'Credentials',
  'First run',
];

// ── Utility: save step progress
async function persistStep(step: number) {
  await fetch('/api/wizard/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ step }),
  }).catch(() => undefined);
}

async function markCompleted() {
  await fetch('/api/wizard/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ completed: true }),
  }).catch(() => undefined);
}

// ────────────────────────────────────────────────────────────────────────────
// Sub-components for each step
// ────────────────────────────────────────────────────────────────────────────

function StepWelcome() {
  return (
    <div className="wizard-step-body">
      <div className="wizard-hero">
        <div className="wizard-hero-icon" aria-hidden="true">⚙️</div>
        <h2>Welcome to BFrost</h2>
        <p className="wizard-lead">
          BFrost is a <strong>worker-first local AI operations platform</strong>. Every
          capability — news digests, research, publishing — is a worker you install, configure, and schedule. Nothing runs in the cloud unless you choose it.
        </p>
        <ul className="wizard-bullets">
          <li>🔒 All data stays on your machine by default</li>
          <li>🤖 Works with local models (LM Studio / Ollama) or cloud APIs (OpenAI, Anthropic)</li>
          <li>⚡ Workers run on a schedule you control, or on demand</li>
          <li>📬 Delivers results to Telegram, Discord, or the built-in dashboard chat</li>
        </ul>
        <p className="wizard-footnote">This wizard takes about 3 minutes. Every step is skippable.</p>
      </div>
    </div>
  );
}

function StepModel({ dashboard, onRefresh }: { dashboard: DashboardSnapshot; onRefresh: () => Promise<void> }) {
  const [tab, setTab] = useState<'local' | 'openai' | 'anthropic'>('openai');
  const [openaiKey, setOpenaiKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<'openai' | 'anthropic' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openaiOk = (dashboard.integrations['openai'] ?? dashboard.integrations['openaiConfigured'] as unknown as IntegrationStatus)?.ok ?? false;
  const anthropicOk = (dashboard.integrations['anthropic'] ?? dashboard.integrations['anthropicConfigured'] as unknown as IntegrationStatus)?.ok ?? false;
  const lmRunning = dashboard.lmStudio?.running ?? false;

  async function saveKey(provider: 'openai' | 'anthropic') {
    const key = provider === 'openai' ? openaiKey : anthropicKey;
    if (!key.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const body = provider === 'openai'
        ? { openaiApiKey: key.trim() }
        : { anthropicApiKey: key.trim() };
      const res = await fetch('/api/cloud-api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      setSaved(provider);
      if (provider === 'openai') setOpenaiKey('');
      else setAnthropicKey('');
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="wizard-step-body">
      <h2>Connect a model provider</h2>
      <p className="wizard-lead">BFrost needs at least one model to run workers. Choose how you want to connect.</p>

      <div className="wizard-tabs" role="tablist">
        {(['openai', 'anthropic', 'local'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            className={`wizard-tab${tab === t ? ' active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t === 'openai' ? 'OpenAI' : t === 'anthropic' ? 'Anthropic' : 'Local (LM Studio)'}
            {t === 'openai' && openaiOk ? ' ✓' : ''}
            {t === 'anthropic' && anthropicOk ? ' ✓' : ''}
            {t === 'local' && lmRunning ? ' ✓' : ''}
          </button>
        ))}
      </div>

      {tab === 'openai' && (
        <div className="wizard-tab-panel">
          {openaiOk ? (
            <p className="wizard-status-ok">✓ OpenAI API is configured.</p>
          ) : null}
          <label className="wizard-field-label">OpenAI API key</label>
          <div className="wizard-key-row">
            <input
              type="password"
              placeholder={openaiOk ? 'Configured — enter new key to update' : 'sk-...'}
              value={openaiKey}
              autoComplete="off"
              onChange={(e) => setOpenaiKey(e.target.value)}
            />
            <button
              type="button"
              className="primary"
              disabled={saving || !openaiKey.trim()}
              onClick={() => void saveKey('openai')}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
          {saved === 'openai' ? <p className="wizard-status-ok">✓ Saved successfully.</p> : null}
          <p className="wizard-footnote">Get your key at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">platform.openai.com/api-keys</a></p>
        </div>
      )}

      {tab === 'anthropic' && (
        <div className="wizard-tab-panel">
          {anthropicOk ? (
            <p className="wizard-status-ok">✓ Anthropic API is configured.</p>
          ) : null}
          <label className="wizard-field-label">Anthropic API key</label>
          <div className="wizard-key-row">
            <input
              type="password"
              placeholder={anthropicOk ? 'Configured — enter new key to update' : 'sk-ant-...'}
              value={anthropicKey}
              autoComplete="off"
              onChange={(e) => setAnthropicKey(e.target.value)}
            />
            <button
              type="button"
              className="primary"
              disabled={saving || !anthropicKey.trim()}
              onClick={() => void saveKey('anthropic')}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
          {saved === 'anthropic' ? <p className="wizard-status-ok">✓ Saved successfully.</p> : null}
          <p className="wizard-footnote">Get your key at <a href="https://console.anthropic.com/account/keys" target="_blank" rel="noreferrer">console.anthropic.com</a></p>
        </div>
      )}

      {tab === 'local' && (
        <div className="wizard-tab-panel">
          {lmRunning ? (
            <p className="wizard-status-ok">✓ LM Studio is running with {dashboard.lmStudio.loadedCount} model(s) loaded.</p>
          ) : (
            <>
              <p>LM Studio is not detected. Download it to run AI models fully locally.</p>
              <a
                href="https://lmstudio.ai"
                target="_blank"
                rel="noreferrer"
                className="wizard-external-link"
              >
                Download LM Studio →
              </a>
              <p className="wizard-footnote">Once installed and running, load a model in LM Studio, then come back.</p>
            </>
          )}
          {dashboard.lmStudio.loadedModels.length > 0 && (
            <ul className="wizard-bullets">
              {dashboard.lmStudio.loadedModels.map((m) => (
                <li key={m}>📦 {m}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error ? <p className="wizard-error">{error}</p> : null}
    </div>
  );
}

function StepChannels({ dashboard, onRefresh }: { dashboard: DashboardSnapshot; onRefresh: () => Promise<void> }) {
  const channelWorkers = dashboard.workers.filter((w) => w.kind === 'channel');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggleWorker(worker: WorkerSummary) {
    setBusy(worker.id);
    setError(null);
    try {
      const res = await fetch(`/api/workers/${encodeURIComponent(worker.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !worker.enabled }),
      });
      if (!res.ok) throw new Error(await res.text());
      await onRefresh();
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
          Channels let BFrost send you messages (Telegram, Discord) or receive your commands. The dashboard chat is always available and needs no setup.
        </p>
        <div className="wizard-empty-notice">
          No channel workers are installed yet. You can install them later from the <strong>Store</strong> or <strong>Workers</strong> tab.
        </div>
        <p className="wizard-footnote">Skip this step — you can always add channels later.</p>
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
              {busy === w.id ? '…' : w.enabled ? 'Disable' : 'Enable'}
            </button>
          </div>
        ))}
      </div>
      {error ? <p className="wizard-error">{error}</p> : null}
      <p className="wizard-footnote">Configure channel credentials from the Channels tab after closing this wizard.</p>
    </div>
  );
}

function StepWorkers({ dashboard, onRefresh }: { dashboard: DashboardSnapshot; onRefresh: () => Promise<void> }) {
  const starterWorkers = dashboard.workers.filter((w) => w.kind === 'feature' && !w.missing);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggleWorker(worker: WorkerSummary) {
    setBusy(worker.id);
    setError(null);
    try {
      const res = await fetch(`/api/workers/${encodeURIComponent(worker.id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !worker.enabled }),
      });
      if (!res.ok) throw new Error(await res.text());
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(null);
    }
  }

  if (starterWorkers.length === 0) {
    return (
      <div className="wizard-step-body">
        <h2>Enable a worker</h2>
        <p className="wizard-lead">No feature workers found. Install workers from the Store tab.</p>
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
              {busy === w.id ? '…' : w.enabled ? 'Disable' : 'Enable'}
            </button>
          </div>
        ))}
      </div>
      {error ? <p className="wizard-error">{error}</p> : null}
    </div>
  );
}

function StepCredentials({
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
          All enabled workers look healthy — no credentials are missing. 🎉
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

function StepFirstRun({
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
          No enabled jobs found yet. Enable a worker first — then trigger its job from the Jobs tab.
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
                {j.running ? 'Running…' : busy === j.name ? 'Starting…' : triggered === j.name ? 'Triggered ✓' : 'Run now'}
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

// ────────────────────────────────────────────────────────────────────────────
// Main Wizard component
// ────────────────────────────────────────────────────────────────────────────

export function Wizard({ dashboard, onDismiss, onComplete, onRefreshDashboard, onNavigate }: WizardProps) {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);

  // Load persisted step on mount
  useEffect(() => {
    fetch('/api/wizard/state')
      .then((r) => r.json() as Promise<{ step: number; completed: boolean }>)
      .then((s) => {
        if (!s.completed) setStep(s.step ?? 0);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  async function goTo(nextStep: number) {
    setStep(nextStep);
    await persistStep(nextStep);
  }

  async function finish() {
    await markCompleted();
    onComplete();
  }

  function handleNavigate(tab: string) {
    void markCompleted();
    onNavigate(tab);
  }

  if (loading) {
    return (
      <div className="wizard-overlay" role="dialog" aria-modal="true" aria-label="Setup wizard">
        <div className="wizard-shell">
          <p className="wizard-loading">Loading…</p>
        </div>
      </div>
    );
  }

  const isFirst = step === 0;
  const isLast = step === TOTAL_STEPS - 1;

  return (
    <div className="wizard-overlay" role="dialog" aria-modal="true" aria-label="Setup wizard">
      <div className="wizard-shell">
        {/* Header */}
        <div className="wizard-header">
          <div className="wizard-progress-labels">
            {STEP_LABELS.map((label, i) => (
              <span
                key={i}
                className={`wizard-progress-label${i === step ? ' active' : i < step ? ' done' : ''}`}
              >
                {i < step ? '✓' : i + 1}. {label}
              </span>
            ))}
          </div>
          <button
            type="button"
            className="wizard-close"
            onClick={onDismiss}
            aria-label="Close wizard"
          >
            ✕
          </button>
        </div>

        {/* Progress bar */}
        <div className="wizard-progress-bar" role="progressbar" aria-valuenow={step} aria-valuemin={0} aria-valuemax={TOTAL_STEPS - 1}>
          <div
            className="wizard-progress-fill"
            style={{ width: `${((step) / (TOTAL_STEPS - 1)) * 100}%` }}
          />
        </div>

        {/* Step content */}
        <div className="wizard-content">
          {step === 0 && <StepWelcome />}
          {step === 1 && <StepModel dashboard={dashboard} onRefresh={onRefreshDashboard} />}
          {step === 2 && <StepChannels dashboard={dashboard} onRefresh={onRefreshDashboard} />}
          {step === 3 && <StepWorkers dashboard={dashboard} onRefresh={onRefreshDashboard} />}
          {step === 4 && <StepCredentials dashboard={dashboard} onNavigate={handleNavigate} />}
          {step === 5 && <StepFirstRun dashboard={dashboard} onRefresh={onRefreshDashboard} />}
        </div>

        {/* Footer navigation */}
        <div className="wizard-footer">
          <div className="wizard-footer-left">
            {!isFirst ? (
              <button type="button" onClick={() => void goTo(step - 1)}>
                ← Back
              </button>
            ) : (
              <button type="button" onClick={onDismiss}>
                Skip setup
              </button>
            )}
          </div>
          <div className="wizard-footer-right">
            {!isLast ? (
              <>
                <button type="button" onClick={() => void goTo(step + 1)}>
                  Skip →
                </button>
                <button
                  type="button"
                  className="primary"
                  onClick={() => void goTo(step + 1)}
                >
                  Next →
                </button>
              </>
            ) : (
              <button
                type="button"
                className="primary"
                onClick={() => void finish()}
              >
                Finish setup ✓
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
