/**
 * First-run Setup Wizard (LOWCODE_ROADMAP Workstream A).
 *
 * A full-screen overlay that guides first-time users through 8 steps:
 *   0  Welcome
 *   1  Pick a model provider (Local / OpenAI / Anthropic)
 *   2  Embedding model (long-term memory provider/model)
 *   3  Pick channels (enable channel workers)
 *   4  Pick starter workers
 *   5  Credentials review (unhealthy workers → go to Config)
 *   6  First run (trigger a job, see output)
 *   7  Platform & security (password, session, local code, job timeout)
 *
 * State is persisted via POST /api/wizard/state so the user can quit and
 * resume.  The wizard auto-opens when wizard.completed === false; it can be
 * re-triggered from the "Getting started" checklist.
 */

import { useState, useEffect, useRef } from 'react';

// ── Shared types (duplicated from App.tsx to keep the component self-contained)

type WorkerKind = 'feature' | 'channel' | 'provider';
type WorkerHealthState =
  | 'healthy'
  | 'degraded'
  | 'missing'
  | 'unconfigured'
  | 'missing_credentials'
  | 'missing_dependency'
  | 'disabled';

interface WorkerSummary {
  id: string;
  name: string;
  displayName?: string;
  tagline?: string;
  description: string;
  kind: WorkerKind;
  builtIn: boolean;
  /** Only true for built-in workers that are optional features (not core infrastructure). */
  deletable?: boolean;
  enabled: boolean;
  missing: boolean;
  healthState: WorkerHealthState;
  healthDetail: string;
  jobCount: number;
  enabledJobCount: number;
  onboarding?: WorkerOnboardingAction;
}

interface WorkerOnboardingAction {
  id: string;
  title: string;
  description: string;
  endpoint?: string;
  runJob?: string;
  priority?: number;
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

interface PlatformSettings {
  embeddingProvider: string;
  embeddingModel: string;
  adminPasswordSet: boolean;
  localWorkerCodeEnabled: boolean;
  adminSessionTtlHours: number;
  jobLlmTimeoutMs: number;
}

interface DashboardSnapshot {
  workers: WorkerSummary[];
  cron: { jobs: SchedulerJobState[] };
  integrations: Record<string, IntegrationStatus>;
  lmStudio: { running: boolean; loadedModels: string[]; loadedCount: number };
  platform: PlatformSettings;
  dependencies?: { embeddingModelReachable?: { ok: boolean } };
}

export interface WizardProps {
  dashboard: DashboardSnapshot;
  onDismiss: () => void;
  onComplete: () => void;
  /** Called after wizard mutates data so App.tsx refreshes its dashboard snapshot. */
  onRefreshDashboard: () => Promise<void>;
  /** Navigate to a specific main-app tab (closes wizard first). */
  onNavigate: (tab: string) => void;
  /** If provided, demo CTA closes the wizard and hands the action to App.tsx for narration. */
  onRunDemoAction?: (action: { workerId: string; id: string; endpoint?: string; runJob?: string }) => void;
}

const TOTAL_STEPS = 8;

// ── Step labels for the progress bar
const STEP_LABELS = [
  'Welcome',
  'Model',
  'Embedding',
  'Channels',
  'Workers',
  'Credentials',
  'First run',
  'Security',
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

interface OnboardingActionEntry extends WorkerOnboardingAction {
  workerId: string;
}

/** Collect every onboarding CTA the worker registry exposes, most prominent first. */
function collectOnboardingActions(dashboard: DashboardSnapshot): OnboardingActionEntry[] {
  return dashboard.workers
    .filter((w) => w.onboarding && w.enabled)
    .map((w) => ({ ...(w.onboarding as WorkerOnboardingAction), workerId: w.id }))
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
}

type OnboardingOutcome = { status: 'success' | 'error'; summary: string };

/** Call a worker-owned onboarding endpoint and return its `{ summary }` directly. */
async function runOnboardingEndpoint(endpoint: string): Promise<OnboardingOutcome> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: '{}',
  });
  if (!res.ok) throw new Error((await res.text()) || 'Request failed');
  const body = (await res.json().catch(() => ({}))) as { summary?: string };
  return { status: 'success', summary: body.summary ?? 'Done — open the Queue to see the results.' };
}

