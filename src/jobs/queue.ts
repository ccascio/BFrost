import { promises as fs } from 'fs';
import { AsyncLocalStorage } from 'async_hooks';
import { createHash } from 'crypto';
import path from 'path';
import { z } from 'zod';
import { config } from '../config';
import { getAppDb, listKvJsonBySuffix } from '../sqlite';

const QUEUE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOCK_STALE_MS = 3 * 60 * 1000;
const QUEUE_STORE_KEY = 'item-bus.queue';
const QUEUE_TABLE = 'item_bus_items';
// A connection object is a safer memoization key than a process-wide boolean or path string:
// tests and restore flows may close and reopen the same path, while path-swap tests create a
// distinct connection that must receive its own schema initialization and migration probe.
const initializedQueueDbs = new WeakSet<object>();

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
  shortDesc: z.string().min(1),
  url: z.string().url(),
  addedAt: z.string(),
  state: QueueItemStateSchema.optional(),
  stateChangedAt: z.string().optional(),
  stateReason: z.string().min(1).optional(),
  selectionReason: z.string().min(1).optional(),
  rejectionReason: z.string().min(1).optional(),
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

interface QueueRow {
  id: string;
  sortOrder: number;
  title: string;
  shortDesc: string;
  url: string;
  addedAt: string;
  state: QueueItemState;
  stateChangedAt: string;
  stateReason: string | null;
  selectionReason: string | null;
  rejectionReason: string | null;
  postedAt: string | null;
  attemptCount: number | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  producerWorkerId: string | null;
  itemType: string | null;
  tagsJson: string | null;
  payloadJson: string | null;
  metadataJson: string | null;
}

export interface QueueQuery {
  ids?: string[];
  itemTypes?: string[];
  states?: QueueItemState[];
  /** Exclude rows carrying a non-empty metadata namespace for this consumer. */
  unhandledBy?: string;
  /**
   * Exclude rows whose lifecycle anchor is older than this timestamp.
   *
   * This can use `state_changed_at` directly because `normalizeQueueItem` always fills it
   * from the same posted/attempt/added fallback chain used by `pruneQueue`.
   */
  activeAfter?: string;
}

export function queuePath(): string {
  return path.join(config.itemBusStoreDir, 'queue.json');
}

export function lockPath(): string {
  return path.join(config.itemBusStoreDir, 'queue.lock');
}

/**
 * Stored rows are already validated by `RawQueueItemSchema`, and `normalizeQueueItem` fills the
 * three fields `QueueItemSchema` adds on top of it: `id` (always a 20-char `q_<sha256 slice>`
 * from `createQueueItemId`, well inside the 80-char bound), `state` (an enum member by
 * construction), and `stateChangedAt` (falls back to the required `addedAt`). Re-running
 * `QueueSchema.parse` over that result therefore re-validates data that cannot have changed,
 * at a cost that scales with queue size — so the read paths validate once. `saveQueue` still
 * validates in full on the way out, which is where caller mutations actually need checking.
 */
function normalizeStoredQueue(stored: unknown): QueueItem[] {
  return z.array(RawQueueItemSchema).parse(stored).map(normalizeQueueItem);
}

function optionalJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function parseOptionalJson<T>(value: string | null): T | undefined {
  return value === null ? undefined : JSON.parse(value) as T;
}

function rowToQueueItem(row: QueueRow): QueueItem {
  return normalizeQueueItem(RawQueueItemSchema.parse({
    id: row.id,
    title: row.title,
    shortDesc: row.shortDesc,
    url: row.url,
    addedAt: row.addedAt,
    state: row.state,
    stateChangedAt: row.stateChangedAt,
    stateReason: row.stateReason ?? undefined,
    selectionReason: row.selectionReason ?? undefined,
    rejectionReason: row.rejectionReason ?? undefined,
    postedAt: row.postedAt ?? undefined,
    attemptCount: row.attemptCount ?? undefined,
    lastAttemptAt: row.lastAttemptAt ?? undefined,
    lastError: row.lastError ?? undefined,
    producerWorkerId: row.producerWorkerId ?? undefined,
    itemType: row.itemType ?? undefined,
    tags: parseOptionalJson<string[]>(row.tagsJson),
    payload: parseOptionalJson<Record<string, unknown>>(row.payloadJson),
    metadata: parseOptionalJson<Record<string, Record<string, unknown>>>(row.metadataJson),
  }));
}

