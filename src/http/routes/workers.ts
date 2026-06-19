import { HttpRouter } from '../router';
import { readJsonBody, sendJson } from '../responses';
import { recordEventSafe } from '../../event-log';
import { discoverLocalWorkerResult, discoverLocalWorkers } from '../../workers/local';
import { listWorkers } from '../../workers/registry';
import {
  workerCatalog,
  uploadLocalWorkerZip,
  generateWorkerFromDescription,
  installWorkerFromStore,
  serveWorkerDashboardBundle,
  deleteLocalWorkerFiles,
  syncHiddenBuiltIns,
} from '../../admin-worker-ops';
import {
  forgetWorker,
  isWorkerEnabled,
  loadWorkerState,
  rememberSeenWorkers,
  setWorkerEnabled,
  setWorkerHidden,
} from '../../workers/state';
import { activateLocalWorker, deactivateLocalWorker } from '../../workers/bootstrap';
import { WorkerLoadError } from '../../workers/loader';
import { BadRequestError } from '../../admin-route';
import { reloadSchedulerSchedules } from '../../scheduler';
import { buildDashboardState } from '../../admin-dashboard-state';
import { GenerateWorkerBodySchema, StoreInstallBodySchema, WorkerUpdateBodySchema } from '../../admin-api';

const WORKER_GENERATE_BODY_LIMIT_BYTES = 16 * 1024;
const WORKER_UPDATE_BODY_LIMIT_BYTES = 2 * 1024;
const STORE_INSTALL_BODY_LIMIT_BYTES = 16 * 1024;

