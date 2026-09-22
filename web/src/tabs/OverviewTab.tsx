import type { Dispatch, SetStateAction } from 'react';
import {
  HelpTip,
  StatusPill,
  PipelineStageBlocks,
  eventSeverityTone,
  formatDate,
  formatRelativeTime,
  workerHealthLabel,
  workerHealthTone,
} from '../app-helpers';
import { Icon } from '../icons';
import { Skeleton, SkeletonRegion, SkeletonRows } from '../ui';
import type { DashboardSectionName } from '../app-types';
import type { WorkerDashboardViewDefinition } from '../workers/types';
import {
  OverviewSetupPanels,
  type OverviewSetupPanelsProps,
} from './OverviewSetupPanels';
import { OverviewModelPanel } from './OverviewModelPanel';
import { OverviewRecipesPanel } from './OverviewRecipesPanel';

interface OverviewTabProps extends OverviewSetupPanelsProps {
  openChatFromOverview: () => void;
  dashboardViews: WorkerDashboardViewDefinition[];
  workerViewContext: unknown;
  /** True while a section this tab reads is still in flight — see `sectionPendingCheck`. */
  isSectionPending: (...sections: DashboardSectionName[]) => boolean;
  selectedModelAlias: string;
  setSelectedModelAlias: Dispatch<SetStateAction<string>>;
  saveDefaultModel: (alias: string) => void;
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
    isSectionPending,
    selectedModelAlias,
    setSelectedModelAlias,
    saveDefaultModel,
  } = props;
  const homeViews = dashboardViews.filter((view) => {
    if (view.kind !== 'home' || typeof view.render !== 'function') return false;
    return dashboard.workers.some((worker) => worker.id === view.workerId && worker.enabled);
  });

  if (homeViews.length > 0) {
    return (
      <section className="tab-page" aria-label="Home">
        {homeViews.map((view) => (
          <div key={`${view.workerId}:${view.kind}`}>
            {view.render?.({
              ...(workerViewContext as Record<string, any>),
              setActiveTab,
              openChatFromOverview,
            })}
          </div>
        ))}
      </section>
    );
  }

  const activeWorkers = dashboard.workers.filter(
    (worker) => worker.enabled && (worker.healthState === 'healthy' || worker.runningJobCount > 0),
  );
  const healthyWorkers = dashboard.workers.filter((worker) => worker.healthState === 'healthy');
  const enabledJobs = dashboard.cron.jobs.filter((job) => job.enabled);
  const runningJobs = dashboard.cron.jobs.filter((job) => job.running);
  const pipelineStages = dashboard.pipelineStages ?? [];
  const totalPending = pipelineStages.reduce((sum, stage) => sum + stage.pendingCount, 0);
  const queueWaiting = dashboard.queue.queued + dashboard.queue.retrying;
  const latestEvent = dashboard.events[0] ?? null;
  // The worker and job lists come down with the dashboard shell, so those cards are
  // truthful on first paint. Queue counts, events and pipeline stages are seeded empty
  // until their own request returns — a zero there is a placeholder, not a reading.
  const queuePending = isSectionPending('queue');
  const eventsPending = isSectionPending('events');
  const stagesPending = isSectionPending('pipelineStages');

  return (
    <section className="tab-page">
      <section className="overview-command-deck" aria-labelledby="overview-heading">
        <div className="overview-command-main">
          <p className="panel-kicker">Control room</p>
          <h1 id="overview-heading">BFrost overview</h1>
          <p>
            Watch the local worker system, inspect the queue, and jump straight into the
            next operational task from one compact surface.
          </p>
          <div className="overview-command-actions">
            <button type="button" className="primary overview-action-button" onClick={openChatFromOverview}>
              <Icon name="chat" />
              <span>Ask assistant</span>
            </button>
            <button type="button" className="overview-action-button" onClick={() => setActiveTab('jobs')}>
              <Icon name="jobs" />
              <span>Review jobs</span>
            </button>
          </div>
        </div>

        <div className="overview-command-search">
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
        </div>
      </section>

      <section className="overview-metric-grid" aria-label="Platform snapshot">
        <article className="overview-metric-card">
          <Icon name="workers" />
          <span>Healthy workers</span>
          <strong>{healthyWorkers.length} / {dashboard.workers.length}</strong>
          <small>{activeWorkers.length} active now</small>
        </article>
        <article className="overview-metric-card">
          <Icon name="jobs" />
          <span>Running jobs</span>
          <strong>{runningJobs.length} / {enabledJobs.length}</strong>
          <small>{dashboard.cron.jobs.length} registered</small>
        </article>
        <article className="overview-metric-card">
          <Icon name="pipeline" />
          <span>Pipeline pending</span>
          {stagesPending ? (
            <MetricSkeleton label="Loading pipeline totals" />
          ) : (
            <>
              <strong>{formatDashboardNumber(totalPending)}</strong>
              <small>{pipelineStages.length} stage{pipelineStages.length === 1 ? '' : 's'}</small>
            </>
          )}
        </article>
        <article className="overview-metric-card">
          <Icon name="activity" />
          <span>Queue waiting</span>
          {queuePending ? (
            <MetricSkeleton label="Loading queue totals" />
          ) : (
            <>
              <strong>{formatDashboardNumber(queueWaiting)}</strong>
              <small>{formatDashboardNumber(dashboard.queue.total)} total items</small>
            </>
          )}
        </article>
        <article className="overview-metric-card overview-metric-card-wide">
          <Icon name="system" />
          <span>Latest event</span>
          {eventsPending ? (
            <MetricSkeleton label="Loading latest event" detailWidth="18rem" />
          ) : (
            <>
              <strong>{latestEvent ? formatRelativeTime(latestEvent.createdAt) : 'none'}</strong>
              <small>{latestEvent ? latestEvent.summary : 'No activity recorded yet'}</small>
            </>
          )}
        </article>
      </section>

      {/* 2. Setup / onboarding panels (wizard steps, model prompts, etc.) */}
      <OverviewSetupPanels {...props} />

      {/* 3. Pipeline, full width so every stage block fits on one line */}
      <section className="grid overview-pipeline-grid">
        {(() => {
          return (
            <section className="panel pipeline-graph-card" aria-label="Pipeline stages">
              <div className="panel-head">
                <div>
                  <p className="panel-kicker">Live view</p>
                  <h2>Pipeline <HelpTip>Items waiting per stage. Each block is a registered job that reports how many items are ready for it to process — this updates live as jobs run.</HelpTip></h2>
                </div>
                {stagesPending ? (
                  <Skeleton width="5.5rem" height="1.5rem" />
                ) : pipelineStages.length > 0 ? (
                  <StatusPill tone={totalPending > 0 ? 'good' : 'muted'}>{`${totalPending} pending`}</StatusPill>
                ) : null}
              </div>
              {stagesPending ? (
                <SkeletonRegion label="Loading pipeline stages">
                  <div className="overview-stage-skeletons">
                    {[0, 1, 2, 3, 4].map((index) => (
                      <Skeleton key={index} variant="block" height="4.6rem" />
                    ))}
                  </div>
                </SkeletonRegion>
              ) : (
                <PipelineStageBlocks stages={pipelineStages} />
              )}
            </section>
          );
        })()}
      </section>

      {/* 4. Assistant baseline, One-click outcomes, and local-provider runtime — one row */}
      <section className="grid overview-assistant-grid">
        <OverviewModelPanel
          dashboard={dashboard}
          busyKey={busyKey}
          selectedModelAlias={selectedModelAlias}
          setSelectedModelAlias={setSelectedModelAlias}
          saveDefaultModel={saveDefaultModel}
        />
        <OverviewRecipesPanel
          dashboard={dashboard}
          setDashboard={props.setDashboard}
          setError={props.setError}
          recipeApplied={props.recipeApplied}
          setRecipeApplied={props.setRecipeApplied}
          recipeExpanded={props.recipeExpanded}
          setRecipeExpanded={props.setRecipeExpanded}
          recipeInputValues={props.recipeInputValues}
          setRecipeInputValues={props.setRecipeInputValues}
          recipeApplying={props.recipeApplying}
          setRecipeApplying={props.setRecipeApplying}
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
            {eventsPending ? (
              <Skeleton width="5rem" height="1.5rem" />
            ) : (
              <StatusPill tone="muted">{`${dashboard.events.length} stored`}</StatusPill>
            )}
          </div>
          {eventsPending ? (
            <SkeletonRegion label="Loading recent events">
              <SkeletonRows rows={5} />
            </SkeletonRegion>
          ) : (
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
                        } finally { setBusyKey(null); }
                      })()}
                    >
                      {busyKey === 'seed-sample-data' ? 'Loading…' : 'Load sample data'}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </article>
      </section>

    </section>
  );
}

/** Stands in for the `<strong>` headline and `<small>` detail of a metric card. */
function MetricSkeleton({ label, detailWidth = '7rem' }: { label: string; detailWidth?: string }) {
  return (
    <SkeletonRegion label={label} className="overview-metric-skeleton">
      <Skeleton width="4.5rem" height="1.5rem" />
      <Skeleton width={detailWidth} height="0.65rem" />
    </SkeletonRegion>
  );
}

function formatDashboardNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Math.round(value));
}
