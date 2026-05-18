import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import { z } from 'zod';
import { config } from '../config';
import { loadKvJson, saveKvJson } from '../sqlite';

const QUEUE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOCK_STALE_MS = 3 * 60 * 1000;
const QUEUE_STORE_KEY = 'news.queue';

export const QueueItemStateSchema = z.enum(['seen', 'rejected', 'queued', 'approved', 'posted', 'failed']);
export type QueueItemState = z.infer<typeof QueueItemStateSchema>;
/**
 * Generic Item Bus shape: the queue stores producer-owned `payload` and consumer-namespaced
 * `metadata`. There is no longer any worker-specific top-level column — historical data
 * with the old shape is silently dropped at load time (Zod strips unknown keys), and
 * workers are expected to migrate any state they care about into `payload` / `metadata`.
 */
const RawQueueItemSchema = z.object({
  id: z.string().min(1).max(80).optional(),
  title: z.string().min(1).max(200),
  shortDesc: z.string().min(1).max(400),
  url: z.string().url(),
  addedAt: z.string(),
  state: QueueItemStateSchema.optional(),
  stateChangedAt: z.string().optional(),
  stateReason: z.string().min(1).max(400).optional(),
  selectionReason: z.string().min(1).max(400).optional(),
  rejectionReason: z.string().min(1).max(400).optional(),
  postedAt: z.string().optional(),
  attemptCount: z.number().int().nonnegative().optional(),
  lastAttemptAt: z.string().optional(),
  lastError: z.string().optional(),
  // Item Bus fields — the generic producer/consumer contract every worker uses.
  producerWorkerId: z.string().min(1).max(80).optional(),
  itemType: z.string().min(1).max(120).optional(),
  tags: z.array(z.string().min(1).max(80)).max(32).optional(),
  payload: z.record(z.unknown()).optional(),
  metadata: z.record(z.record(z.unknown())).optional(),
});

export const QueueItemSchema = RawQueueItemSchema.extend({
  id: z.string().min(1).max(80),
  state: QueueItemStateSchema,
  stateChangedAt: z.string(),
});
export const QueueSchema = z.array(QueueItemSchema);
export type QueueItem = z.infer<typeof QueueItemSchema>;
export type QueueItemDraft = z.infer<typeof RawQueueItemSchema> & {
  state: QueueItemState;
  stateChangedAt: string;
};

export function queuePath(): string {
  return path.join(config.newsStoreDir, 'queue.json');
}

export function lockPath(): string {
  return path.join(config.newsStoreDir, 'queue.lock');
}

