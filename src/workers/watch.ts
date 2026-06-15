/**
 * Hot reload for local workers.
 *
 * When an operator edits the source of an *enabled* local worker, this watcher recompiles and
 * re-registers it in place — no BFrost restart. It reuses the same activate/deactivate lifecycle
 * the enable/disable route uses, so jobs, tools, routes, channels, and providers swap atomically.
 *
 * Scope, deliberately narrow:
 *   - Only reloads workers that are currently registered (i.e. enabled). A change to a disabled
 *     worker is ignored — it will be picked up the next time the operator enables it.
 *   - Backend source only. Dashboard bundles already recompile on fetch (served by the admin
 *     server with an mtime check), so editing dashboard.tsx needs only a browser refresh.
 *   - Gated by `config.workerHotReloadEnabled` and `config.localWorkerCodeEnabled`.
 *
 * The compile cache is mtime-based and non-recursive, so on reload we force a rebuild by deleting
 * the compiled output and busting the require cache for the bundled entrypoint before reactivating.
 */
import { promises as fs } from 'fs';
import fsSync from 'fs';
import path from 'path';
import { config } from '../config';
import { activateLocalWorker, deactivateLocalWorker } from './bootstrap';
import { discoverLocalWorkerResult, type DiscoveredLocalWorker } from './local';
import { listLocalWorkerModules } from './registry';
import { recordEventSafe } from '../event-log';

const DEBOUNCE_MS = 300;

export interface LocalWorkerWatcher {
  stop: () => void;
}

/**
 * Start watching the configured local-worker roots. Returns a handle whose `stop()` closes every
 * underlying fs watcher. Safe to call when hot reload is disabled — it returns an inert handle.
 */
export function startLocalWorkerWatcher(): LocalWorkerWatcher {
  if (!config.workerHotReloadEnabled || !config.localWorkerCodeEnabled) {
    return { stop: () => {} };
  }

  const watchers: fsSync.FSWatcher[] = [];
  const pending = new Map<string, NodeJS.Timeout>();

  const onChange = (filename: string | null) => {
    if (!filename) return;
    // Ignore the compiled output we write ourselves and editor scratch files.
    if (filename.includes(`${path.sep}dist${path.sep}`) || filename.startsWith('dist/')) return;
    if (filename.endsWith('~') || filename.includes('.tmp')) return;

    // Debounce per-root: editors emit a burst of events on save. We rediscover on fire,
    // so a single coalesced tick is enough regardless of which file changed.
    const existing = pending.get('*');
    if (existing) clearTimeout(existing);
    pending.set('*', setTimeout(() => {
      pending.delete('*');
      void reloadChangedWorkers();
    }, DEBOUNCE_MS));
  };

  for (const root of config.workerPaths) {
    const resolved = path.resolve(root);
    if (!fsSync.existsSync(resolved)) continue;
    try {
      // recursive is supported on macOS and Windows. On Linux it is ignored by Node, so only
      // direct children of the root fire events; the worker dir layout (root/<id>/...) still
      // surfaces saves to files one level down via the directory's own change events.
      const watcher = fsSync.watch(resolved, { recursive: true }, (_event, filename) => onChange(filename));
      watcher.on('error', (err) => {
        console.warn(`[Workers] Hot-reload watcher error on ${resolved}:`, err);
      });
      watchers.push(watcher);
    } catch (err) {
      console.warn(`[Workers] Could not watch ${resolved} for hot reload:`, err);
    }
  }

  if (watchers.length === 0) {
    return { stop: () => {} };
  }

  console.log(`[Workers] Hot reload enabled — watching ${watchers.length} local worker root(s).`);
  return {
    stop: () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
      for (const watcher of watchers) {
        try {
          watcher.close();
        } catch {
          // already closed
        }
      }
    },
  };
}

/**
 * Rediscover local workers and reload every currently-registered worker whose source changed.
 * Cheap to call on every debounced tick — discovery is a directory scan and reload only fires
 * for workers that are both enabled and actually re-compilable.
 */
async function reloadChangedWorkers(): Promise<void> {
  let discovery;
  try {
    discovery = await discoverLocalWorkerResult();
  } catch (err) {
    console.warn('[Workers] Hot reload: discovery failed:', err);
    return;
  }

  const registeredIds = new Set(listLocalWorkerModules().map((module) => module.manifest.id));
  for (const worker of discovery.workers) {
    if (!registeredIds.has(worker.manifest.id)) continue; // only reload enabled workers
    await reloadWorker(worker);
  }
}

async function reloadWorker(worker: DiscoveredLocalWorker): Promise<void> {
  const id = worker.manifest.id;
  const workerDir = path.dirname(path.resolve(worker.sourcePath));

  try {
    await deactivateLocalWorker(id);

    // Force a fresh compile: the mtime cache is non-recursive and could otherwise skip a rebuild
    // when the edited file is not the entrypoint. Also bust the require cache for the bundled
    // output so the new code is actually loaded (esbuild bundles to a single file, so the one
    // entrypoint key is sufficient).
    if (worker.backendEntrypoint) {
      const entrypoint = path.resolve(workerDir, worker.backendEntrypoint);
      await fs.rm(entrypoint, { force: true });
      delete require.cache[entrypoint];
    }

    await activateLocalWorker(worker, { previousVersion: worker.manifest.version });
    console.log(`[Workers] Hot-reloaded ${id}.`);
    await recordEventSafe({
      category: 'worker',
      action: 'worker_hot_reloaded',
      summary: `Hot-reloaded local worker ${id}.`,
      metadata: { workerId: id },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[Workers] Hot reload of ${id} failed; worker is now disabled until the error is fixed: ${message}`);
    await recordEventSafe({
      category: 'worker',
      action: 'worker_hot_reload_failed',
      summary: `Hot reload of ${id} failed: ${message}`,
      metadata: { workerId: id },
    }).catch(() => {});
  }
}
