import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type { CoreConfigKey, DashboardState, DashboardTab, WorkerSummary } from '../app-types';
import { HelpTip, StatusPill, workerHealthLabel, workerHealthTone } from '../app-helpers';
import type { WorkerDashboardViewDefinition } from '../workers/types';

export interface SettingsWorkerEntry {
  worker: WorkerSummary;
  configPanel: ReactNode;
}

interface ConfigTabProps {
  dashboard: DashboardState;
  configCoreCount: number;
  selectedCoreConfigKey: CoreConfigKey | null;
  setSelectedCoreConfigKey: Dispatch<SetStateAction<CoreConfigKey | null>>;
  dashboardViews: WorkerDashboardViewDefinition[];
  workerViewContext: unknown;
  platformRoutingPanel: ReactNode;
  platformSecurityPanel: ReactNode;
  setActiveTab: (tab: DashboardTab) => void;
  setWizardOpen: Dispatch<SetStateAction<boolean>>;
  settingsWorkerEntries?: SettingsWorkerEntry[];
}

export function ConfigTab(props: ConfigTabProps) {
  const {
    dashboard,
    configCoreCount,
    selectedCoreConfigKey,
    setSelectedCoreConfigKey,
    dashboardViews,
    workerViewContext,
    platformRoutingPanel,
    platformSecurityPanel,
    setActiveTab,
    setWizardOpen,
    settingsWorkerEntries = [],
  } = props;

  const hasModel = dashboard.workers.some(
    (w) => w.kind === 'provider' && w.enabled && w.healthState === 'healthy',
  ) || dashboard.localRuntime?.running;
  const hasChannel = dashboard.workers.some((w) => w.kind === 'channel' && w.healthState === 'healthy');
  const hasEnabledWorker = dashboard.workers.some((w) => w.enabled && w.healthState === 'healthy');
  const hasRun = dashboard.cron.jobs.some((j) => j.lastStartedAt !== null && j.lastStartedAt !== undefined);
  const allDone = hasModel && hasChannel && hasEnabledWorker && hasRun;
  const steps = [
    { done: hasModel, label: 'Connect a model', detail: 'Configure a model provider — add a cloud API key or start your local AI runtime.', action: () => setActiveTab('config') },
    { done: hasChannel, label: 'Connect a channel', detail: 'Set up a channel so BFrost can reach you.', action: () => setActiveTab('channels') },
    { done: hasEnabledWorker, label: 'Enable a worker', detail: 'Turn on a worker from the Workers tab.', action: () => setActiveTab('workers') },
    { done: hasRun, label: 'Let a job run', detail: 'Trigger a job manually from the Jobs tab, or wait for the scheduler.', action: () => setActiveTab('jobs') },
  ];

  return (
    <>
      <section className="panel tab-page">
        <div className="panel-head">
          <div>
            <p className="panel-kicker">Platform</p>
            <h2>Platform settings <HelpTip>Core platform configuration — how BFrost routes model calls, which embedding model it uses for memory, and access-control settings. Worker-specific settings (API keys, job parameters, prompts) live in each worker's Config subtab in the left panel.</HelpTip></h2>
          </div>
          <StatusPill tone="muted">{`${configCoreCount} settings`}</StatusPill>
        </div>

        <div className="jobs-workspace">
          <div className="jobs">
            <section className="job-worker-group">
              <div className="job-worker-head">
                <div>
                  <p className="panel-kicker">Platform</p>
                  <h3>Model providers <HelpTip>A model provider is the AI service BFrost uses to think. Each provider is a worker you can install separately. Configure provider credentials below; BFrost uses the cheapest model that can handle the task unless you specify otherwise.</HelpTip></h3>
                  <span>Local credential configuration</span>
                </div>
                {(() => {
                  const localProviderIds = new Set(dashboard.availableLocalProviders.map((p) => p.workerId));
                  const anyCloudProviderConfigured = dashboard.workers
                    .filter((w) => w.kind === 'provider' && !localProviderIds.has(w.id))
                    .some((w) => w.healthState === 'healthy');
                  return (
                    <StatusPill tone={anyCloudProviderConfigured ? 'good' : 'warning'}>
                      {anyCloudProviderConfigured ? 'Configured' : 'Missing'}
                    </StatusPill>
                  );
                })()}
              </div>

              <div className="stack-list compact">
                <button
                  className={`run-item run-button job-row-button${selectedCoreConfigKey === 'platform-routing' ? ' selected' : ''}`}
                  type="button"
                  aria-pressed={selectedCoreConfigKey === 'platform-routing'}
                  onClick={() => {
                    setSelectedCoreConfigKey('platform-routing');
                  }}
                >
                  <div>
                    <strong>Platform routing</strong>
                    <span>Active local LLM platform and primary channel for operator notifications.</span>
                    <span>{dashboard.platform.activeLocalProviderId} · {dashboard.platform.primaryChannelId}</span>
                  </div>
                  <StatusPill tone="muted">Setting</StatusPill>
                </button>
                <button
                  className={`run-item run-button job-row-button${selectedCoreConfigKey === 'embedding-model' ? ' selected' : ''}`}
                  type="button"
                  aria-pressed={selectedCoreConfigKey === 'embedding-model'}
                  onClick={() => {
                    setSelectedCoreConfigKey('embedding-model');
                  }}
                >
                  <div>
                    <strong>Embedding model</strong>
                    <span>Provider and model used for long-term memory embeddings.</span>
                    <span>{dashboard?.platform.embeddingProvider ?? '—'} · {dashboard?.platform.embeddingModel ?? '—'}</span>
                  </div>
                  <StatusPill tone={dashboard?.dependencies.embeddingModelReachable.ok ? 'good' : 'warning'}>
                    {dashboard?.dependencies.embeddingModelReachable.ok ? 'Ready' : 'Not configured'}
                  </StatusPill>
                </button>
              </div>
            </section>

            <section className="job-worker-group">
              <div className="job-worker-head">
                <div>
                  <p className="panel-kicker">Platform</p>
                  <h3>Platform &amp; security <HelpTip>Controls that protect and govern the whole platform rather than any single worker — dashboard password and login session length, whether local-worker code is allowed to execute, and the per-job timeout. These are not model-provider settings.</HelpTip></h3>
                  <span>Access control and execution safety</span>
                </div>
                <StatusPill tone={dashboard?.platform.adminPasswordSet ? 'good' : 'warning'}>
                  {dashboard?.platform.adminPasswordSet ? 'Protected' : 'No password'}
                </StatusPill>
              </div>

              <div className="stack-list compact">
                <button
                  className={`run-item run-button job-row-button${selectedCoreConfigKey === 'platform-security' ? ' selected' : ''}`}
                  type="button"
                  aria-pressed={selectedCoreConfigKey === 'platform-security'}
                  onClick={() => {
                    setSelectedCoreConfigKey('platform-security');
                  }}
                >
                  <div>
                    <strong>Platform &amp; security</strong>
                    <span>Dashboard password, login session length, local-worker code execution, and job timeout.</span>
                    <span>
                      Auth {dashboard?.platform.adminPasswordSet ? 'on' : 'off'} · Local code{' '}
                      {dashboard?.platform.localWorkerCodeEnabled ? 'allowed' : 'blocked'}
                    </span>
                  </div>
                  <StatusPill tone="muted">Setting</StatusPill>
                </button>
              </div>
            </section>

            {settingsWorkerEntries.map(({ worker }) => {
              const key = `worker:${worker.id}` as CoreConfigKey;
              return (
                <section key={worker.id} className="job-worker-group">
                  <div className="job-worker-head">
                    <div>
                      <p className="panel-kicker">System</p>
                      <h3>{worker.displayName ?? worker.name}</h3>
                      <span>{worker.description}</span>
                    </div>
                    <StatusPill tone={workerHealthTone(worker.healthState)}>
                      {workerHealthLabel(worker.healthState)}
                    </StatusPill>
                  </div>
                  <div className="stack-list compact">
                    <button
                      className={`run-item run-button job-row-button${selectedCoreConfigKey === key ? ' selected' : ''}`}
                      type="button"
                      aria-pressed={selectedCoreConfigKey === key}
                      onClick={() => setSelectedCoreConfigKey(key)}
                    >
                      <div>
                        <strong>{worker.displayName ?? worker.name}</strong>
                        <span>{worker.tagline ?? worker.description}</span>
                      </div>
                      <StatusPill tone="muted">Config</StatusPill>
                    </button>
                  </div>
                </section>
              );
            })}
          </div>

          <aside className="queue-detail-column config-detail-column">
            <section className="detail-panel config-detail-panel">
              <div className="panel-head">
                <div>
                  <p className="panel-kicker">Configuration</p>
                  <h2>{selectedCoreConfigKey === 'platform-routing' ? 'Platform routing' : selectedCoreConfigKey === 'embedding-model' ? 'Embedding model' : selectedCoreConfigKey === 'platform-security' ? 'Platform & security' : 'Platform settings'}</h2>
                </div>
                {selectedCoreConfigKey ? <StatusPill tone="muted">Platform</StatusPill> : null}
              </div>

              {selectedCoreConfigKey === 'platform-routing' ? platformRoutingPanel : null}
              {selectedCoreConfigKey === 'embedding-model'
                ? (dashboardViews.find((v) => v.kind === 'embedding-config')?.render?.(workerViewContext as Parameters<NonNullable<WorkerDashboardViewDefinition['render']>>[0]) ?? null)
                : null}
              {selectedCoreConfigKey === 'platform-security' ? platformSecurityPanel : null}
              {selectedCoreConfigKey?.startsWith('worker:')
                ? (settingsWorkerEntries.find((e) => `worker:${e.worker.id}` === selectedCoreConfigKey)?.configPanel ?? null)
                : null}
              {!selectedCoreConfigKey ? (
                <p className="empty-state">Select a platform setting on the left to configure it. Worker settings are in each worker's Config subtab.</p>
              ) : null}
            </section>
          </aside>
        </div>
      </section>

      <section className="panel tab-page">
        <div className="panel-head">
          <div>
            <p className="panel-kicker">Setup</p>
            <h2>Getting started</h2>
          </div>
          {allDone ? <StatusPill tone="good">All done ✓</StatusPill> : <StatusPill tone="info">{`${steps.filter((s) => s.done).length}/${steps.length} complete`}</StatusPill>}
        </div>
        <div className="detail-body">
          <ol className="getting-started-list">
            {steps.map((step, i) => (
              <li key={i} className={`getting-started-step ${step.done ? 'done' : ''}`}>
                <span className="step-check">{step.done ? '✓' : (i + 1)}</span>
                <div>
                  <strong>{step.label}</strong>
                  <span className="footnote">{step.detail}</span>
                </div>
                {!step.done ? (
                  <button type="button" onClick={step.action}>Go →</button>
                ) : null}
              </li>
            ))}
          </ol>
          <div className="panel-actions" style={{ marginTop: '0.75rem' }}>
            <button
              type="button"
              className="primary"
              onClick={() => setWizardOpen(true)}
            >
              Open setup wizard
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
