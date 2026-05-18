import {
  approveQueueItem,
  loadQueue,
  pruneQueue,
  rejectQueueItem,
  saveQueue,
  withQueueLock,
  type QueueItem,
  type QueueItemState,
} from './queue';
import { recordEventSafe } from '../event-log';

export type DashboardQueueAction = 'approve' | 'reject';

/**
 * For dashboard-triggered queue mutations, attribute the event to the item's producer
 * plus any consumers that have already touched the item. Falls back to nothing when the
 * item has no Item Bus metadata yet — keeps the event log free of hardcoded worker lists.
 */
function attributionMetadata(item: QueueItem): Record<string, unknown> {
  const workerIds = new Set<string>();
  if (item.producerWorkerId) workerIds.add(item.producerWorkerId);
  for (const consumer of Object.keys(item.metadata ?? {})) workerIds.add(consumer);
  return workerIds.size > 0 ? { workerIds: Array.from(workerIds) } : {};
}

export interface QueueSnapshot {
  total: number;
  queued: number;
  approved: number;
  posted: number;
  rejected: number;
  failed: number;
  seen: number;
  retrying: number;
  recentItems: QueueItem[];
}

export async function loadQueueSnapshot(nowMs = Date.now()): Promise<QueueSnapshot> {
  return buildQueueSnapshot(pruneQueue(await loadQueue(), nowMs));
}

export async function updateDashboardQueueItem(
  id: string,
  action: DashboardQueueAction,
): Promise<void> {
  const event = await withQueueLock(async () => {
    const queue = await loadQueue();
    const nowIso = new Date().toISOString();
    const item = action === 'approve'
      ? approveQueueItem(queue, id, nowIso)
      : rejectQueueItem(queue, id, nowIso);

    await saveQueue(queue);

    return {
      action: action === 'approve' ? 'approved' : 'rejected',
      summary: `${action === 'approve' ? 'Approved' : 'Rejected'} queue item: ${item.title}`,
      metadata: { ...attributionMetadata(item), id: item.id, url: item.url },
    };
  });

  await recordEventSafe({
    category: 'queue',
    action: event.action,
    summary: event.summary,
    metadata: event.metadata,
  });
}

function buildQueueSnapshot(items: QueueItem[]): QueueSnapshot {
  const counts = countStates(items);
  const failed = items.filter((item) => item.state === 'failed');

  return {
    total: items.length,
    queued: counts.queued,
    approved: counts.approved,
    posted: counts.posted,
    rejected: counts.rejected,
    failed: counts.failed,
    seen: counts.seen,
    retrying: failed.filter((item) => (item.attemptCount ?? 0) > 0).length,
    recentItems: items
      .slice()
      .sort((a, b) => Date.parse(b.stateChangedAt || b.addedAt) - Date.parse(a.stateChangedAt || a.addedAt)),
  };
}

function countStates(items: QueueItem[]): Record<QueueItemState, number> {
  const counts: Record<QueueItemState, number> = {
    seen: 0,
    rejected: 0,
    queued: 0,
    approved: 0,
    posted: 0,
    failed: 0,
  };

  for (const item of items) {
    counts[item.state] += 1;
  }

  return counts;
}
