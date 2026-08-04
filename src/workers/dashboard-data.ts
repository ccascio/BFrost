import { listWorkerModules } from './registry';
import type { WorkerDashboardContext } from './module';

export type WorkerDashboardSlice = unknown;
export type WorkerDashboardSliceMap = Record<string, WorkerDashboardSlice>;

export async function loadRegisteredWorkerDashboardData(
  context?: WorkerDashboardContext,
): Promise<WorkerDashboardSliceMap> {
  const entries = await Promise.all(
    listWorkerModules()
      .filter((module) => module.loadDashboardData)
      .map(async (module) => [module.manifest.id, await module.loadDashboardData!(context)] as const),
  );
  return Object.fromEntries(entries);
}
