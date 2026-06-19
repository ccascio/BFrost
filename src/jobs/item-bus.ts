/**
 * Item Bus — the generic producer/consumer surface workers use to exchange work items.
 *
 * Any worker can produce items of a declared dotted `itemType`.
 * Any worker can subscribe as a consumer by filtering on `itemType` / `tags` / `states`.
 *
 * Producers own the `payload`. Consumers write into a `metadata` map keyed by their own
 * `workerId` — that guarantees two consumers (e.g. an X publisher and a WordPress
 * publisher) of the same item never overwrite each other.
 *
 * The bus is built on top of the existing shared queue store so historical items and
 * dashboard transitions keep working unchanged.
 */

import {
  approveQueueItem,
  createQueueItem,
  loadQueue,
  markQueueItemDuplicateRejected,
  markQueueItemPostFailed,
  markQueueItemPosted,
  pruneQueue,
  rejectQueueItem,
  saveQueue,
  withQueueLock,
  type QueueItem,
  type QueueItemDraft,
  type QueueItemState,
} from './queue';

export type ItemType = string;

export interface PublishItemInput {
  producerWorkerId: string;
  itemType: ItemType;
  tags?: string[];
  /** Human-readable summary, used in events and the dashboard. */
  title: string;
  /** Slightly longer human-readable description. */
  shortDesc: string;
  /** Canonical URL identifying the item. Required for dedup parity with the legacy queue. */
  url: string;
  /** Producer-owned payload. Consumers may read but should not mutate. */
  payload?: Record<string, unknown>;
  /** Initial state — defaults to `queued`. Producers may publish in `seen` or `rejected` for ledger entries. */
  state?: QueueItemState;
  addedAt?: string;
  selectionReason?: string;
  rejectionReason?: string;
  stateReason?: string;
  /** Optional id override. Producers should normally let the bus derive a stable id. */
  id?: string;
}

export interface ConsumerFilter {
  itemType?: ItemType;
  itemTypes?: ItemType[];
  tags?: string[];
  states?: QueueItemState[];
  /** When true, items with existing metadata under the calling consumer id are excluded. */
  excludeAlreadyHandled?: boolean;
}

/** Build a draft for an item without persisting it. Used by producers that batch-save. */
export function buildItemDraft(input: PublishItemInput): QueueItemDraft {
  const addedAt = input.addedAt ?? new Date().toISOString();
  return {
    id: input.id,
    title: input.title,
    shortDesc: input.shortDesc,
    url: input.url,
    addedAt,
    state: input.state ?? 'queued',
    stateChangedAt: addedAt,
    stateReason: input.stateReason,
    selectionReason: input.selectionReason,
    rejectionReason: input.rejectionReason,
    producerWorkerId: input.producerWorkerId,
    itemType: input.itemType,
    tags: input.tags,
    payload: input.payload,
  };
}

/** Persist a newly-produced item. Returns the stored item. */
export async function publishItem(input: PublishItemInput): Promise<QueueItem> {
  return withQueueLock(async () => {
    const queue = await loadQueue();
    const created = createQueueItem(buildItemDraft(input));
    queue.push(created);
    await saveQueue(queue);
    return created;
  });
}

/** Filter items in memory according to a consumer's subscription. */
export function filterItemsForConsumer(
  items: QueueItem[],
  consumerWorkerId: string,
  filter: ConsumerFilter,
): QueueItem[] {
  const types = filter.itemTypes ?? (filter.itemType ? [filter.itemType] : undefined);
  const tags = filter.tags;
  const states = filter.states;

  return items.filter((item) => {
    if (types && (!item.itemType || !types.includes(item.itemType))) {
      return false;
    }
    if (tags && tags.length > 0) {
      const itemTags = item.tags ?? [];
      if (!tags.some((tag) => itemTags.includes(tag))) {
        return false;
      }
    }
    if (states && !states.includes(item.state)) {
      return false;
    }
    if (filter.excludeAlreadyHandled) {
      const handled = item.metadata?.[consumerWorkerId];
      if (handled && Object.keys(handled).length > 0) {
        return false;
      }
    }
    return true;
  });
}

