import { builtInWorkerModules } from './index';

export type WorkerDashboardSlice = unknown;
export type WorkerDashboardSliceMap = Record<string, WorkerDashboardSlice>;

export async function loadBuiltInWorkerDashboardData(): Promise<WorkerDashboardSliceMap> {
  const entries = await Promise.all(
    builtInWorkerModules
      .filter((module) => module.loadDashboardData)
      .map(async (module) => [module.manifest.id, await module.loadDashboardData!()] as const),
  );
  return Object.fromEntries(entries);
}