function itemParams(item: QueueItem, sortOrder: number): Record<string, unknown> {
  return {
    id: item.id,
    sortOrder,
    title: item.title,
    shortDesc: item.shortDesc,
    url: item.url,
    addedAt: item.addedAt,
    state: item.state,
    stateChangedAt: item.stateChangedAt,
    stateReason: item.stateReason ?? null,
    selectionReason: item.selectionReason ?? null,
    rejectionReason: item.rejectionReason ?? null,
    postedAt: item.postedAt ?? null,
    attemptCount: item.attemptCount ?? null,
    lastAttemptAt: item.lastAttemptAt ?? null,
    lastError: item.lastError ?? null,
    producerWorkerId: item.producerWorkerId ?? null,
    itemType: item.itemType ?? null,
    tagsJson: optionalJson(item.tags),
    payloadJson: optionalJson(item.payload),
    metadataJson: optionalJson(item.metadata),
  };
}

const INSERT_QUEUE_ITEM_SQL = `
  INSERT INTO ${QUEUE_TABLE} (
    id, sort_order, title, short_desc, url, added_at, state, state_changed_at,
    state_reason, selection_reason, rejection_reason, posted_at, attempt_count,
    last_attempt_at, last_error, producer_worker_id, item_type, tags_json,
    payload_json, metadata_json
  ) VALUES (
    @id, @sortOrder, @title, @shortDesc, @url, @addedAt, @state, @stateChangedAt,
    @stateReason, @selectionReason, @rejectionReason, @postedAt, @attemptCount,
    @lastAttemptAt, @lastError, @producerWorkerId, @itemType, @tagsJson,
    @payloadJson, @metadataJson
  )`;

const UPSERT_QUEUE_ITEM_SQL = `${INSERT_QUEUE_ITEM_SQL}
  ON CONFLICT(id) DO UPDATE SET
    sort_order = excluded.sort_order,
    title = excluded.title,
    short_desc = excluded.short_desc,
    url = excluded.url,
    added_at = excluded.added_at,
    state = excluded.state,
    state_changed_at = excluded.state_changed_at,
    state_reason = excluded.state_reason,
    selection_reason = excluded.selection_reason,
    rejection_reason = excluded.rejection_reason,
    posted_at = excluded.posted_at,
    attempt_count = excluded.attempt_count,
    last_attempt_at = excluded.last_attempt_at,
    last_error = excluded.last_error,
    producer_worker_id = excluded.producer_worker_id,
    item_type = excluded.item_type,
    tags_json = excluded.tags_json,
    payload_json = excluded.payload_json,
    metadata_json = excluded.metadata_json`;

