import { loadKvJson, saveKvJson } from '../sqlite';

const WORKER_STATE_STORE_KEY = 'worker.state';

export interface WorkerStateRecord {
  enabled: boolean;
  builtIn: boolean;
  sourcePath?: string;
  lastSeenAt?: string;
  /** Last manifest `version` we successfully booted for this worker id. Drives onMigrate. */
  installedVersion?: string;
}

export interface WorkerStateStore {
  workers: Record<string, WorkerStateRecord>;
}

export async function loadWorkerState(): Promise<WorkerStateStore> {
  const stored = await loadKvJson<Partial<WorkerStateStore>>(WORKER_STATE_STORE_KEY);
  return {
    workers: stored?.workers && typeof stored.workers === 'object' ? stored.workers : {},
  };
}

export async function saveWorkerState(state: WorkerStateStore): Promise<void> {
  await saveKvJson(WORKER_STATE_STORE_KEY, state);
}

export async function setWorkerEnabled(
  workerId: string,
  enabled: boolean,
  meta: { builtIn: boolean; sourcePath?: string },
): Promise<WorkerStateStore> {
  const state = await loadWorkerState();
  state.workers[workerId] = {
    ...state.workers[workerId],
    builtIn: meta.builtIn,
    sourcePath: meta.sourcePath ?? state.workers[workerId]?.sourcePath,
    enabled,
  };
  await saveWorkerState(state);
  return state;
}

export async function forgetWorker(workerId: string): Promise<WorkerStateStore> {
  const state = await loadWorkerState();
  delete state.workers[workerId];
  await saveWorkerState(state);
  return state;
}

export async function rememberSeenWorkers(
  workers: Array<{ id: string; builtIn: boolean; sourcePath?: string }>,
): Promise<WorkerStateStore> {
  const state = await loadWorkerState();
  const now = new Date().toISOString();
  for (const worker of workers) {
    state.workers[worker.id] = {
      enabled: state.workers[worker.id]?.enabled ?? true,
      builtIn: worker.builtIn,
      sourcePath: worker.sourcePath ?? state.workers[worker.id]?.sourcePath,
      lastSeenAt: now,
    };
  }
  await saveWorkerState(state);
  return state;
}

export function isWorkerEnabled(workerId: string, state: WorkerStateStore): boolean {
  return state.workers[workerId]?.enabled ?? true;
}

/** Persist the manifest version we just successfully booted for a worker id. */
export async function setWorkerInstalledVersion(workerId: string, version: string): Promise<void> {
  const state = await loadWorkerState();
  const existing = state.workers[workerId];
  if (existing?.installedVersion === version) return;
  state.workers[workerId] = {
    enabled: existing?.enabled ?? true,
    builtIn: existing?.builtIn ?? false,
    ...(existing?.sourcePath !== undefined && { sourcePath: existing.sourcePath }),
    ...(existing?.lastSeenAt !== undefined && { lastSeenAt: existing.lastSeenAt }),
    installedVersion: version,
  };
  await saveWorkerState(state);
}
