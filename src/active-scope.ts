// The platform's generic "active scope" primitive. Core tracks only an opaque scope id
// and which registered worker declares it *provides* the selectable scopes (see
// `WorkerManifest.scopeProvider`). Core never learns what a scope means — a worker (e.g.
// the WordPress sites worker) defines the options and reads the active id back. Removing
// the scope-provider worker removes the whole concept with no core change.
import { loadKvJson, saveKvJson } from './sqlite';
import { listWorkers } from './workers/registry';

const ACTIVE_SCOPE_KV_KEY = 'admin.activeScope';

interface ActiveScopeState {
  scopeId: string | null;
}

/** Id of the registered worker that declares `scopeProvider`, or null if none does. */
export function getScopeProviderWorkerId(): string | null {
  const provider = listWorkers().find((worker) => worker.scopeProvider === true);
  return provider?.id ?? null;
}

/** The currently-selected scope id, or null when nothing is selected. */
export async function getActiveScopeId(): Promise<string | null> {
  const state = await loadKvJson<ActiveScopeState>(ACTIVE_SCOPE_KV_KEY);
  return state?.scopeId ?? null;
}

/** Persist the active scope id (null clears the selection). Returns the stored value. */
export async function setActiveScopeId(scopeId: string | null): Promise<string | null> {
  await saveKvJson(ACTIVE_SCOPE_KV_KEY, { scopeId } satisfies ActiveScopeState);
  return scopeId;
}
