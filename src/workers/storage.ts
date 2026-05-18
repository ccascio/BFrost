/**
 * Per-worker namespaced key-value storage.
 *
 * Every worker gets its own keyspace within the shared SQLite KV table: keys are
 * automatically prefixed with `worker.<workerId>.` so two workers cannot collide on
 * a key name and a backup of the app database carries worker state along with it.
 *
 * Workers must not invent ad-hoc prefixes against the raw KV; use this API so the
 * dashboard can later inspect, export, or clear a worker's state without parsing
 * arbitrary key shapes.
 */
import { loadKvJson, saveKvJson } from '../sqlite';

export interface WorkerKvStore {
  workerId: string;
  /** Read a JSON value stored under this worker's namespace. Returns null when missing. */
  get<T = unknown>(key: string): Promise<T | null>;
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

export function openWorkerKv(workerId: string): WorkerKvStore {
  validateWorkerId(workerId);
  const prefix = `worker.${workerId}.`;
  return {
    workerId,
    async get<T = unknown>(key: string): Promise<T | null> {
      validateKey(key);
      return loadKvJson<T>(`${prefix}${key}`);
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