export async function loadQueue(): Promise<QueueItem[]> {
  const stored = await loadKvJson<unknown>(QUEUE_STORE_KEY);
  if (stored !== null) {
    const parsed = z.array(RawQueueItemSchema).parse(stored);
    return QueueSchema.parse(parsed.map(normalizeQueueItem));
  }

  try {
    const raw = await fs.readFile(queuePath(), 'utf8');
    const parsed = z.array(RawQueueItemSchema).parse(JSON.parse(raw));
    const queue = QueueSchema.parse(parsed.map(normalizeQueueItem));
    await saveQueue(queue);
    return queue;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw new Error(`Failed to read ${queuePath()}. Fix or move the invalid queue file before continuing. Cause: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function saveQueue(queue: QueueItem[]): Promise<void> {
  await saveKvJson(QUEUE_STORE_KEY, QueueSchema.parse(queue.map(normalizeQueueItem)));
}

export function pruneQueue(queue: QueueItem[], nowMs: number): QueueItem[] {
  return queue.filter((item) => {
    const anchorIso = item.stateChangedAt || item.postedAt || item.lastAttemptAt || item.addedAt;
    const anchor = Date.parse(anchorIso);
    return !Number.isNaN(anchor) && nowMs - anchor < QUEUE_TTL_MS;
  });
}

function normalizeQueueItem(item: z.infer<typeof RawQueueItemSchema>): QueueItem {
  const state =
    item.state ??
    (item.postedAt
      ? 'posted'
      : item.lastError || (item.attemptCount ?? 0) > 0
        ? 'failed'
        : 'queued');

  return {
    ...item,
    id: item.id ?? createQueueItemId(item),
    state,
    stateChangedAt: item.stateChangedAt ?? item.postedAt ?? item.lastAttemptAt ?? item.addedAt,
  };
}

export function createQueueItem(item: QueueItemDraft): QueueItem {
  return QueueItemSchema.parse(normalizeQueueItem(item));
}

export function createQueueItemId(item: Pick<z.infer<typeof RawQueueItemSchema>, 'url' | 'addedAt' | 'title'>): string {
  const digest = createHash('sha256')
    .update(`${item.url}\n${item.addedAt}\n${item.title}`)
    .digest('hex')
    .slice(0, 18);
  return `q_${digest}`;
}

export function approveQueueItem(queue: QueueItem[], id: string, nowIso = new Date().toISOString()): QueueItem {
  const target = findQueueItem(queue, id);
  if (target.state !== 'queued' && target.state !== 'failed') {
    throw new Error(`Cannot approve an item in ${target.state} state.`);
  }

  target.state = 'approved';
  target.stateChangedAt = nowIso;
  target.stateReason = 'Approved for publishing from the dashboard.';
  delete target.rejectionReason;
  delete target.lastError;
  return target;
}

export function rejectQueueItem(queue: QueueItem[], id: string, nowIso = new Date().toISOString()): QueueItem {
  const target = findQueueItem(queue, id);
  if (target.state === 'posted') {
    throw new Error('Cannot reject an item that has already been posted.');
  }

  target.state = 'rejected';
  target.stateChangedAt = nowIso;
  target.stateReason = 'Rejected from the dashboard.';
  target.rejectionReason = 'Rejected from the dashboard.';
  return target;
}

/**
 * Generic transition to the `posted` state. Consumer-specific identifiers
 * (e.g. tweet id, tone, target url) live in the consumer's metadata namespace.
 */
export function markQueueItemPosted(
  item: QueueItem,
  reason: string,
  nowIso = new Date().toISOString(),
): QueueItem {
  item.state = 'posted';
  item.postedAt = nowIso;
  item.stateChangedAt = nowIso;
  item.lastAttemptAt = nowIso;
  item.stateReason = reason;
  delete item.lastError;
  delete item.rejectionReason;
  return item;
}

export function markQueueItemDuplicateRejected(
  item: QueueItem,
  errorMessage: string,
  maxAttempts: number,
  nowIso = new Date().toISOString(),
): QueueItem {
  item.state = 'rejected';
  item.attemptCount = maxAttempts;
  item.lastAttemptAt = nowIso;
  item.lastError = errorMessage;
  item.stateChangedAt = nowIso;
  item.stateReason = 'Rejected because X flagged the generated post as duplicate content.';
  item.rejectionReason = 'X rejected the generated post as duplicate content.';
  return item;
}

export function markQueueItemPostFailed(
  item: QueueItem,
  errorMessage: string,
  maxAttempts: number,
  nowIso = new Date().toISOString(),
): QueueItem {
  item.attemptCount = (item.attemptCount ?? 0) + 1;
  item.lastAttemptAt = nowIso;
  item.lastError = errorMessage;
  item.state = 'failed';
  item.stateChangedAt = nowIso;
  item.stateReason =
    item.attemptCount >= maxAttempts
      ? `Posting failed permanently after ${item.attemptCount} attempts: ${errorMessage}`
      : `Posting failed on attempt ${item.attemptCount}: ${errorMessage}`;
  return item;
}

function findQueueItem(queue: QueueItem[], id: string): QueueItem {
  const target = queue.find((item) => item.id === id);
  if (!target) {
    throw new Error('Queue item not found.');
  }
  return target;
}

/**
 * Boot-time helper: drop any leftover queue.lock. The dashboard owns this data dir, so
 * if a previous process died holding the lock there's no other live owner to respect.
 * Safe even when the lock file is missing.
 */
export async function releaseStaleQueueLockOnBoot(): Promise<void> {
  const p = lockPath();
  try {
    const raw = await fs.readFile(p, 'utf8');
    await fs.unlink(p);
    console.warn(`[Queue] Cleared stale queue.lock left by pid ${raw.trim() || '<unknown>'}.`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[Queue] Failed to clean stale lock on boot:', err);
    }
  }
}

async function lockOwnerIsAlive(p: string): Promise<boolean> {
  try {
    const raw = (await fs.readFile(p, 'utf8')).trim();
    const pid = Number(raw);
    if (!Number.isInteger(pid) || pid <= 0) return false;
    if (pid === process.pid) return true;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

async function tryCreateLock(p: string): Promise<boolean> {
  try {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, String(process.pid), { flag: 'wx' });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  }
}

export async function withQueueLock<T>(fn: () => Promise<T>): Promise<T> {
  const p = lockPath();
  let acquired = await tryCreateLock(p);

  if (!acquired) {
    try {
      const stat = await fs.stat(p);
      const age = Date.now() - stat.mtimeMs;
      // Only break the lock when it's truly stale: older than LOCK_STALE_MS AND the
      // process that owns it is no longer alive. PID reuse is theoretically possible
      // on long-running boxes but vastly less harmful than nuking a live writer mid-merge.
      if (age > LOCK_STALE_MS && !(await lockOwnerIsAlive(p))) {
        console.warn('[Queue] Removing stale lock file (owner not alive).');
        await fs.unlink(p);
        acquired = await tryCreateLock(p);
      }
    } catch {
      // stat or unlink failed; treat as not acquired
    }
  }

  if (!acquired) {
    throw new Error('Could not acquire queue lock — another job may be running. Skipping.');
  }

  try {
    return await fn();
  } finally {
    try {
      await fs.unlink(p);
    } catch {
      // lock already gone; ignore
    }
  }
}
