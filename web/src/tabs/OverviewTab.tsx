import type { Dispatch, SetStateAction } from 'react';
import {
  HelpTip,
  StatusPill,
  eventSeverityTone,
  formatDate,
  workerHealthLabel,
  workerHealthTone,
} from '../app-helpers';
import type { WorkerDashboardViewDefinition } from '../workers/types';
import {
  OverviewSetupPanels,
  type OverviewSetupPanelsProps,
} from './OverviewSetupPanels';
import { OverviewModelPanel } from './OverviewModelPanel';

interface OverviewTabProps extends OverviewSetupPanelsProps {
  openChatFromOverview: () => void;
  dashboardViews: WorkerDashboardViewDefinition[];
  workerViewContext: unknown;
  selectedModelAlias: string;
  setSelectedModelAlias: Dispatch<SetStateAction<string>>;
  saveDefaultModel: (alias: string) => void;
  setNotice: Dispatch<SetStateAction<string>>;
}

export function OverviewTab(props: OverviewTabProps) {
  const {
    dashboard,
    busyKey,
    setBusyKey,
    setActiveTab,
    fetchDashboard,
    openChatFromOverview,
    dashboardViews,
    workerViewContext,
    selectedModelAlias,
    setSelectedModelAlias,
    saveDefaultModel,
    setNotice,
  } = props;
  const activeWorkers = dashboard.workers.filter(
    (worker) => worker.enabled && (worker.healthState === 'healthy' || worker.runningJobCount > 0),
  );

  return (
    <section className="tab-page">
      <OverviewSetupPanels {...props} />

      <section className="overview-chat-panel" aria-label="Dashboard chat quick entry">
        <p className="panel-kicker">Assistant</p>
        <label className="overview-chat-launcher">
          <span>Ask BFrost</span>
          <input
            type="text"
            readOnly
            value=""
            placeholder="Ask about workers, schedules, queue items, or models"
            onFocus={openChatFromOverview}
            onClick={openChatFromOverview}
          />
        </label>
      </section>
      <section className="grid top-grid">
        <OverviewModelPanel
          dashboard={dashboard}
          busyKey={busyKey}
          selectedModelAlias={selectedModelAlias}
          setSelectedModelAlias={setSelectedModelAlias}
          saveDefaultModel={saveDefaultModel}
        />
        {(() => {
          // Render the active local provider's runtime panel from its worker bundle.
          const localProvider = dashboard.availableLocalProviders.find(
            (provider) => provider.id === dashboard.platform.activeLocalProviderId,
          );
          const localProviderWorker = localProvider
            ? dashboard.workers.find((worker) => worker.id === localProvider.workerId)
            : undefined;
          const localProviderView = localProvider
            ? dashboardViews.find((view) => view.workerId === localProvider.workerId)
            : undefined;
          if (!localProviderView?.render || !localProviderWorker?.enabled) return null;
          return localProviderView.render(workerViewContext as Parameters<NonNullable<typeof localProviderView.render>>[0]);
        })()}
      </section>

      <section className="grid overview-grid">
        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">Capabilities</p>
              <h2>Active workers <HelpTip>Workers that are healthy and ready to run. Workers missing credentials won't appear here — configure them in the Workers tab, then they'll show up once healthy.</HelpTip></h2>
            </div>
            <StatusPill tone={dashboard.workers.some((w) => w.healthState === 'healthy') ? 'good' : 'muted'}>
              {`${dashboard.workers.filter((w) => w.healthState === 'healthy').length} healthy`}
            </StatusPill>
          </div>
          <div className="stack-list compact">
            {activeWorkers.map((worker) => (
              <div className="summary-row" key={`${worker.id}-overview`}>
                <div>
                  <strong>{worker.displayName ?? worker.name}</strong>
                  <span>{worker.tagline ?? worker.description}</span>
                  <span>{worker.builtIn ? 'built-in' : 'local'} · {worker.jobCount} jobs</span>
                </div>
                <StatusPill tone={workerHealthTone(worker.healthState)}>
                  {worker.runningJobCount > 0 ? 'running' : workerHealthLabel(worker.healthState)}
                </StatusPill>
              </div>
            ))}
            {activeWorkers.length === 0 ? (
              <div className="empty-state">
                <p>No workers are active yet.</p>
                <p className="footnote">
                  Run the demo above to see the pipeline in action, or open Workers to enable and configure your first worker.
                </p>
                <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
                  <button type="button" onClick={() => setActiveTab('workers')}>
                    Open Workers
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">Activity</p>
              <h2>Recent events <HelpTip>A live log of everything BFrost has done — collected items, ran a job, published an outcome, recorded an error. Events are stored locally; nothing is sent to any server.</HelpTip></h2>
            </div>
            <StatusPill tone="muted">{`${dashboard.events.length} stored`}</StatusPill>
          </div>
          <div className="stack-list compact">
            {dashboard.events.slice(0, 8).map((event) => (
              <div className="summary-row" key={`${event.id}-overview`}>
                <div>
                  <strong>{event.summary}</strong>
                  <span>{event.category} · {event.action}</span>
                  <span>{formatDate(event.createdAt)}</span>
                </div>
                <StatusPill tone={eventSeverityTone(event.severity)}>{event.severity}</StatusPill>
              </div>
            ))}
            {dashboard.events.length === 0 ? (
              <div className="empty-state">
                <p>Nothing has happened here yet.</p>
                <p className="footnote">
                  Events show up when a worker runs, finishes, or changes state. Enable a worker
                  to start collecting activity, or open Chat to ask the assistant a question.
                </p>
                <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
                  <button type="button" onClick={() => setActiveTab('workers')}>
                    Open Workers
                  </button>
                  <button type="button" onClick={() => setActiveTab('chat')}>
                    Open Chat
                  </button>
                  <button
                    type="button"
                    disabled={busyKey === 'seed-sample-data'}
                    onClick={() => void (async () => {
                      setBusyKey('seed-sample-data');
                      try {
                        await fetch('/api/admin/seed-sample-data', { method: 'POST', credentials: 'include' });
                        await fetchDashboard(true);
                        setNotice('Sample data loaded — browse the Jobs tab to see queued items.');
                      } finally { setBusyKey(null); }
                    })()}
                  >
                    {busyKey === 'seed-sample-data' ? 'Loading…' : 'Load sample data'}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </article>
      </section>
    </section>
  );
}