export function registerWorkerRoutes(router: HttpRouter): void {
  router.add('GET', '/api/workers/:id/dashboard.js', async (req, res, { params }) => {
    return serveWorkerDashboardBundle(params.id, req, res);
  });

  router.add('POST', '/api/workers/rescan', async (_req, res) => {
    const localResult = await discoverLocalWorkerResult();
    const localWorkers = localResult.workers;
    await rememberSeenWorkers([
      ...listWorkers().map((worker) => ({ id: worker.id, builtIn: true })),
      ...localWorkers.map((worker) => ({
        id: worker.manifest.id,
        builtIn: false,
        sourcePath: worker.sourcePath,
      })),
    ]);
    await recordEventSafe({
      category: 'worker',
      action: 'workers_rescanned',
      summary: `Local workers rescanned (${localWorkers.length} found).`,
      metadata: {
        workerCount: localWorkers.length,
        issueCount: localResult.issues.length,
        paths: localWorkers.map((worker) => worker.sourcePath),
      },
    });
    return sendJson(res, 200, await buildDashboardState());
  });

  router.add('POST', '/api/workers/upload', async (req, res) => {
    const uploaded = await uploadLocalWorkerZip(req);
    await recordEventSafe({
      category: 'worker',
      action: 'worker_uploaded',
      summary: `${uploaded.manifest.name} worker uploaded.`,
      metadata: {
        workerId: uploaded.manifest.id,
        sourcePath: uploaded.sourcePath,
      },
    });
    return sendJson(res, 200, await buildDashboardState());
  });

  router.add('POST', '/api/workers/generate', async (req, res) => {
    const body = await readJsonBody(req, GenerateWorkerBodySchema, {
      maxBytes: WORKER_GENERATE_BODY_LIMIT_BYTES,
    });
    const result = await generateWorkerFromDescription(body.description);
    await recordEventSafe({
      category: 'worker',
      action: 'worker_generated',
      summary: `Generated ${result.spec.role} worker "${result.spec.displayName}" from a description.`,
      metadata: { workerId: result.spec.id, role: result.spec.role, enabled: result.enabled },
    });
    return sendJson(res, 200, {
      worker: { id: result.spec.id, displayName: result.spec.displayName, role: result.spec.role },
      spec: result.spec,
      enabled: result.enabled,
      note: result.note,
      dashboard: await buildDashboardState(),
    });
  });

  router.add('POST', '/api/workers/:id', async (req, res, { params }) => {
    const workerId = params.id;
    const body = await readJsonBody(req, WorkerUpdateBodySchema, {
      maxBytes: WORKER_UPDATE_BODY_LIMIT_BYTES,
    });
    const localWorkers = await discoverLocalWorkers();
    const catalog = workerCatalog(localWorkers);
    const worker = catalog.get(workerId);
    const stored = await loadWorkerState();
    const storedWorker = stored.workers[workerId];
    if (!worker && !storedWorker) {
      return sendJson(res, 404, { error: 'Unknown worker' });
    }
    if (!worker && body.enabled) {
      throw new BadRequestError('Cannot enable a missing worker. Restore the local manifest and rescan first.');
    }

    // Hot lifecycle for local workers — compile + load + onEnable before flipping the
    // flag on enable, and onDisable + unregister after flipping it off on disable. No
    // process restart required.
    const discovered = worker && !worker.builtIn
      ? localWorkers.find((entry) => entry.manifest.id === workerId)
      : undefined;
    if (body.enabled && discovered) {
      try {
        const previousVersion = stored.workers[workerId]?.installedVersion ?? null;
        await activateLocalWorker(discovered, { previousVersion });
      } catch (err) {
        const message = err instanceof WorkerLoadError ? err.message : err instanceof Error ? err.message : String(err);
        throw new BadRequestError(`Worker failed to load: ${message}`);
      }
    }

    await setWorkerEnabled(workerId, body.enabled, {
      builtIn: worker?.builtIn ?? storedWorker?.builtIn ?? false,
      sourcePath: worker?.sourcePath ?? storedWorker?.sourcePath,
    });

    if (!body.enabled && worker && !worker.builtIn) {
      await deactivateLocalWorker(workerId);
    }

    await reloadSchedulerSchedules();
    await recordEventSafe({
      category: 'worker',
      action: body.enabled ? 'worker_enabled' : 'worker_disabled',
      summary: `${worker?.name ?? workerId} worker ${body.enabled ? 'enabled' : 'disabled'}.`,
      metadata: { workerId, builtIn: worker?.builtIn ?? storedWorker?.builtIn ?? false },
    });
    return sendJson(res, 200, await buildDashboardState());
  });

  router.add('DELETE', '/api/workers/:id', async (_req, res, { params }) => {
    const workerId = params.id;
    const localWorkers = await discoverLocalWorkers();
    const catalog = workerCatalog(localWorkers);
    const worker = catalog.get(workerId);
    const stored = await loadWorkerState();
    const storedWorker = stored.workers[workerId];
    if (!worker && !storedWorker) {
      return sendJson(res, 404, { error: 'Unknown worker' });
    }
    if (worker?.builtIn || storedWorker?.builtIn) {
      // Deletable built-ins (plugin workers) can be soft-deleted. All other
      // built-ins (channels, providers, infrastructure) cannot be removed.
      if (!worker?.deletable) {
        throw new BadRequestError('Built-in workers cannot be deleted.');
      }
      // Soft-delete: mark hidden so the registry and scheduler stop seeing it.
      const updatedState = await setWorkerHidden(workerId, true, { builtIn: true });
      await syncHiddenBuiltIns(updatedState);
      await reloadSchedulerSchedules();
      await recordEventSafe({
        category: 'worker',
        action: 'worker_deleted',
        summary: `${worker?.name ?? workerId} built-in worker removed. It can be restored from the store.`,
        metadata: { workerId, builtIn: true },
      });
      return sendJson(res, 200, await buildDashboardState());
    }

    const sourcePath = worker?.sourcePath ?? storedWorker?.sourcePath;
    if (sourcePath) {
      await deleteLocalWorkerFiles(sourcePath);
    }
    await forgetWorker(workerId);
    await reloadSchedulerSchedules();
    await recordEventSafe({
      category: 'worker',
      action: 'worker_deleted',
      summary: `${worker?.name ?? workerId} worker deleted.`,
      metadata: { workerId, sourcePath: sourcePath ?? null },
    });
    return sendJson(res, 200, await buildDashboardState());
  });

  router.add('POST', '/api/store/install', async (req, res) => {
    const body = await readJsonBody(req, StoreInstallBodySchema, {
      maxBytes: STORE_INSTALL_BODY_LIMIT_BYTES,
    });
    const result = await installWorkerFromStore(body.id, body.bundleUrl, body.bundleSha256);
    await recordEventSafe({
      category: 'admin',
      action: 'worker_installed_from_store',
      summary: `Worker "${result.manifest.name}" (${result.manifest.id}) installed from the store.`,
      metadata: { workerId: result.manifest.id, sourcePath: result.sourcePath },
    });
    return sendJson(res, 200, { ok: true, workerId: result.manifest.id });
  });
}
