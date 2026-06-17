import type { DashboardSectionName, DashboardState, DashboardTab } from '../app-types';

export function sectionEndpoint(name: DashboardSectionName): string {
  switch (name) {
    case 'queue': return '/api/dashboard/queue';
    case 'cronRuns': return '/api/dashboard/cron-runs';
    case 'events': return '/api/dashboard/events';
    case 'backups': return '/api/dashboard/backups';
    case 'workerData': return '/api/dashboard/worker-data';
    case 'lmStudioModels': return '/api/dashboard/lmstudio-models';
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
    case 'cronRuns':
      return { ...dashboard, cron: { ...dashboard.cron, runs: payload.runs } };
    case 'events':
      return { ...dashboard, events: payload.events };
    case 'backups':
      return { ...dashboard, backups: payload.backups };
    case 'workerData':
      return { ...dashboard, workerData: payload.workerData } as DashboardState;
    case 'lmStudioModels':
      return { ...dashboard, lmStudio: { ...dashboard.lmStudio, loadedModels: payload.loadedModels } };
  }
}

export function sectionsForTab(tab: DashboardTab): DashboardSectionName[] {
  if (tab === 'overview') return ['queue', 'events', 'lmStudioModels'];
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
