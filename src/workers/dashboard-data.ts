import { listWorkerModules } from './registry';
import type { WorkerDashboardContext } from './module';

export type WorkerDashboardSlice = unknown;
export type WorkerDashboardSliceMap = Record<string, WorkerDashboardSlice>;

export async function loadRegisteredWorkerDashboardData(
  context?: WorkerDashboardContext,
  workerIds?: readonly string[],
): Promise<WorkerDashboardSliceMap> {
  const requested = workerIds && workerIds.length > 0 ? new Set(workerIds) : null;
  const entries = await Promise.all(
    listWorkerModules()
      .filter((module) => module.loadDashboardData && (!requested || requested.has(module.manifest.id)))
      .map(async (module) => [module.manifest.id, await module.loadDashboardData!(context)] as const),
  );
  return Object.fromEntries(entries);
}
