/**
 * Local worker activation lifecycle.
 *
 * `bootstrapLocalWorkers` is the one-shot called at process startup. `activateLocalWorker`
 * and `deactivateLocalWorker` are the per-worker helpers reused by the admin enable/disable
 * route so an operator can install + enable a worker hot, without restarting the process.
 *
 * Errors during boot are *collected* rather than thrown: a single broken local worker should
 * never prevent BFrost from booting. Errors during a hot enable are thrown — the route
 * surfaces them as a 400 and the toggle stays off.
 */
import {
  discoverLocalWorkerResult,
  type DiscoveredLocalWorker,
  type LocalWorkerLoadIssue,
} from './local';
import { config } from '../config';
import { loadLocalWorkerModule, WorkerLoadError } from './loader';
import { listLocalWorkerModules, registerLoadedLocalModule, unregisterLocalWorkerModule } from './registry';
import {
  loadWorkerState,
  setWorkerInstalledVersion,
  type WorkerStateStore,
} from './state';

export interface BootstrapLocalWorkersResult {
  loaded: string[];
  skipped: string[];
  issues: LocalWorkerLoadIssue[];
}

/**
 * Thrown when a local worker ships executable code but the operator has not enabled
 * local-worker code execution (`config.localWorkerCodeEnabled`, surfaced in the dashboard
 * as the "Allow local worker code" toggle in Platform & Security).
 *
 * Built-in workers are statically imported and never reach this path; only local workers
 * loaded through the runtime are gated. The message is intentionally actionable so it reads
 * well both as a boot-time issue row and as a 400 on a hot enable.
 */
export class LocalWorkerCodeDisabledError extends Error {
  constructor(public readonly workerId: string) {
    super(
      `Local worker "${workerId}" ships executable code, but local worker code execution is disabled. ` +
        `Enable "Allow local worker code" in Platform & Security (or set BFROST_ENABLE_LOCAL_WORKER_CODE=true) to load it.`,
    );
    this.name = 'LocalWorkerCodeDisabledError';
  }
}

/**
 * Compile (if TS), load, register, migrate, and onEnable a single local worker.
 *
 * Throws on compile/load failure so the caller (admin enable route or bootstrap loop) can
 * decide how to surface the error. Lifecycle hook errors (onMigrate, onEnable) are logged
 * but not rethrown — the worker is considered activated either way; a failed onMigrate
 * leaves the recorded `installedVersion` unchanged so the next attempt will retry it.
 *
 * Idempotent: if the worker is already registered in the live registry, this is a no-op.
 */
export async function activateLocalWorker(
  worker: DiscoveredLocalWorker,
  options: { previousVersion?: string | null } = {},
): Promise<{ loaded: boolean; migrationFailed: boolean }> {
  if (!worker.backendEntrypoint && worker.language !== 'typescript') {
    // Manifest-only worker — nothing to load. Always allowed: no code runs.
    return { loaded: false, migrationFailed: false };
  }
  if (listLocalWorkerModules().some((module) => module.manifest.id === worker.manifest.id)) {
    return { loaded: true, migrationFailed: false };
  }
  // Gate executable local worker code behind the platform flag. Reached only when the worker
  // has code to run (the manifest-only case returned above). Built-ins never get here.
  if (!config.localWorkerCodeEnabled) {
    throw new LocalWorkerCodeDisabledError(worker.manifest.id);
  }

  const loaded = await loadLocalWorkerModule(worker);
  registerLoadedLocalModule(loaded.module, loaded.workerDir);

  const ctx = { workerId: worker.manifest.id, workerDir: loaded.workerDir };
  const previousVersion = options.previousVersion ?? null;
  const currentVersion = loaded.module.manifest.version;

  let migrationFailed = false;
  if (previousVersion !== currentVersion && loaded.module.lifecycle?.onMigrate) {
    try {
      await loaded.module.lifecycle.onMigrate({ ...ctx, fromVersion: previousVersion, toVersion: currentVersion });
    } catch (err) {
      console.warn(`[Workers] onMigrate for ${worker.manifest.id} failed:`, err);
      migrationFailed = true;
    }
  }

  try {
    await loaded.module.lifecycle?.onEnable?.(ctx);
  } catch (err) {
    console.warn(`[Workers] onEnable for ${worker.manifest.id} failed:`, err);
  }

  if (!migrationFailed) {
    await setWorkerInstalledVersion(worker.manifest.id, currentVersion);
  }

  return { loaded: true, migrationFailed };
}

/**
 * Inverse of {@link activateLocalWorker}: call onDisable (best-effort) and remove the
 * module from the live registry so its jobs, tools, routes, channels, and providers
 * disappear from the next dashboard payload.
 */
export async function deactivateLocalWorker(workerId: string): Promise<void> {
  const entry = listLocalWorkerModules().find((module) => module.manifest.id === workerId);
  if (!entry) return;
  try {
    await entry.lifecycle?.onDisable?.({ workerId });
  } catch (err) {
    console.warn(`[Workers] onDisable for ${workerId} failed:`, err);
  }
  unregisterLocalWorkerModule(workerId);
}

export async function bootstrapLocalWorkers(): Promise<BootstrapLocalWorkersResult> {
  const discovery = await discoverLocalWorkerResult();
  const state: WorkerStateStore = await loadWorkerState();

  const result: BootstrapLocalWorkersResult = {
    loaded: [],
    skipped: [],
    issues: [...discovery.issues],
  };

  for (const worker of discovery.workers) {
    const enabled = state.workers[worker.manifest.id]?.enabled ?? false;
    if (!enabled) {
      result.skipped.push(worker.manifest.id);
      continue;
    }
    try {
      const previousVersion = state.workers[worker.manifest.id]?.installedVersion ?? null;
      const outcome = await activateLocalWorker(worker, { previousVersion });
      if (outcome.loaded) {
        result.loaded.push(worker.manifest.id);
      } else {
        result.skipped.push(worker.manifest.id);
      }
    } catch (err) {
      const message = err instanceof WorkerLoadError ? err.message : err instanceof Error ? err.message : String(err);
      console.warn(`[Workers] Failed to load local worker ${worker.manifest.id}:`, message);
      result.issues.push({ sourcePath: worker.sourcePath, message });
    }
  }

  return result;
}
