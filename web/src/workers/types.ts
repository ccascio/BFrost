import type { ReactNode } from 'react';

export type WorkerDashboardViewKind = string;

export interface WorkerDashboardViewDefinition {
  workerId: string;
  kind: WorkerDashboardViewKind;
  surfaceIds: string[];
  menu?: {
    icon?: string;
    group?: string;
    order?: number;
    label?: string;
  };
  count: (ctx: Record<string, any>) => number | undefined;
  render: (ctx: Record<string, any>) => ReactNode;
  /**
   * Optional renderer for the Queue detail panel. Producers expose the canonical view of
   * an item they emitted; consumers contribute a section with their own metadata
   * (publish targets, post ids, etc.). Returning null is fine — the detail panel only
   * renders renderers that produce content for the given item.
   */
  queueItemDetail?: (item: WorkerQueueItem) => ReactNode;
}

/**
 * Minimal shape the queue-item detail renderers need. Mirrors the runtime QueueItem
 * without locking the renderer into every legacy field — workers should read their own
 * `payload` and `metadata` namespace rather than top-level columns.
 */
export interface WorkerQueueItem {
  id: string;
  title: string;
  shortDesc: string;
  url: string;
  state: string;
  addedAt: string;
  stateChangedAt?: string;
  stateReason?: string;
  selectionReason?: string;
  rejectionReason?: string;
  attemptCount?: number;
  lastAttemptAt?: string;
  lastError?: string;
  postedAt?: string;
  producerWorkerId?: string;
  itemType?: string;
  tags?: string[];
  payload?: Record<string, any>;
  metadata?: Record<string, Record<string, any>>;
}