/** Load and filter items in one call. Convenience for cron-driven consumers. */
export async function listItemsForConsumer(
  consumerWorkerId: string,
  filter: ConsumerFilter,
  nowMs = Date.now(),
): Promise<QueueItem[]> {
  const queue = pruneQueue(await loadQueue(), nowMs);
  return filterItemsForConsumer(queue, consumerWorkerId, filter);
}

/** Merge a fragment into a consumer's metadata namespace on a queue item. */
export function setConsumerMetadata(
  item: QueueItem,
  consumerWorkerId: string,
  fragment: Record<string, unknown>,
): QueueItem {
  const next = { ...(item.metadata ?? {}) };
  const existing = next[consumerWorkerId] ?? {};
  next[consumerWorkerId] = { ...existing, ...fragment };
  item.metadata = next;
  return item;
}

export function readConsumerMetadata<T extends Record<string, unknown> = Record<string, unknown>>(
  item: QueueItem,
  consumerWorkerId: string,
): T | undefined {
  return item.metadata?.[consumerWorkerId] as T | undefined;
}

export interface ConsumerSuccessInput {
  /** Default consumer state transition is `posted` for the legacy publishing flow. */
  transition?: 'posted' | 'approved' | 'rejected';
  /** Convenience for publishers whose downstream returns an id/tone. */
  postedId?: string;
  postedTone?: string;
  metadata?: Record<string, unknown>;
  nowIso?: string;
}

/**
 * Mark a consumer's work on an item as complete.
 *
 * For `transition: 'posted'` (the default) the shared item transitions to the `posted`
 * state — this matches the existing single-publishing-target queue semantics.
 *
 * When BFrost supports fan-out (multiple consumers per item), this helper will gain a
 * `partial` mode that records consumer completion in metadata without moving the
 * shared state. For now, callers explicitly opt into the legacy single-consumer flow.
 */
export function applyConsumerSuccess(
  item: QueueItem,
  consumerWorkerId: string,
  input: ConsumerSuccessInput,
): QueueItem {
  const transition = input.transition ?? 'posted';
  const nowIso = input.nowIso ?? new Date().toISOString();

  if (transition === 'posted') {
    const reason = input.postedId
      ? `Posted by ${consumerWorkerId} (id ${input.postedId}).`
      : `Posted by ${consumerWorkerId}.`;
    markQueueItemPosted(item, reason, nowIso);
  } else if (transition === 'approved') {
    item.state = 'approved';
    item.stateChangedAt = nowIso;
    item.stateReason = `Approved by ${consumerWorkerId}.`;
  } else if (transition === 'rejected') {
    item.state = 'rejected';
    item.stateChangedAt = nowIso;
    item.stateReason = `Rejected by ${consumerWorkerId}.`;
    item.rejectionReason = item.rejectionReason ?? `Rejected by ${consumerWorkerId}.`;
  }

  if (input.metadata) {
    setConsumerMetadata(item, consumerWorkerId, input.metadata);
  }
  return item;
}

export interface ConsumerFailureInput {
  errorMessage: string;
  maxAttempts: number;
  isDuplicate?: boolean;
  metadata?: Record<string, unknown>;
  nowIso?: string;
}

export function applyConsumerFailure(
  item: QueueItem,
  consumerWorkerId: string,
  input: ConsumerFailureInput,
): QueueItem {
  const nowIso = input.nowIso ?? new Date().toISOString();
  if (input.isDuplicate) {
    markQueueItemDuplicateRejected(item, input.errorMessage, input.maxAttempts, nowIso);
  } else {
    markQueueItemPostFailed(item, input.errorMessage, input.maxAttempts, nowIso);
  }
  if (input.metadata) {
    setConsumerMetadata(item, consumerWorkerId, input.metadata);
  }
  return item;
}

/** Re-exports for convenience so consumers only need to import from the bus. */
export { approveQueueItem, rejectQueueItem, withQueueLock, loadQueue, saveQueue, pruneQueue };
