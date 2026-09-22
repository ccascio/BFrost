import type { DashboardSectionName, DashboardState, DashboardTab, SchedulerJobState } from '../app-types';

export function sectionEndpoint(name: DashboardSectionName, workerIds?: readonly string[]): string {
  switch (name) {
    case 'queue': return '/api/dashboard/queue';
    case 'cronRuns': return '/api/dashboard/cron-runs';
    case 'events': return '/api/dashboard/events';
    case 'backups': return '/api/dashboard/backups';
    case 'workerData': {
      const ids = [...new Set(workerIds?.map((id) => id.trim()).filter(Boolean) ?? [])];
      const query = ids.map((id) => `workerId=${encodeURIComponent(id)}`).join('&');
      return `/api/dashboard/worker-data${query ? `?${query}` : ''}`;
    }
    case 'localRuntimeModels': return '/api/dashboard/local-runtime-models';
    case 'pipelineStages': return '/api/dashboard/pipeline-stages';
  }
}

/** Load state of each lazily-fetched dashboard section; absent means "still in flight". */
export type DashboardSectionStatus = Partial<Record<DashboardSectionName, 'ready' | 'error'>>;

/**
 * How long a section may take before the UI admits it is loading. Sections differ by
 * three orders of magnitude — `events` answers in about a millisecond, `worker-data`
 * takes seconds — and a placeholder that appears and vanishes within a frame reads as
 * a glitch. Anything settling inside this window goes straight from the shell's
 * seeded-empty state to real data with no intermediate paint.
 */
export const SECTION_PLACEHOLDER_DELAY_MS = 150;

/**
 * Builds the predicate panels use to choose between a loading placeholder and an
 * empty state. Pass every section a panel reads — if any of them has not settled
 * yet, the panel's zeros and "nothing here" copy are not yet trustworthy.
 *
 * `armed` is the grace window above: while false the predicate reports nothing as
 * pending, so no placeholder can appear.
 */
export function sectionPendingCheck(
  status: DashboardSectionStatus,
  armed = true,
): (...names: DashboardSectionName[]) => boolean {
  return (...names) => armed && names.some((name) => status[name] === undefined);
}

export function mergeSection(
  dashboard: DashboardState,
  name: DashboardSectionName,
  payload: any,
  options: { mergeWorkerData?: boolean } = {},
): DashboardState {
  switch (name) {
    case 'queue':
      return { ...dashboard, queue: payload.queue };
    case 'cronRuns': {
      const jobs: SchedulerJobState[] | null = Array.isArray(payload.jobs) ? payload.jobs : null;
      return {
        ...dashboard,
        cron: {
          ...dashboard.cron,
          runs: payload.runs,
          jobs: jobs ?? dashboard.cron.jobs,
        },
        workers: jobs
          ? dashboard.workers.map((worker) => {
              const workerJobs = jobs.filter((job) => job.workerId === worker.id);
              if (workerJobs.length === 0) return worker;
              return {
                ...worker,
                jobCount: workerJobs.length,
                enabledJobCount: workerJobs.filter((job) => job.enabled).length,
                runningJobCount: workerJobs.filter((job) => job.running).length,
                jobs: workerJobs.map((job) => ({
                  id: job.name,
                  label: job.label,
                  description: job.description,
                  enabled: job.enabled,
                  running: job.running,
                  lastStatus: job.lastStatus,
                })),
              };
            })
          : dashboard.workers,
      };
    }
    case 'events':
      return { ...dashboard, events: payload.events };
    case 'backups':
      return { ...dashboard, backups: payload.backups };
    case 'workerData':
      return {
        ...dashboard,
        workerData: options.mergeWorkerData
          ? { ...dashboard.workerData, ...payload.workerData }
          : payload.workerData,
      } as DashboardState;
    case 'localRuntimeModels':
      return { ...dashboard, localRuntime: { ...dashboard.localRuntime, loadedModels: payload.loadedModels } };
    case 'pipelineStages':
      return { ...dashboard, pipelineStages: payload.pipelineStages };
  }
}

export function sectionsForTab(tab: DashboardTab): DashboardSectionName[] {
  if (tab === 'overview') return ['queue', 'events', 'workerData', 'localRuntimeModels', 'pipelineStages'];
  if (tab === 'pipeline') return ['queue'];
  if (tab === 'channels') return ['workerData'];
  if (tab === 'jobs') return ['cronRuns', 'queue'];
  if (tab === 'system') return ['events', 'backups'];
  if (tab === 'chat') return [];
  if (tab === 'config') return ['queue', 'workerData'];
  if (tab === 'workers') return [];
  if (tab.startsWith('worker-config:')) return ['queue', 'workerData'];
  return ['queue', 'events', 'workerData'];
}

export function coreMenuCount(
  id: DashboardTab,
  counts: { workers: number; channels: number; jobs: number; config: number; chat: number; system: number; store: number; pendingActions: number },
): number | undefined {
  switch (id) {
    case 'workers':
      return counts.workers;
    case 'channels':
      return counts.channels;
    case 'jobs':
      return counts.jobs;
    case 'config':
      return counts.config;
    case 'chat':
      return counts.chat;
    case 'system':
      return counts.system;
    case 'store':
      return counts.store > 0 ? counts.store : undefined;
    case 'actions':
      return counts.pendingActions > 0 ? counts.pendingActions : undefined;
    default:
      return undefined;
  }
}
