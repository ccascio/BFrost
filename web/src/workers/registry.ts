import { useSyncExternalStore } from 'react';
import type { WorkerDashboardViewDefinition, WorkerQueueItem } from './types';

interface WorkerDashboardViewModule {
  dashboardView?: WorkerDashboardViewDefinition;
  dashboardViews?: WorkerDashboardViewDefinition[];
  default?: WorkerDashboardViewDefinition;
}

// Built-in views ship in the main bundle via Vite's import.meta.glob. Local worker
// views land via runtime-loaded IIFE bundles that call registerDashboardView() on the
// host-provided `window.bfrost` global — see `src/workers/build.ts` and `App.tsx`.
const dashboardViewModules = import.meta.glob<WorkerDashboardViewModule>(
  './builtin/*/dashboard.{ts,tsx}',
  { eager: true },
);

const builtInViews: WorkerDashboardViewDefinition[] = Object.values(dashboardViewModules)
  .flatMap((module) => {
    if (Array.isArray(module.dashboardViews)) return module.dashboardViews;
    const single = module.dashboardView ?? module.default;
    return single ? [single] : [];
  })
  .filter((view): view is WorkerDashboardViewDefinition => Boolean(view));

const runtimeViews: WorkerDashboardViewDefinition[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function registerDashboardView(view: WorkerDashboardViewDefinition): void {
  // Replace by workerId+kind so a hot-reload of a runtime bundle overwrites the prior
  // registration instead of stacking duplicates.
  const idx = runtimeViews.findIndex((existing) => existing.workerId === view.workerId && existing.kind === view.kind);
  if (idx >= 0) {
    runtimeViews[idx] = view;
  } else {
    runtimeViews.push(view);
  }
  notify();
}

export function unregisterDashboardViewsForWorker(workerId: string): void {
  let changed = false;
  for (let i = runtimeViews.length - 1; i >= 0; i--) {
    if (runtimeViews[i].workerId === workerId) {
      runtimeViews.splice(i, 1);
      changed = true;
    }
  }
  if (changed) notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let snapshotCache: WorkerDashboardViewDefinition[] = [...builtInViews, ...runtimeViews];
let snapshotVersion = 0;
listeners.add(() => {
  snapshotVersion += 1;
  snapshotCache = [...builtInViews, ...runtimeViews];
});

function getSnapshot(): WorkerDashboardViewDefinition[] {
  return snapshotCache;
}

export function useWorkerDashboardViews(): WorkerDashboardViewDefinition[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Non-hook accessor for code that runs outside React (tests, utilities). */
export function listWorkerDashboardViews(): WorkerDashboardViewDefinition[] {
  return snapshotCache;
}

/**
 * Aggregate every worker-provided Queue detail renderer for the selected item. Workers
 * filter on their own producer/consumer relationship internally and return null when
 * they have nothing to show, so the caller can drop empty slots cheaply.
 */
export function workerQueueItemDetails(item: WorkerQueueItem) {
  return snapshotCache
    .filter((view) => typeof view.queueItemDetail === 'function')
    .map((view) => {
      try {
        return { workerId: view.workerId, node: view.queueItemDetail!(item) };
      } catch (err) {
        console.warn(`[Workers] Queue detail renderer for ${view.workerId} failed:`, err);
        return { workerId: view.workerId, node: null };
      }
    })
    .filter((entry) => entry.node !== null && entry.node !== undefined && entry.node !== false);
}

/**
 * Inject a <script> tag that loads a local worker's compiled dashboard bundle. The
 * bundle is expected to call `window.bfrost.registerDashboardView(...)` during its
 * top-level execution. Returns a promise that resolves when the script finishes
 * loading (success or failure — failures surface via console).
 */
export function loadRuntimeWorkerBundle(workerId: string): Promise<void> {
  return new Promise((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-bfrost-worker="${workerId}"]`,
    );
    if (existing) {
      // Force a fresh fetch in case the worker author rebuilt; the ETag on the server
      // turns this into a cheap 304 when nothing changed.
      existing.remove();
      unregisterDashboardViewsForWorker(workerId);
    }
    const script = document.createElement('script');
    script.src = `/api/workers/${encodeURIComponent(workerId)}/dashboard.js`;
    script.async = true;
    script.dataset.bfrostWorker = workerId;
    script.onload = () => resolve();
    script.onerror = () => {
      console.warn(`[Workers] Failed to load dashboard bundle for ${workerId}`);
      resolve();
    };
    document.head.appendChild(script);
  });
}

void snapshotVersion;
