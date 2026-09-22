/**
 * Per-worker namespaced key-value storage.
 *
 * Every worker gets its own keyspace within the shared SQLite KV table: keys are
 * automatically prefixed with `worker.<workerId>.<scopeId>.` so two workers cannot collide on
 * a key name and a backup of the app database carries worker state along with it.
 *
 * Workers must not invent ad-hoc prefixes against the raw KV; use this API so the
 * dashboard can later inspect, export, or clear a worker's state without parsing
 * arbitrary key shapes.
 */
import { loadKvJson, saveKvJson } from '../sqlite';

export const GLOBAL_WORKER_SCOPE_ID = '__global__';

export interface WorkerKvStore {
  workerId: string;
  scopeId: string;
  /** Read a JSON value stored under this worker's namespace. Returns null when missing. */
  get<T = unknown>(key: string): Promise<T | null>;
  /** Read from this scope first, then the worker's global-default scope. */
  getWithGlobalFallback<T = unknown>(key: string): Promise<T | null>;
  /** Write a JSON value into this worker's namespace. */
  set(key: string, value: unknown): Promise<void>;
  /** Remove a key by writing null. (We do not currently expose a DELETE op on the shared KV.) */
  clear(key: string): Promise<void>;
}

function validateKey(key: string): void {
  if (!key || typeof key !== 'string') {
    throw new Error('Worker KV key must be a non-empty string.');
  }
  // Allow letters, digits, dot, dash, underscore. The leading `worker.<id>.` prefix is added by us.
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(key)) {
    throw new Error(`Invalid worker KV key: ${key}`);
  }
}

function validateWorkerId(workerId: string): void {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(workerId)) {
    throw new Error(`Invalid worker id for KV namespace: ${workerId}`);
  }
}

function normalizeScopeId(scopeId: string | null | undefined): string {
  return scopeId && scopeId.trim() ? scopeId.trim() : GLOBAL_WORKER_SCOPE_ID;
}

function validateScopeId(scopeId: string): void {
  if (!/^[a-z0-9_][a-z0-9._-]*$/i.test(scopeId)) {
    throw new Error(`Invalid worker scope id for KV namespace: ${scopeId}`);
  }
}

export function openWorkerKv(workerId: string, scopeId?: string | null): WorkerKvStore {
  validateWorkerId(workerId);
  const normalizedScopeId = normalizeScopeId(scopeId);
  validateScopeId(normalizedScopeId);
  const prefix = `worker.${workerId}.${normalizedScopeId}.`;
  const globalPrefix = `worker.${workerId}.${GLOBAL_WORKER_SCOPE_ID}.`;
  const legacyPrefix = `worker.${workerId}.`;

  async function getFromPrefix<T = unknown>(key: string, wantedPrefix: string): Promise<T | null> {
    return loadKvJson<T>(`${wantedPrefix}${key}`);
  }

  return {
    workerId,
    scopeId: normalizedScopeId,
    async get<T = unknown>(key: string): Promise<T | null> {
      validateKey(key);
      const scoped = await getFromPrefix<T>(key, prefix);
      if (scoped !== null) return scoped;
      if (normalizedScopeId === GLOBAL_WORKER_SCOPE_ID) {
        return getFromPrefix<T>(key, legacyPrefix);
      }
      return null;
    },
    async getWithGlobalFallback<T = unknown>(key: string): Promise<T | null> {
      validateKey(key);
      const scoped = await getFromPrefix<T>(key, prefix);
      if (scoped !== null || normalizedScopeId === GLOBAL_WORKER_SCOPE_ID) {
        return scoped ?? getFromPrefix<T>(key, legacyPrefix);
      }
      const global = await getFromPrefix<T>(key, globalPrefix);
      return global ?? getFromPrefix<T>(key, legacyPrefix);
    },
    async set(key: string, value: unknown): Promise<void> {
      validateKey(key);
      await saveKvJson(`${prefix}${key}`, value);
    },
    async clear(key: string): Promise<void> {
      validateKey(key);
      await saveKvJson(`${prefix}${key}`, null);
    },
  };
}