/** Trigger a scheduled job and poll the dashboard until it reports a terminal status. */
async function runOnboardingJob(jobName: string): Promise<OnboardingOutcome> {
  const after = Date.now();
  const res = await fetch(`/api/cron-jobs/${encodeURIComponent(jobName)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'run' }),
  });
  if (!res.ok) throw new Error(await res.text());
  for (let attempt = 0; attempt < 15; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    try {
      const snapRes = await fetch('/api/dashboard', { credentials: 'include' });
      if (!snapRes.ok) continue;
      const snap = (await snapRes.json()) as DashboardSnapshot;
      const job = snap.cron?.jobs?.find((j) => j.name === jobName);
      if (!job || !job.lastStartedAt || job.running) continue;
      if (new Date(job.lastStartedAt).getTime() < after - 3000) continue; // wait for our run, not a prior one
      if (job.lastStatus === 'success') return { status: 'success', summary: job.lastSummary ?? 'Done.' };
      if (job.lastStatus === 'error') return { status: 'error', summary: job.lastError ?? 'The demo job failed.' };
    } catch {
      // transient — keep polling
    }
  }
  return { status: 'success', summary: 'Started — open the Queue to see the results.' };
}

/**
 * Generic first-run call-to-action list. Renders whatever onboarding actions the worker
 * registry exposes — it references no worker by name. Activating one triggers that worker's
 * job via the standard run endpoint and polls for the result so the payoff lands inline,
 * here in the welcome step, instead of sending the user off to another tab.
 */
function OnboardingActions({
  dashboard,
  onRefresh,
  onRunDemoAction,
}: {
  dashboard: DashboardSnapshot;
  onRefresh: () => Promise<void>;
  onRunDemoAction?: (action: OnboardingActionEntry) => void;
}) {
  const actions = collectOnboardingActions(dashboard);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ status: 'success' | 'error'; summary: string } | null>(null);

  if (actions.length === 0) return null;

  async function activate(action: OnboardingActionEntry) {
    if (onRunDemoAction) { onRunDemoAction(action); return; }
    setBusy(action.id);
    setResult(null);
    try {
      const outcome = action.endpoint
        ? await runOnboardingEndpoint(action.endpoint)
        : action.runJob
          ? await runOnboardingJob(action.runJob)
          : null;
      if (!outcome) return;
      await onRefresh();
      setResult(outcome);
    } catch (err) {
      setResult({ status: 'error', summary: err instanceof Error ? err.message : 'Demo failed to run.' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="wizard-onboarding">
      <p className="wizard-onboarding-kicker">Just exploring? See it work first — no setup needed:</p>
      {actions.map((action) => (
        <div key={`${action.workerId}:${action.id}`} className="wizard-onboarding-action">
          <button
            type="button"
            className="primary"
            disabled={busy !== null}
            onClick={() => void activate(action)}
          >
            {busy === action.id ? 'Running…' : action.title}
          </button>
          <span className="wizard-onboarding-desc footnote">{action.description}</span>
        </div>
      ))}
      {result ? (
        <p className={result.status === 'success' ? 'wizard-status-ok' : 'wizard-error'}>
          {result.status === 'success' ? '✓ ' : '✗ '}
          {result.summary}
        </p>
      ) : null}
    </div>
  );
}

function StepWelcome({
  dashboard,
  onRefresh,
  onRunDemoAction,
}: {
  dashboard: DashboardSnapshot;
  onRefresh: () => Promise<void>;
  onRunDemoAction?: (action: OnboardingActionEntry) => void;
}) {
  return (
    <div className="wizard-step-body">
      <div className="wizard-hero">
        <div className="wizard-hero-icon" aria-hidden="true">⚙️</div>
        <h2>Welcome to BFrost</h2>
        <p className="wizard-lead">
          BFrost is a <strong>worker-first local AI operations platform</strong>. Every
          capability — news digests, research, publishing — is a worker you install, configure, and schedule. Nothing runs in the cloud unless you choose it.
        </p>
        <OnboardingActions dashboard={dashboard} onRefresh={onRefresh} onRunDemoAction={onRunDemoAction} />
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
      const endpoint = provider === 'openai'
        ? '/api/workers/providers-openai/credentials'
        : '/api/workers/providers-anthropic/credentials';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: key.trim() }),
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

      <div className="wizard-tabs" role="tablist" aria-label="Model provider">
        {(['openai', 'anthropic', 'local'] as const).map((t) => (
          <button
            key={t}
            id={`wizard-tab-${t}`}
            role="tab"
            type="button"
            aria-selected={tab === t}
            aria-controls={`wizard-panel-${t}`}
            tabIndex={tab === t ? 0 : -1}
            className={`wizard-tab${tab === t ? ' active' : ''}`}
            onClick={() => setTab(t)}
            onKeyDown={(e) => {
              const tabs = ['openai', 'anthropic', 'local'] as const;
              const idx = tabs.indexOf(t);
              if (e.key === 'ArrowRight') setTab(tabs[(idx + 1) % tabs.length]);
              if (e.key === 'ArrowLeft') setTab(tabs[(idx + tabs.length - 1) % tabs.length]);
            }}
          >
            {t === 'openai' ? 'OpenAI' : t === 'anthropic' ? 'Anthropic' : 'Local (LM Studio)'}
            {t === 'openai' && openaiOk ? ' ✓' : ''}
            {t === 'anthropic' && anthropicOk ? ' ✓' : ''}
            {t === 'local' && lmRunning ? ' ✓' : ''}
          </button>
        ))}
      </div>

      <div
        id="wizard-panel-openai"
        role="tabpanel"
        aria-labelledby="wizard-tab-openai"
        hidden={tab !== 'openai'}
        className="wizard-tab-panel"
      >
        {openaiOk ? (
          <p className="wizard-status-ok">✓ OpenAI API is configured.</p>
        ) : null}
        <label className="wizard-field-label" htmlFor="wizard-openai-key">OpenAI API key</label>
        <div className="wizard-key-row">
          <input
            id="wizard-openai-key"
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

      <div
        id="wizard-panel-anthropic"
        role="tabpanel"
        aria-labelledby="wizard-tab-anthropic"
        hidden={tab !== 'anthropic'}
        className="wizard-tab-panel"
      >
        {anthropicOk ? (
          <p className="wizard-status-ok">✓ Anthropic API is configured.</p>
        ) : null}
        <label className="wizard-field-label" htmlFor="wizard-anthropic-key">Anthropic API key</label>
        <div className="wizard-key-row">
          <input
            id="wizard-anthropic-key"
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

      <div
        id="wizard-panel-local"
        role="tabpanel"
        aria-labelledby="wizard-tab-local"
        hidden={tab !== 'local'}
        className="wizard-tab-panel"
      >
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

      {error ? <p className="wizard-error">{error}</p> : null}
    </div>
  );
}

function StepEmbedding({ dashboard, onRefresh }: { dashboard: DashboardSnapshot; onRefresh: () => Promise<void> }) {
  const platform = dashboard.platform;
  const reachable = dashboard.dependencies?.embeddingModelReachable?.ok ?? false;
  const [provider, setProvider] = useState<'local' | 'openai'>(
    platform?.embeddingProvider === 'openai' ? 'openai' : 'local',
  );
  const [model, setModel] = useState(platform?.embeddingModel ?? '');
  const [localModels, setLocalModels] = useState<Array<{ id: string; label: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Local embedding models are served by the active LM Studio / Ollama runtime. Fetched from
  // the core endpoint so the wizard never hard-codes a model list (the memory worker owns that).
  useEffect(() => {
    if (provider !== 'local') return;
    let cancelled = false;
    fetch('/api/dashboard/local-embedding-models', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { models: [] }))
      .then((d: { models?: Array<{ id: string; label: string }> }) => {
        if (!cancelled) setLocalModels(d.models ?? []);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [provider]);

  const canSave = !!model.trim();

  async function save() {
    if (!model.trim()) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch('/api/embedding-settings', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model: model.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSaved(true);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="wizard-step-body">
      <h2>Long-term memory embeddings</h2>
      <p className="wizard-lead">
        Workers that remember things turn text into vectors with an embedding model. Pick where those
        embeddings come from — a local model keeps everything on your machine; OpenAI is faster to set up.
      </p>
      {reachable ? (
        <p className="wizard-status-ok">✓ Current embedding model is reachable ({platform?.embeddingProvider} · {platform?.embeddingModel}).</p>
      ) : null}

      <label className="wizard-field-label" htmlFor="wizard-embedding-provider">Provider</label>
      <select
        id="wizard-embedding-provider"
        value={provider}
        onChange={(e) => {
          setProvider(e.target.value as 'local' | 'openai');
          setModel('');
          setSaved(false);
        }}
      >
        <option value="local">Local (LM Studio / Ollama)</option>
        <option value="openai">OpenAI</option>
      </select>

      <label className="wizard-field-label" htmlFor="wizard-embedding-model">Model</label>
      {provider === 'local' ? (
        localModels.length > 0 ? (
          <select id="wizard-embedding-model" value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">Select a model…</option>
            {localModels.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        ) : (
          <>
            <input
              id="wizard-embedding-model"
              type="text"
              placeholder="e.g. nomic-embed-text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
            <p className="wizard-footnote">No local embedding models detected. Load one in LM Studio / Ollama, or type its id.</p>
          </>
        )
      ) : (
        <>
          <input
            id="wizard-embedding-model"
            type="text"
            placeholder="e.g. text-embedding-3-small"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
          <p className="wizard-footnote">Uses your OpenAI API key from the Model step. Requires the embeddings endpoint.</p>
        </>
      )}

      <div className="wizard-key-row" style={{ marginTop: '0.75rem' }}>
        <button type="button" className="primary" disabled={saving || !canSave} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save embedding model'}
        </button>
      </div>
      {saved ? <p className="wizard-status-ok">✓ Saved successfully.</p> : null}
      {error ? <p className="wizard-error">{error}</p> : null}
      <p className="wizard-footnote">Optional — skip to keep the default. You can change this later from the Config tab.</p>
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
  // Show only optional feature workers: built-ins flagged deletable (news, research, publisher…)
  // plus any local/community workers (which are always optional by definition).
  // Core infrastructure workers (control panel, bus inspector, memory, article reader, etc.)
  // are never shown here — disabling them would break the platform for the user.
  const starterWorkers = dashboard.workers.filter(
    (w) => w.kind === 'feature' && !w.missing && (!w.builtIn || w.deletable === true),
  );
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

function StepSecurity({ dashboard, onRefresh }: { dashboard: DashboardSnapshot; onRefresh: () => Promise<void> }) {
  const platform = dashboard.platform;
  const [password, setPassword] = useState('');
  const [ttl, setTtl] = useState(String(platform?.adminSessionTtlHours ?? 12));
  const [jobTimeout, setJobTimeout] = useState(String(platform?.jobLlmTimeoutMs ?? 120000));
  const [localCode, setLocalCode] = useState(platform?.localWorkerCodeEnabled ?? false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [savedSettings, setSavedSettings] = useState(false);
  const [passwordSet, setPasswordSet] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ttlNum = Number(ttl);
  const timeoutNum = Number(jobTimeout);

  async function saveSettings() {
    setSavingSettings(true);
    setError(null);
    setSavedSettings(false);
    try {
      const body: Record<string, unknown> = { localWorkerCodeEnabled: localCode };
      if (Number.isFinite(ttlNum) && ttlNum > 0) body.adminSessionTtlHours = ttlNum;
      if (Number.isFinite(timeoutNum) && timeoutNum > 0) body.jobLlmTimeoutMs = timeoutNum;
      const res = await fetch('/api/core-settings', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      setSavedSettings(true);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingSettings(false);
    }
  }

  async function savePassword() {
    if (password.trim().length < 4) return;
    setSavingPassword(true);
    setError(null);
    try {
      // Setting a password clears every session, so the next request needs a fresh login.
      // Persist wizard completion FIRST (while still authenticated) so the wizard doesn't
      // reopen after the operator logs back in.
      await fetch('/api/wizard/state', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: true }),
      }).catch(() => undefined);
      const res = await fetch('/api/core-settings', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminPassword: password.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      setPasswordSet(true);
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div className="wizard-step-body">
      <h2>Platform &amp; security</h2>
      <p className="wizard-lead">
        BFrost runs locally and binds to <code>127.0.0.1</code> by default. These controls protect the
        dashboard and govern how workers run. All are optional — sensible defaults already apply.
      </p>

      <label className="wizard-field-label" htmlFor="wizard-admin-password">
        Dashboard password {platform?.adminPasswordSet ? '(currently set)' : '(not set — dashboard is open)'}
      </label>
      <div className="wizard-key-row">
        <input
          id="wizard-admin-password"
          type="password"
          placeholder={platform?.adminPasswordSet ? 'Enter a new password to change it' : 'Set a password to require login'}
          value={password}
          autoComplete="new-password"
          onChange={(e) => setPassword(e.target.value)}
        />
        <button
          type="button"
          className="primary"
          disabled={savingPassword || password.trim().length < 4}
          onClick={() => void savePassword()}
        >
          {savingPassword ? 'Saving…' : 'Set password'}
        </button>
      </div>
      {passwordSet ? (
        <p className="wizard-status-ok">✓ Password set. You'll be asked to log in again when you close the wizard.</p>
      ) : (
        <p className="wizard-footnote">Minimum 4 characters. Setting it logs out all sessions — do this last.</p>
      )}

      <label className="wizard-field-label" htmlFor="wizard-session-ttl">Login session length (hours)</label>
      <input
        id="wizard-session-ttl"
        type="number"
        min={1}
        value={ttl}
        onChange={(e) => setTtl(e.target.value)}
      />

      <label className="wizard-field-label" htmlFor="wizard-job-timeout">Job model timeout (ms)</label>
      <input
        id="wizard-job-timeout"
        type="number"
        min={1}
        value={jobTimeout}
        onChange={(e) => setJobTimeout(e.target.value)}
      />
      <p className="wizard-footnote">Maximum time a scheduled job's model call may run before it is aborted.</p>

      <label className="checkbox-row" htmlFor="wizard-local-code" style={{ marginTop: '0.75rem' }}>
        <input
          id="wizard-local-code"
          type="checkbox"
          checked={localCode}
          onChange={(e) => setLocalCode(e.target.checked)}
        />
        Allow local worker code execution
      </label>
      <p className="wizard-footnote">
        Leave off (recommended) unless you run local workers that ship executable code you trust. Built-in
        and manifest-only workers always load.
      </p>

      <div className="wizard-key-row" style={{ marginTop: '0.75rem' }}>
        <button type="button" className="primary" disabled={savingSettings} onClick={() => void saveSettings()}>
          {savingSettings ? 'Saving…' : 'Save settings'}
        </button>
      </div>
      {savedSettings ? <p className="wizard-status-ok">✓ Settings saved.</p> : null}
      {error ? <p className="wizard-error">{error}</p> : null}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Main Wizard component
// ────────────────────────────────────────────────────────────────────────────

export function Wizard({ dashboard, onDismiss, onComplete, onRefreshDashboard, onNavigate, onRunDemoAction }: WizardProps) {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const shellRef = useRef<HTMLDivElement>(null);
  // Ref-wrapped callbacks so the focus-trap closure stays stable
  const onDismissRef = useRef(onDismiss);
  useEffect(() => { onDismissRef.current = onDismiss; }, [onDismiss]);

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

  // Focus trap: capture origin, focus first element, trap Tab, close on Escape
  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;

    // Focus the first focusable child once the shell is mounted
    const shell = shellRef.current;
    if (shell) {
      const focusable = shell.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      );
      focusable[0]?.focus();
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onDismissRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const sh = shellRef.current;
      if (!sh) return;
      const focusable = Array.from(
        sh.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.closest('[hidden]'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      prevFocus?.focus();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally mount-only

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
        <div className="wizard-shell" ref={shellRef}>
          <p className="wizard-loading">Loading…</p>
        </div>
      </div>
    );
  }

  const isFirst = step === 0;
  const isLast = step === TOTAL_STEPS - 1;

  return (
    <div className="wizard-overlay" role="dialog" aria-modal="true" aria-labelledby="wizard-step-heading">
      <div className="wizard-shell" ref={shellRef}>
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

        {/* Visually hidden heading used as the dialog's accessible name */}
        <span id="wizard-step-heading" className="sr-only">
          Setup wizard — Step {step + 1} of {TOTAL_STEPS}: {STEP_LABELS[step]}
        </span>

        {/* Step content — aria-live announces step changes to screen readers */}
        <div className="wizard-content" aria-live="polite" aria-atomic="false">
          {step === 0 && <StepWelcome dashboard={dashboard} onRefresh={onRefreshDashboard} onRunDemoAction={onRunDemoAction} />}
          {step === 1 && <StepModel dashboard={dashboard} onRefresh={onRefreshDashboard} />}
          {step === 2 && <StepEmbedding dashboard={dashboard} onRefresh={onRefreshDashboard} />}
          {step === 3 && <StepChannels dashboard={dashboard} onRefresh={onRefreshDashboard} />}
          {step === 4 && <StepWorkers dashboard={dashboard} onRefresh={onRefreshDashboard} />}
          {step === 5 && <StepCredentials dashboard={dashboard} onNavigate={handleNavigate} />}
          {step === 6 && <StepFirstRun dashboard={dashboard} onRefresh={onRefreshDashboard} />}
          {step === 7 && <StepSecurity dashboard={dashboard} onRefresh={onRefreshDashboard} />}
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
