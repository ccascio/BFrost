import type { ReactNode } from 'react';
import type { WorkerDashboardUiContract } from './ui-contract';

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
    /** Sidebar entry to nest under (e.g. the core 'jobs' tab) — renders as a collapsible child. */
    parentId?: string;
  };
  /**
   * The queueFilter value the core shell should select whenever this worker's dashboard
   * tab becomes active (e.g. "pending") — falls back to "all" when unset. The core doesn't
   * know what this string means; it just relays whichever value the worker declares.
   */
  defaultQueueFilter?: string;
  /**
   * Dashboard sections this view's content is built from — in practice `'workerData'`,
   * which is fetched after the shell and is the slowest of them. While any named
   * section is still in flight core substitutes a neutral loading panel for the tab,
   * rather than letting the view render a "nothing here yet" state it will contradict
   * a second later.
   *
   * Leave it unset when the view fetches its own data (core's placeholder would delay
   * mounting, and with it those fetches), or when the view draws finer-grained
   * placeholders itself from `ctx.isSectionPending`.
   */
  loadingSections?: string[];
  count?: (ctx: Record<string, any>) => number | undefined;
  render?: (ctx: Record<string, any>) => ReactNode;
  /**
   * Optional renderer for the Queue detail panel. Producers expose the canonical view of
   * an item they emitted; consumers contribute a section with their own metadata
   * (publish targets, post ids, etc.). Returning null is fine — the detail panel only
   * renders renderers that produce content for the given item.
   */
  queueItemDetail?: (item: WorkerQueueItem) => ReactNode;
}

export interface WorkerDashboardRenderContext {
  activeWorkerTab?: Record<string, any>;
  dashboard?: Record<string, any>;
  busyKey?: string | null;
  ui?: WorkerDashboardUiContract;
  /**
   * True while any of the named dashboard sections is still in flight. `dashboard`
   * is seeded with empty slices before the sections land, so a view that would
   * otherwise render zeros or an empty state should render a loading placeholder
   * while this returns true. Sections a view reads: usually `'workerData'`, plus
   * `'queue'` / `'events'` / `'pipelineStages'` where relevant.
   */
  isSectionPending?: (...sections: string[]) => boolean;
  /**
   * Refresh dashboard state. Workers that pass their own id plus any workerData slots they
   * read get a targeted slice refresh; omitting ids retains the full-shell fallback.
   */
  refreshDashboard?: (workerIds?: readonly string[]) => void | Promise<void>;
  triggerRun?: (key: string, url: string, successMessage: string) => void | Promise<void>;
  [key: string]: any;
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
