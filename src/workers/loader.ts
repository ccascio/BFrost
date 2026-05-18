/**
 * Load executable code for a discovered local worker.
 *
 * Flow:
 *   1. If the worker declares language: "typescript", compile its `backendSource` to
 *      `backendEntrypoint` via esbuild. (No-op when the cached output is up-to-date.)
 *   2. require() the resolved entrypoint and pluck its default export (or `module` export).
 *   3. Validate the loaded module against the BackendWorkerModule shape.
 *   4. Return the module — the caller (registry / install pipeline) decides what to do with it.
 *
 * Anti-goals:
 *   - We never execute TS source directly; compile-on-load, run JS.
 *   - We never bundle BFrost runtime code into a worker (`bfrost` is external).
 *   - We never silently swallow load errors — they surface as WorkerLoadError instances so
 *     the dashboard can show them next to the worker row.
 */
import path from 'path';
import { compileLocalWorker } from './build';
import { BFROST_WORKER_API_VERSION } from './local';
import type { DiscoveredLocalWorker } from './local';
import type { BackendWorkerModule } from './module';

export class WorkerLoadError extends Error {
  constructor(public readonly workerId: string, public readonly sourcePath: string, message: string) {
    super(message);
    this.name = 'WorkerLoadError';
  }
}

export interface LoadedLocalWorker {
  module: BackendWorkerModule;
  workerDir: string;
  /** Absolute path to the JS file that was actually required(). */
  entrypoint: string;
  /** True when esbuild ran during this load. */
  recompiled: boolean;
}

export async function loadLocalWorkerModule(worker: DiscoveredLocalWorker): Promise<LoadedLocalWorker> {
  const workerDir = path.dirname(path.resolve(worker.sourcePath));

  if (!worker.backendEntrypoint) {
    throw new WorkerLoadError(
      worker.manifest.id,
      worker.sourcePath,
      'Worker has no backendEntrypoint declared; nothing to load.',
    );
  }

  let recompiled = false;
  if (worker.language === 'typescript') {
    if (!worker.backendSource) {
      throw new WorkerLoadError(
        worker.manifest.id,
        worker.sourcePath,
        'TypeScript worker requires backendSource.',
      );
    }
    try {
      const result = await compileLocalWorker({
        workerDir,
        source: worker.backendSource,
        output: worker.backendEntrypoint,
      });
      recompiled = result.compiled;
    } catch (err) {
      throw new WorkerLoadError(
        worker.manifest.id,
        worker.sourcePath,
        `esbuild failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const entrypoint = path.resolve(workerDir, worker.backendEntrypoint);

  let imported: unknown;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    imported = require(entrypoint);
  } catch (err) {
    throw new WorkerLoadError(
      worker.manifest.id,
      worker.sourcePath,
      `Failed to require() ${path.relative(workerDir, entrypoint)}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const module = extractBackendModule(imported);
  if (!module) {
    throw new WorkerLoadError(
      worker.manifest.id,
      worker.sourcePath,
      'Worker entrypoint must export a BackendWorkerModule as `default`, `module`, or `workerModule`.',
    );
  }

  if (module.manifest.id !== worker.manifest.id) {
    throw new WorkerLoadError(
      worker.manifest.id,
      worker.sourcePath,
      `Loaded module manifest id "${module.manifest.id}" does not match worker.json id "${worker.manifest.id}".`,
    );
  }

  const declaredApiVersion = (module.manifest as any).bfrostApiVersion;
  if (declaredApiVersion !== undefined && declaredApiVersion !== BFROST_WORKER_API_VERSION) {
    throw new WorkerLoadError(
      worker.manifest.id,
      worker.sourcePath,
      `Worker module declares bfrostApiVersion "${declaredApiVersion}" but this BFrost installation requires "${BFROST_WORKER_API_VERSION}". Update the worker or use a BFrost version that supports "${declaredApiVersion}".`,
    );
  }

  return { module, workerDir, entrypoint, recompiled };
}

function extractBackendModule(imported: unknown): BackendWorkerModule | null {
  if (!imported || typeof imported !== 'object') return null;
  const candidates: unknown[] = [
    (imported as any).default,
    (imported as any).workerModule,
    (imported as any).module,
    imported,
  ];
  for (const candidate of candidates) {
    if (looksLikeBackendModule(candidate)) {
      return candidate as BackendWorkerModule;
    }
  }
  return null;
}

function looksLikeBackendModule(value: unknown): value is BackendWorkerModule {
  if (!value || typeof value !== 'object') return false;
  const manifest = (value as any).manifest;
  return (
    manifest &&
    typeof manifest === 'object' &&
    typeof manifest.id === 'string' &&
    typeof manifest.name === 'string' &&
    typeof manifest.version === 'string'
  );
}
