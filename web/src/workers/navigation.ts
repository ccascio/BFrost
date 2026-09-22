export type WorkerTabSetter = ((tab: string) => void) | undefined;

export function workerRoutePath(workerId: string, params: Record<string, string> = {}): string {
  const query = new URLSearchParams(params).toString();
  return `/workers/${encodeURIComponent(workerId)}${query ? `?${query}` : ''}`;
}

/** Navigate between worker-owned views without requiring a core-only callback.
 * Runtime worker dashboards do not always receive `setActiveTab`; updating history
 * alone is insufficient because pushState/replaceState do not emit `popstate`.
 * Dispatching it makes the existing shell route listener update the active view. */
export function navigateToWorkerRoute(
  setActiveTab: WorkerTabSetter,
  workerId: string,
  params: Record<string, string> = {},
): void {
  const path = workerRoutePath(workerId, params);
  if (typeof window === 'undefined') {
    setActiveTab?.(`worker:${workerId}`);
    return;
  }

  if (setActiveTab) {
    setActiveTab(`worker:${workerId}`);
    window.history.replaceState({}, '', path);
  } else {
    window.history.pushState({}, '', path);
  }
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** Focus parameters are one-shot UI instructions. Remove them after the destination
 * has read them so the shell cannot carry a stale ticker/cluster into later tabs. */
export function clearWorkerRouteFocus(): void {
  if (typeof window === 'undefined' || !window.location.search) return;
  window.history.replaceState({}, '', `${window.location.pathname}${window.location.hash}`);
}

/** Read a one-shot focus parameter. Pure — safe in a `useState` initializer under
 * StrictMode's double-invoke; strip it afterwards from a mount effect. */
export function readUrlParam(name: string): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get(name)?.trim() ?? '';
}

/** Selective variant of `clearWorkerRouteFocus`: strips only the named parameters,
 * preserving any other query state and the hash. Stripping twice is a no-op. */
export function stripUrlParams(...names: string[]): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  const present = names.filter((name) => params.has(name));
  if (present.length === 0) return;
  for (const name of present) params.delete(name);
  const query = params.toString();
  window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
}
