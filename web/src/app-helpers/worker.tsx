import type { ReactNode } from 'react';
import type {
  DashboardTab,
  EventLogRecord,
  WorkerHealthState,
  WorkerSummary,
  WorkerTabDefinition,
} from '../app-types';
import type { WorkerDashboardViewDefinition } from '../workers/types';
import { Skeleton, SkeletonRows } from '../ui';

export function safeWorkerViewCount(definition: WorkerDashboardViewDefinition, ctx: Record<string, any>): number | undefined {
  if (typeof definition.count !== 'function') return undefined;
  try {
    return definition.count(ctx);
  } catch (err) {
    console.warn(`[Workers] Count renderer for ${definition.workerId} failed:`, err);
    return undefined;
  }
}

/**
 * Stand-in for a worker tab whose data has not arrived.
 *
 * A view that names its `loadingSections` reads them out of `dashboard`, which is
 * seeded empty until each section's own request returns. Until then the view would
 * render "nothing here yet" and tell the operator their worker has no data when it
 * simply has not been asked yet. Core cannot know what shape any given worker's page
 * takes, so it draws a neutral panel of the right weight rather than guessing.
 *
 * Views that fetch their own data name no sections and are never substituted — the
 * placeholder would postpone their mount, and with it the fetches they issue on mount.
 */
function WorkerDashboardLoading({ worker }: { worker: WorkerSummary }) {
  return (
    <section className="panel tab-page" aria-busy="true" role="status">
      <span className="sr-only">Loading {worker.displayName ?? worker.name}</span>
      <div className="panel-head">
        <div>
          <p className="panel-kicker">{worker.displayName ?? worker.name}</p>
          <Skeleton width="12rem" height="1.35rem" />
        </div>
        <Skeleton width="5rem" height="1.5rem" />
      </div>
      <div className="skeleton-region">
        <SkeletonRows rows={6} />
      </div>
    </section>
  );
}

export function renderWorkerDashboardView(tab: WorkerTabDefinition, ctx: Record<string, any>): ReactNode {
  const sections = tab.definition.loadingSections;
  if (
    Array.isArray(sections) &&
    sections.length > 0 &&
    typeof ctx.isSectionPending === 'function' &&
    ctx.isSectionPending(...sections)
  ) {
    return <WorkerDashboardLoading worker={tab.worker} />;
  }
  if (typeof tab.definition.render !== 'function') {
    return (
      <section className="panel tab-page">
        <div className="panel-head">
          <div>
            <p className="panel-kicker">{tab.worker.name}</p>
            <h2>Dashboard unavailable</h2>
          </div>
        </div>
        <p className="empty-state">This worker did not register a dashboard renderer.</p>
      </section>
    );
  }
  try {
    return tab.definition.render(ctx);
  } catch (err) {
    console.warn(`[Workers] Dashboard renderer for ${tab.worker.id} failed:`, err);
    return (
      <section className="panel tab-page">
        <div className="panel-head">
          <div>
            <p className="panel-kicker">{tab.worker.name}</p>
            <h2>Dashboard unavailable</h2>
          </div>
        </div>
        <p className="empty-state">This worker dashboard failed to render. The rest of BFrost is still available.</p>
      </section>
    );
  }
}

export function buildWorkerTabDefinitions(
  workers: WorkerSummary[],
  views: WorkerDashboardViewDefinition[],
): WorkerTabDefinition[] {
  return workers.flatMap((worker) => {
    if (!worker.enabled || worker.missing) {
      return [];
    }
    if (worker.kind === 'channel' || worker.kind === 'provider') {
      return [];
    }

    const definition = views.find((view) => view.workerId === worker.id && workerDeclaresView(worker, view));
    if (definition) {
      return [{ id: workerTabId(worker.id), worker, definition }];
    }
    return [];
  });
}

export function workerDeclaresView(worker: WorkerSummary, definition: WorkerDashboardViewDefinition): boolean {
  const surfaceIds = new Set([
    ...(Array.isArray(worker.dashboard?.routes) ? worker.dashboard.routes.map((surface) => surface.id) : []),
    ...(Array.isArray(worker.dashboard?.settings) ? worker.dashboard.settings.map((surface) => surface.id) : []),
  ]);
  const definitionSurfaceIds = Array.isArray(definition.surfaceIds) ? definition.surfaceIds : [];
  return definitionSurfaceIds.some((surfaceId) => surfaceIds.has(surfaceId));
}

export function workerTabId(workerId: string): `worker:${string}` {
  return `worker:${workerId}`;
}

export function configSurfaceKey(workerId: string, surfaceId: string, scopeId?: string | null): string {
  return `${workerId}:${surfaceId}:${scopeId ?? 'all'}`;
}

export function workerHealthTone(state: WorkerHealthState): 'good' | 'warning' | 'info' | 'muted' {
  if (state === 'healthy') return 'good';
  if (state === 'missing_credentials' || state === 'missing_dependency') return 'warning';
  if (state === 'degraded') return 'info';
  return 'muted';
}

export function workerHealthLabel(state: WorkerHealthState): string {
  if (state === 'missing_credentials') return 'missing credentials';
  if (state === 'missing_dependency') return 'missing dependency';
  return state;
}

export function workerOwnsEvent(worker: WorkerSummary, event: EventLogRecord): boolean {
  if (event.metadata.workerId === worker.id) return true;

  const workerIds = event.metadata.workerIds;
  if (Array.isArray(workerIds) && workerIds.includes(worker.id)) return true;

  const eventJob = event.metadata.job;
  return typeof eventJob === 'string' && worker.jobs.some((job) => job.id === eventJob);
}

export function resolveDashboardTab(value: string | undefined): DashboardTab | null {
  if (value === 'overview' ||
    value === 'workers' ||
    value === 'jobs' ||
    value === 'config' ||
    value === 'chat' ||
    value === 'system' ||
    value === 'pipeline') {
    return value;
  }
  if (value === 'settings' || value === 'configuration') return 'config';
  if (value === 'events' || value === 'health') return 'system';
  return null;
}

export function providerLabel(provider: string, workers: WorkerSummary[]): string {
  const match = workers.find(
    (w) => w.kind === 'provider' && w.id.endsWith(`.${provider}`)
  );
  return match?.displayName ?? match?.name ?? provider;
}
