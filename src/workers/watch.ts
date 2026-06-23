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
import { detach } from '../process-lifecycle';

const DEBOUNCE_MS = 300;
const IGNORED_EVENT_SEGMENTS = new Set(['.git', 'dist', 'node_modules']);

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

  const onChange = (root: string, filename: string | null) => {
    if (!filename) return;
    if (shouldIgnoreWorkerWatchPath(filename)) return;

    const changedPath = path.resolve(root, filename);
    if (shouldIgnoreWorkerWatchPath(changedPath)) return;

    const workerDir = findWorkerDirForChangedPath(changedPath, root);
    if (!workerDir) return;

    // Debounce per worker: editors emit a burst of events on save, but workers should reload
    // independently when two local workers are being edited at once.
    const existing = pending.get(workerDir);
    if (existing) clearTimeout(existing);
    pending.set(workerDir, setTimeout(() => {
      pending.delete(workerDir);
      detach(reloadChangedWorker(workerDir), 'workers:hot-reload');
    }, DEBOUNCE_MS));
  };

  const watchRoots = compactOverlappingWatchRoots(config.workerPaths.flatMap((root) => {
    const resolved = path.resolve(root);
    try {
      const stat = fsSync.statSync(resolved);
      if (stat.isDirectory()) return [resolved];
      if (stat.isFile()) return [path.dirname(resolved)];
    } catch {
      // missing roots are ignored below
    }
    return [];
  }));

  for (const resolved of watchRoots) {
    try {
      // recursive is supported on macOS and Windows. On Linux it is ignored by Node, so only
      // direct children of the root fire events; the worker dir layout (root/<id>/...) still
      // surfaces saves to files one level down via the directory's own change events.
      const watcher = fsSync.watch(resolved, { recursive: true }, (_event, filename) => onChange(resolved, filename));
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
 * Rediscover local workers and reload the currently-registered worker rooted at `workerDir`.
 * Cheap to call on every debounced tick — discovery is a directory scan and reload only fires
 * for the enabled worker whose directory produced the event.
 */
async function reloadChangedWorker(workerDir: string): Promise<void> {
  let discovery;
  try {
    discovery = await discoverLocalWorkerResult();
  } catch (err) {
    console.warn('[Workers] Hot reload: discovery failed:', err);
    return;
  }

  const registeredIds = new Set(listLocalWorkerModules().map((module) => module.manifest.id));
  const resolvedWorkerDir = path.resolve(workerDir);
  for (const worker of discovery.workers) {
    if (!registeredIds.has(worker.manifest.id)) continue; // only reload enabled workers
    if (path.dirname(path.resolve(worker.sourcePath)) !== resolvedWorkerDir) continue;
    await reloadWorker(worker);
    return;
  }
}

async function reloadWorker(worker: DiscoveredLocalWorker): Promise<void> {
  const id = worker.manifest.id;
  const workerDir = path.dirname(path.resolve(worker.sourcePath));
  const previousVersion = listLocalWorkerModules().find((module) => module.manifest.id === id)?.manifest.version
    ?? worker.manifest.version;

  try {
    await deactivateLocalWorker(id);

    // Force a fresh compile: the mtime cache is non-recursive and could otherwise skip a rebuild
    // when the edited file is not the entrypoint. Also bust the require cache for the bundled
    // output so the new code is actually loaded (esbuild bundles to a single file, so the one
    // entrypoint key is sufficient).
    if (worker.backendEntrypoint) {
      const entrypoint = path.resolve(workerDir, worker.backendEntrypoint);
      if (worker.language === 'typescript') {
        await fs.rm(entrypoint, { force: true });
      }
      delete require.cache[entrypoint];
    }

    await activateLocalWorker(worker, { previousVersion });
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
    }).catch((eventErr) => {
      console.warn(`[Workers] Failed to record hot reload failure for ${id}:`, eventErr);
    });
  }
}

export function compactOverlappingWatchRoots(roots: string[]): string[] {
  const sorted = Array.from(new Set(roots.map((root) => path.resolve(root))))
    .sort((a, b) => pathSegments(a).length - pathSegments(b).length || a.localeCompare(b));
  const compacted: string[] = [];
  for (const root of sorted) {
    if (compacted.some((parent) => isPathInside(parent, root))) continue;
    compacted.push(root);
  }
  return compacted;
}

export function shouldIgnoreWorkerWatchPath(value: string): boolean {
  const segments = pathSegments(value);
  if (segments.some((segment) => IGNORED_EVENT_SEGMENTS.has(segment))) return true;

  const basename = segments[segments.length - 1] ?? '';
  return basename.endsWith('~') || basename.includes('.tmp');
}

export function findWorkerDirForChangedPath(changedPath: string, root: string): string | null {
  const resolvedRoot = path.resolve(root);
  let cursor = path.resolve(changedPath);

  try {
    const stat = fsSync.statSync(cursor);
    if (!stat.isDirectory()) {
      cursor = path.dirname(cursor);
    }
  } catch {
    cursor = path.dirname(cursor);
  }

  while (cursor === resolvedRoot || isPathInside(resolvedRoot, cursor)) {
    if (fsSync.existsSync(path.join(cursor, 'worker.json'))) {
      return cursor;
    }
    const next = path.dirname(cursor);
    if (next === cursor) break;
    cursor = next;
  }

  return null;
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function pathSegments(value: string): string[] {
  return value.split(/[\\/]+/).filter(Boolean);
}
