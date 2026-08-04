import type { DashboardSectionName, DashboardState, DashboardTab, SchedulerJobState } from '../app-types';

export function sectionEndpoint(name: DashboardSectionName): string {
  switch (name) {
    case 'queue': return '/api/dashboard/queue';
    case 'cronRuns': return '/api/dashboard/cron-runs';
    case 'events': return '/api/dashboard/events';
    case 'backups': return '/api/dashboard/backups';
    case 'workerData': return '/api/dashboard/worker-data';
    case 'localRuntimeModels': return '/api/dashboard/local-runtime-models';
    case 'pipelineStages': return '/api/dashboard/pipeline-stages';
  }
}

export function mergeSection(
  dashboard: DashboardState,
  name: DashboardSectionName,
  payload: any,
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
      return { ...dashboard, workerData: payload.workerData } as DashboardState;
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