async function ensureQueueTable(): Promise<Awaited<ReturnType<typeof getAppDb>>> {
  const db = await getAppDb();
  if (initializedQueueDbs.has(db)) return db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS item_bus_meta (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      storage_version INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ${QUEUE_TABLE} (
      id TEXT PRIMARY KEY,
      sort_order INTEGER NOT NULL,
      title TEXT NOT NULL,
      short_desc TEXT NOT NULL,
      url TEXT NOT NULL,
      added_at TEXT NOT NULL,
      state TEXT NOT NULL,
      state_changed_at TEXT NOT NULL,
      state_reason TEXT,
      selection_reason TEXT,
      rejection_reason TEXT,
      posted_at TEXT,
      attempt_count INTEGER,
      last_attempt_at TEXT,
      last_error TEXT,
      producer_worker_id TEXT,
      item_type TEXT,
      tags_json TEXT,
      payload_json TEXT,
      metadata_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_item_bus_type_state_anchor
      ON ${QUEUE_TABLE}(item_type, state, state_changed_at);
    CREATE INDEX IF NOT EXISTS idx_item_bus_anchor
      ON ${QUEUE_TABLE}(state_changed_at);
    CREATE INDEX IF NOT EXISTS idx_item_bus_sort_order
      ON ${QUEUE_TABLE}(sort_order);
  `);

  // One-time compatibility migration from the former monolithic app_kv blob. The delete is
  // committed in the same transaction as the inserts, so an interrupted migration either
  // retries from the untouched blob or leaves the normalized table authoritative.
  const legacy = db.prepare('SELECT value_json AS valueJson FROM app_kv WHERE key = ?').get(QUEUE_STORE_KEY) as { valueJson: string } | undefined;
  if (legacy) {
    const items = dedupeQueueById(normalizeStoredQueue(JSON.parse(legacy.valueJson)));
    const migrate = db.transaction(() => {
      const upsert = db.prepare(UPSERT_QUEUE_ITEM_SQL);
      items.forEach((item, index) => upsert.run(itemParams(item, index)));
      db.prepare('DELETE FROM app_kv WHERE key = ?').run(QUEUE_STORE_KEY);
      db.prepare('INSERT OR REPLACE INTO item_bus_meta (singleton, storage_version) VALUES (1, 1)').run();
    });
    migrate();
  }
  initializedQueueDbs.add(db);
  return db;
}

function queueStoreInitialized(db: Awaited<ReturnType<typeof getAppDb>>): boolean {
  return db.prepare('SELECT 1 FROM item_bus_meta WHERE singleton = 1').get() !== undefined;
}

function selectRowsSql(query: QueueQuery): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const addList = (column: string, values: string[] | undefined): void => {
    if (values === undefined) return;
    if (values.length === 0) {
      clauses.push('0 = 1');
      return;
    }
    clauses.push(`${column} IN (${values.map(() => '?').join(', ')})`);
    params.push(...values);
  };
  addList('id', query.ids);
  addList('item_type', query.itemTypes);
  addList('state', query.states);
  if (query.unhandledBy) {
    const path = `$."${query.unhandledBy.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    clauses.push('NOT EXISTS (SELECT 1 FROM json_each(json_extract(metadata_json, ?)))');
    params.push(path);
  }
  if (query.activeAfter) {
    clauses.push('state_changed_at >= ?');
    params.push(query.activeAfter);
  }
  return {
    sql: `SELECT
      id, sort_order AS sortOrder, title, short_desc AS shortDesc, url,
      added_at AS addedAt, state, state_changed_at AS stateChangedAt,
      state_reason AS stateReason, selection_reason AS selectionReason,
      rejection_reason AS rejectionReason, posted_at AS postedAt,
      attempt_count AS attemptCount, last_attempt_at AS lastAttemptAt,
      last_error AS lastError, producer_worker_id AS producerWorkerId,
      item_type AS itemType, tags_json AS tagsJson, payload_json AS payloadJson,
      metadata_json AS metadataJson
    FROM ${QUEUE_TABLE}${clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY sort_order`,
    params,
  };
}

/** Query only the indexed Item Bus rows a caller needs. */
export async function queryQueue(query: QueueQuery = {}): Promise<QueueItem[]> {
  const db = await ensureQueueTable();
  if (!queueStoreInitialized(db)) {
    // `loadQueue` owns the one-time file/KV compatibility scan. Once it completes all
    // selective callers stay on normalized rows and never touch the legacy blob again.
    await loadQueue();
  }
  const selected = selectRowsSql(query);
  const rows = db.prepare(selected.sql).all(...selected.params) as QueueRow[];
  return rows.map(rowToQueueItem);
}

export async function loadQueue(): Promise<QueueItem[]> {
  const db = await ensureQueueTable();
  if (queueStoreInitialized(db)) {
    const selected = selectRowsSql({});
    return (db.prepare(selected.sql).all(...selected.params) as QueueRow[]).map(rowToQueueItem);
  }

  const legacyKvQueue = await loadLegacyKvQueue();
  if (legacyKvQueue) {
    await saveQueue(legacyKvQueue);
    return legacyKvQueue;
  }

  try {
    const raw = await fs.readFile(queuePath(), 'utf8');
    const queue = normalizeStoredQueue(JSON.parse(raw));
    await saveQueue(queue);
    return queue;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      const legacyFileQueue = await loadLegacyFileQueue();
      if (legacyFileQueue) {
        await saveQueue(legacyFileQueue);
        return legacyFileQueue;
      }
      await saveQueue([]);
      return [];
    }
    throw new Error(`Failed to read ${queuePath()}. Fix or move the invalid queue file before continuing. Cause: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** The timestamp that orders an item's lifecycle — the same anchor `pruneQueue` retires on. */
function queueItemAnchorMs(item: QueueItem): number {
  const iso = item.stateChangedAt || item.postedAt || item.lastAttemptAt || item.addedAt;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * Collapse items that share an id, keeping one row per id.
 *
 * Item ids are deterministic content fingerprints (see `createQueueItemId` and each producer's
 * own id scheme), so two rows with the same id are the same producer fact — never distinct
 * work. `publishItem` already refuses to add a second, but it is not the only writer: a worker
 * that reloads the queue, does slow work, and saves a stale array can reintroduce a row another
 * path removed, and nothing downstream re-checks. Enforcing uniqueness here, at the one choke
 * point every write passes through, makes duplicates structurally impossible regardless of how
 * they arose (a real incident stranded 22 ownership rows this way until they aged out at TTL).
 *
 * The newest row (by lifecycle anchor) wins the scalar fields, but consumer metadata is unioned
 * across every copy — dropping a namespace would un-handle an item for that consumer and let it
 * be re-processed, the exact failure the handled-stamp exists to prevent. The newer row's entry
 * wins per consumer; namespaces only the older row carries are preserved.
 */
function dedupeQueueById(queue: QueueItem[]): QueueItem[] {
  const byId = new Map<string, QueueItem>();
  const order: string[] = [];
  for (const item of queue) {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
      order.push(item.id);
      continue;
    }
    const newer = queueItemAnchorMs(item) >= queueItemAnchorMs(existing) ? item : existing;
    const older = newer === item ? existing : item;
    const mergedMetadata = { ...older.metadata, ...newer.metadata };
    byId.set(item.id, Object.keys(mergedMetadata).length > 0 ? { ...newer, metadata: mergedMetadata } : newer);
  }
  return order.map((id) => byId.get(id)!);
}

/**
 * Replace the entire Item Bus contents with `queue`.
 *
 * This is a compatibility API for legacy whole-queue callers. It deliberately deletes every
 * stored row before inserting the supplied snapshot. Never pass a selective `queryQueue()`
 * result here: doing so would delete every unrelated item. New code should use
 * `insertQueueItem`, `updateQueueItems`, `upsertQueueItems`, or `deleteQueueItems`.
 */
export async function saveQueue(queue: QueueItem[]): Promise<void> {
  invalidateQueueReadCache();
  const normalized = QueueSchema.parse(dedupeQueueById(queue.map(normalizeQueueItem)));
  const db = await ensureQueueTable();
  const replace = db.transaction(() => {
    db.prepare(`DELETE FROM ${QUEUE_TABLE}`).run();
    const insert = db.prepare(INSERT_QUEUE_ITEM_SQL);
    normalized.forEach((item, index) => insert.run(itemParams(item, index)));
    db.prepare('INSERT OR REPLACE INTO item_bus_meta (singleton, storage_version) VALUES (1, 1)').run();
    db.prepare('DELETE FROM app_kv WHERE key = ?').run(QUEUE_STORE_KEY);
  });
  replace();
}

/** Read one Item Bus row without materialising unrelated payloads. */
export async function loadQueueItem(id: string): Promise<QueueItem | null> {
  const [item] = await queryQueue({ ids: [id] });
  return item ?? null;
}

/**
 * Insert a new Item Bus row without loading or rewriting the bus.
 * Returns the existing row when the stable id is already present.
 */
export async function insertQueueItem(item: QueueItem): Promise<{ item: QueueItem; inserted: boolean }> {
  assertQueueLockHeld('insertQueueItem');
  invalidateQueueReadCache();
  const db = await ensureQueueTable();
  if (!queueStoreInitialized(db)) await loadQueue();
  const existing = db.prepare(selectRowsSql({ ids: [item.id] }).sql).get(item.id) as QueueRow | undefined;
  if (existing) return { item: rowToQueueItem(existing), inserted: false };
  const nextOrder = (db.prepare(`SELECT coalesce(max(sort_order), -1) + 1 AS value FROM ${QUEUE_TABLE}`).get() as { value: number }).value;
  db.prepare(INSERT_QUEUE_ITEM_SQL).run(itemParams(QueueItemSchema.parse(item), nextOrder));
  return { item, inserted: true };
}

/** Persist only the supplied rows, preserving every unrelated Item Bus entry. */
export async function upsertQueueItems(items: readonly QueueItem[]): Promise<void> {
  assertQueueLockHeld('upsertQueueItems');
  if (items.length === 0) return;
  invalidateQueueReadCache();
  const db = await ensureQueueTable();
  if (!queueStoreInitialized(db)) await loadQueue();
  const write = db.transaction(() => {
    const upsert = db.prepare(UPSERT_QUEUE_ITEM_SQL);
    const orderStatement = db.prepare(`SELECT sort_order AS sortOrder FROM ${QUEUE_TABLE} WHERE id = ?`);
    let nextOrder = (db.prepare(`SELECT coalesce(max(sort_order), -1) + 1 AS value FROM ${QUEUE_TABLE}`).get() as { value: number }).value;
    for (const candidate of items) {
      const item = QueueItemSchema.parse(candidate);
      const existing = orderStatement.get(item.id) as { sortOrder: number } | undefined;
      upsert.run(itemParams(item, existing?.sortOrder ?? nextOrder++));
    }
  });
  write();
}

/** Delete selected rows without rewriting retained payloads. */
export async function deleteQueueItems(ids: readonly string[]): Promise<number> {
  assertQueueLockHeld('deleteQueueItems');
  if (ids.length === 0) return 0;
  invalidateQueueReadCache();
  const db = await ensureQueueTable();
  if (!queueStoreInitialized(db)) await loadQueue();
  const placeholders = ids.map(() => '?').join(', ');
  return db.prepare(`DELETE FROM ${QUEUE_TABLE} WHERE id IN (${placeholders})`).run(...ids).changes;
}

/** Atomically load and update only selected rows. Missing ids are ignored. */
export async function updateQueueItems(
  ids: readonly string[],
  update: (item: QueueItem) => void,
): Promise<QueueItem[]> {
  if (ids.length === 0) return [];
  return withQueueLock(async () => {
    const items = await queryQueue({ ids: [...new Set(ids)] });
    for (const item of items) update(item);
    await upsertQueueItems(items);
    return items;
  });
}

/** Timestamp accepted by indexed active-row queries for the shared queue TTL. */
export function queueActiveAfterIso(nowMs = Date.now()): string {
  return new Date(nowMs - QUEUE_TTL_MS).toISOString();
}

/**
 * Physically remove expired Item Bus rows without parsing their payloads.
 *
 * Reading only ids and lifecycle anchors keeps maintenance O(row count) in tiny scalar data.
 * The final delete goes through the guarded raw writer so queue mutations retain one lock
 * invariant everywhere.
 */
export async function reapExpiredQueueItems(nowMs = Date.now()): Promise<number> {
  return withQueueLock(async () => {
    const db = await ensureQueueTable();
    if (!queueStoreInitialized(db)) await loadQueue();
    const rows = db.prepare(`SELECT id, state_changed_at AS stateChangedAt FROM ${QUEUE_TABLE}`).all() as Array<{
      id: string;
      stateChangedAt: string;
    }>;
    const expiredIds = rows
      .filter((row) => {
        const anchor = Date.parse(row.stateChangedAt);
        return Number.isNaN(anchor) || nowMs - anchor >= QUEUE_TTL_MS;
      })
      .map((row) => row.id);
    return deleteQueueItems(expiredIds);
  });
}

/**
 * Read-only cache for callers that only inspect the queue.
 *
 * `loadQueue` materialises every normalized row, including every JSON payload. Handing every
 * dashboard reader its own copy would still drive the process's resident set, even though the
 * scheduled worker paths now use selective row queries. A shared copy is only safe because the
 * read path never mutates:
 * `pruneQueue`, `filterItemsForScope` and `buildQueueSnapshot` all `filter`/`slice` rather
 * than assign. Check that still holds before pointing another caller at this.
 *
 * Mutators keep calling `loadQueue` and keep getting a private array — `approveQueueItem` and
 * friends edit items in place, so they must never share. `saveQueue` drops the cache rather
 * than replacing it with the saved array, so a mutator that keeps editing its copy after
 * committing cannot leak those edits into a later reader.
 */
interface InFlightRead {
  generation: number;
  dbPath: string;
  promise: Promise<QueueItem[]>;
}

let cachedQueue: QueueItem[] | null = null;
let cachedFromDbPath: string | null = null;
let cacheGeneration = 0;
let inFlightRead: InFlightRead | null = null;

export function invalidateQueueReadCache(): void {
  cachedQueue = null;
  cachedFromDbPath = null;
  cacheGeneration += 1;
}

export async function loadQueueForRead(): Promise<readonly QueueItem[]> {
  // Tests (and anything else that repoints storage mid-process) swap `config.appDbPath`, which
  // would otherwise be invisible here and serve one database's queue for another's.
  if (cachedQueue && cachedFromDbPath !== config.appDbPath) invalidateQueueReadCache();
  if (cachedQueue) return cachedQueue;

  // The guard values belong to the moment the read *started*, not the moment this caller
  // arrived. A second caller that piggybacks on a read already in flight inherits that read's
  // generation, so it cannot seed the cache with rows a save superseded while the read ran.
  let read = inFlightRead;
  if (!read) {
    const started: InFlightRead = {
      generation: cacheGeneration,
      dbPath: config.appDbPath,
      promise: loadQueue(),
    };
    inFlightRead = started;
    // Identity check: only clear the slot if it still holds *this* read.
    started.promise
      .finally(() => {
        if (inFlightRead === started) inFlightRead = null;
      })
      .catch(() => {
        /* surfaced to awaiting callers below; nothing to do here */
      });
    read = started;
  }

  const queue = await read.promise;

  // A save that landed while this read was in flight makes the result already stale: still
  // return it (the caller asked for a snapshot before that write), but don't seed the cache.
  if (read.generation === cacheGeneration && read.dbPath === config.appDbPath) {
    cachedQueue = queue;
    cachedFromDbPath = read.dbPath;
  }
  return queue;
}

export function pruneQueue(queue: readonly QueueItem[], nowMs: number): QueueItem[] {
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

async function loadLegacyKvQueue(): Promise<QueueItem[] | null> {
  const entries = await listKvJsonBySuffix<unknown>('.queue');
  const legacy = entries.find((entry) => entry.key !== QUEUE_STORE_KEY);
  if (!legacy) return null;

  return normalizeStoredQueue(legacy.value);
}

async function loadLegacyFileQueue(): Promise<QueueItem[] | null> {
  const currentPath = path.resolve(queuePath());
  const parentDir = path.dirname(path.resolve(config.itemBusStoreDir));
  let entries: Array<{ filePath: string; mtimeMs: number } | null> = [];
  try {
    entries = await Promise.all(
      (await fs.readdir(parentDir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const filePath = path.join(parentDir, entry.name, 'queue.json');
          try {
            const stat = await fs.stat(filePath);
            return { filePath, mtimeMs: stat.mtimeMs };
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
              console.warn(`[Queue] Failed to inspect legacy queue file ${filePath}:`, err);
            }
            return null;
          }
        }),
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[Queue] Failed to scan legacy queue files:', err);
    }
    return null;
  }

  const candidates = entries
    .filter((entry): entry is { filePath: string; mtimeMs: number } => entry !== null)
    .filter((entry) => path.resolve(entry.filePath) !== currentPath)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const candidate of candidates) {
    try {
      return normalizeStoredQueue(JSON.parse(await fs.readFile(candidate.filePath, 'utf8')));
    } catch (err) {
      console.warn(`[Queue] Ignoring legacy queue file ${candidate.filePath}:`, err);
    }
  }

  return null;
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
  if (target.state !== 'queued' && target.state !== 'failed' && target.state !== 'rejected') {
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

/**
 * Tracks whether the current async context already holds the queue lock.
 *
 * Nesting `withQueueLock` has always been a bug — the fail-fast lock threw on the inner
 * call — so no working path does it. But now that waiting is possible, an accidental nested
 * call would deadlock rather than throw, turning a loud bug into a hang. Treating a
 * re-entrant call as a pass-through keeps that impossible: the caller already has exclusive
 * access, so running the body directly is exactly what the lock would have granted.
 */
const queueLockHeld = new AsyncLocalStorage<true>();

function assertQueueLockHeld(operation: string): void {
  if (!queueLockHeld.getStore()) {
    throw new Error(`${operation} requires withQueueLock; raw Item Bus row writes must be serialized.`);
  }
}

/**
 * In-process FIFO admission to the lock.
 *
 * Every job in this process shares one queue file, and jobs can now run concurrently. A
 * fail-fast file lock turns that into spurious "another job may be running" errors even
 * though the contenders are all in the same single-threaded process. Callers queue here
 * instead, so in-process contention waits its turn rather than failing.
 */
let inProcessLockChain: Promise<void> = Promise.resolve();

/** How long to keep retrying the on-disk lock, which now only guards *other processes*. */
const LOCK_WAIT_TIMEOUT_MS = 30_000;
const LOCK_POLL_INTERVAL_MS = 50;

async function acquireFileLock(p: string): Promise<boolean> {
  if (await tryCreateLock(p)) return true;
  try {
    const stat = await fs.stat(p);
    const age = Date.now() - stat.mtimeMs;
    // Only break the lock when it's truly stale: older than LOCK_STALE_MS AND the
    // process that owns it is no longer alive. PID reuse is theoretically possible
    // on long-running boxes but vastly less harmful than nuking a live writer mid-merge.
    if (age > LOCK_STALE_MS && !(await lockOwnerIsAlive(p))) {
      console.warn('[Queue] Removing stale lock file (owner not alive).');
      await fs.unlink(p);
      return await tryCreateLock(p);
    }
  } catch {
    // stat or unlink failed; treat as not acquired
  }
  return false;
}

export async function withQueueLock<T>(fn: () => Promise<T>): Promise<T> {
  if (queueLockHeld.getStore()) return fn();

  // Join the in-process queue: wait for the previous holder, then publish our own gate for
  // the next caller. Chaining the gate rather than the work keeps this FIFO and makes a
  // failing body release the lock for whoever is waiting.
  const previous = inProcessLockChain;
  let releaseInProcess: () => void = () => undefined;
  inProcessLockChain = new Promise<void>((resolve) => { releaseInProcess = resolve; });
  await previous;

  try {
    const p = lockPath();
    const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
    let acquired = await acquireFileLock(p);
    // Only another OS process can hold this now, so waiting is worthwhile where it used to
    // be pointless — an in-process contender would never have released it during the wait.
    while (!acquired && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_INTERVAL_MS));
      acquired = await acquireFileLock(p);
    }

    if (!acquired) {
      throw new Error('Could not acquire queue lock — another job may be running. Skipping.');
    }

    try {
      return await queueLockHeld.run(true, fn);
    } finally {
      try {
        await fs.unlink(p);
      } catch {
        // lock already gone; ignore
      }
    }
  } finally {
    releaseInProcess();
  }
}
