import { useState } from 'react';
import type { DashboardSnapshot, OnboardingActionEntry, WorkerOnboardingAction } from './types';

type OnboardingOutcome = { status: 'success' | 'error'; summary: string };

export function collectOnboardingActions(dashboard: DashboardSnapshot): OnboardingActionEntry[] {
  return dashboard.workers
    .filter((w) => w.onboarding && w.enabled)
    .map((w) => ({ ...(w.onboarding as WorkerOnboardingAction), workerId: w.id }))
    .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
}

async function runOnboardingEndpoint(endpoint: string): Promise<OnboardingOutcome> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: '{}',
  });
  if (!res.ok) throw new Error((await res.text()) || 'Request failed');
  const body = (await res.json().catch(() => ({}))) as { summary?: string };
  return { status: 'success', summary: body.summary ?? 'Done - open the Queue to see the results.' };
}

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
      if (new Date(job.lastStartedAt).getTime() < after - 3000) continue;
      if (job.lastStatus === 'success') return { status: 'success', summary: job.lastSummary ?? 'Done.' };
      if (job.lastStatus === 'error') return { status: 'error', summary: job.lastError ?? 'The demo job failed.' };
    } catch {
      // transient; keep polling
    }
  }
  return { status: 'success', summary: 'Started - open the Queue to see the results.' };
}

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
      <p className="wizard-onboarding-kicker">Just exploring? See it work first - no setup needed:</p>
      {actions.map((action) => (
        <div key={`${action.workerId}:${action.id}`} className="wizard-onboarding-action">
          <button
            type="button"
            className="primary"
            disabled={busy !== null}
            onClick={() => void activate(action)}
          >
            {busy === action.id ? 'Running...' : action.title}
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

export function StepWelcome({
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
          capability - news digests, research, publishing - is a worker you install, configure, and schedule. Nothing runs in the cloud unless you choose it.
        </p>
        <OnboardingActions dashboard={dashboard} onRefresh={onRefresh} onRunDemoAction={onRunDemoAction} />
        <ul className="wizard-bullets">
          <li>All data stays on your machine by default</li>
          <li>Works with local models (LM Studio / Ollama) or cloud APIs (OpenAI, Anthropic)</li>
          <li>Workers run on a schedule you control, or on demand</li>
          <li>Delivers results to Telegram, Discord, or the built-in dashboard chat</li>
        </ul>
        <p className="wizard-footnote">This wizard takes about 3 minutes. Every step is skippable.</p>
      </div>
    </div>
  );
}
