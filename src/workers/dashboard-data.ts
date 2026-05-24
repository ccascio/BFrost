import { listWorkerModules } from './registry';

export type WorkerDashboardSlice = unknown;
export type WorkerDashboardSliceMap = Record<string, WorkerDashboardSlice>;

export async function loadRegisteredWorkerDashboardData(): Promise<WorkerDashboardSliceMap> {
  const entries = await Promise.all(
    listWorkerModules()
      .filter((module) => module.loadDashboardData)
      .map(async (module) => [module.manifest.id, await module.loadDashboardData!()] as const),
  );
  return Object.fromEntries(entries);
}
