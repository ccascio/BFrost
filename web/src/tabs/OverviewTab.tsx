import type { CSSProperties, Dispatch, SetStateAction } from 'react';
import {
  HelpTip,
  StatusPill,
  buildPipelineTopology,
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

      {(() => {
        const topology = buildPipelineTopology(dashboard.queue.recentItems, dashboard.workers);
        const isEmpty = topology.producers.length === 0 && topology.consumers.length === 0;
        return (
          <section className="panel pipeline-graph-card" aria-label="Item Bus Pipeline">
            <div className="panel-head">
              <div>
                <p className="panel-kicker">Live view</p>
                <h2>Item Bus Pipeline <HelpTip>Every item in the bus organised by producer and consumer. Workers stamp their id into item metadata — this graph is derived from those stamps alone.</HelpTip></h2>
              </div>
              {!isEmpty && <StatusPill tone="muted">{`${topology.totalItems} item${topology.totalItems !== 1 ? 's' : ''}`}</StatusPill>}
            </div>
            {isEmpty ? (
              <div className="empty-state">
                <p>The bus is empty — no items have been produced yet.</p>
                <p className="footnote">Enable a producer worker to start filling the pipeline.</p>
              </div>
            ) : (
              <div className="pipeline-graph">
                <div className="pipeline-col pipeline-producers-col" aria-label="Producers">
                  <p className="pipeline-col-label">Producers</p>
                  {topology.producers.map((node) => (
                    <div key={node.workerId} className="pipeline-node pipeline-node-producer">
                      <strong className="pipeline-node-name">{node.displayName}</strong>
                      <span className="pipeline-node-count">{node.count} item{node.count !== 1 ? 's' : ''}</span>
                      <span className="pipeline-node-types footnote">{node.itemTypes.join(' · ')}</span>
                    </div>
                  ))}
                </div>
                <div className="pipeline-lane" aria-hidden>
                  <div className="pipeline-lane-track">
                    <span className="pipeline-dot" style={{ '--dot-delay': '0s' } as CSSProperties} />
                    <span className="pipeline-dot" style={{ '--dot-delay': '0.5s' } as CSSProperties} />
                    <span className="pipeline-dot" style={{ '--dot-delay': '1.0s' } as CSSProperties} />
                  </div>
                </div>
                <div className="pipeline-bus-col" aria-label="Item Bus">
                  <p className="pipeline-col-label">Item Bus</p>
                  <div className="pipeline-bus-node">
                    <strong className="pipeline-bus-count">{topology.totalItems}</strong>
                    <span className="pipeline-bus-label">items</span>
                    {topology.unconsumedCount > 0 && <span className="pipeline-bus-inflight footnote">{topology.unconsumedCount} queued</span>}
                    {topology.totalItems - topology.unconsumedCount > 0 && <span className="pipeline-bus-consumed footnote">{topology.totalItems - topology.unconsumedCount} consumed</span>}
                  </div>
                </div>
                <div className="pipeline-lane pipeline-lane-right" aria-hidden>
                  <div className="pipeline-lane-track">
                    <span className="pipeline-dot" style={{ '--dot-delay': '0.25s' } as CSSProperties} />
                    <span className="pipeline-dot" style={{ '--dot-delay': '0.75s' } as CSSProperties} />
                    <span className="pipeline-dot" style={{ '--dot-delay': '1.25s' } as CSSProperties} />
                  </div>
                </div>
                <div className="pipeline-col pipeline-consumers-col" aria-label="Consumers">
                  <p className="pipeline-col-label">Consumers</p>
                  {topology.consumers.length > 0 ? topology.consumers.map((node) => (
                    <div key={node.workerId} className="pipeline-node pipeline-node-consumer">
                      <strong className="pipeline-node-name">{node.displayName}</strong>
                      <span className="pipeline-node-count">{node.count} consumed</span>
                      <span className="pipeline-node-types footnote">{node.itemTypes.join(' · ')}</span>
                    </div>
                  )) : (
                    <div className="pipeline-node pipeline-node-empty">
                      <span className="pipeline-node-name muted">No consumers yet</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        );
      })()}
    </section>
  );
}
