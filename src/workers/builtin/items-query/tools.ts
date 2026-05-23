import { filterItemsForConsumer, loadQueue } from '../../../jobs/item-bus';
import type { QueueItem, QueueItemState } from '../../../jobs/queue';
import { listSchedulerRuns, type SchedulerRunRecord } from '../../../scheduler-runs';
import { listWorkers } from '../../../workers/registry';

const CONSUMER_ID = 'core.items.query';
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const KNOWN_STATES: ReadonlySet<QueueItemState> = new Set<QueueItemState>([
  'queued',
  'approved',
  'posted',
  'rejected',
  'failed',
  'seen',
]);

export interface QueryItemsInput {
  itemType?: string;
  itemTypes?: string[];
  producerWorkerId?: string;
  tags?: string[];
  states?: string[];
  since?: string;
  limit?: number;
}

export async function queryItems(input: QueryItemsInput): Promise<string> {
  const limit = clampLimit(input.limit);
  const states = sanitizeStates(input.states);
  const allItems = await loadQueue();
  let items = filterItemsForConsumer(allItems, CONSUMER_ID, {
    itemType: input.itemType,
    itemTypes: input.itemTypes,
    tags: input.tags,
    states,
    excludeAlreadyHandled: false,
  });

  if (input.producerWorkerId) {
    items = items.filter((item) => item.producerWorkerId === input.producerWorkerId);
  }

  if (input.since) {
    const cutoff = Date.parse(input.since);
    if (Number.isFinite(cutoff)) {
      items = items.filter((item) => Date.parse(item.addedAt) >= cutoff);
    }
  }

  items.sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt));
  const sliced = items.slice(0, limit);

  if (sliced.length === 0) {
    return describeEmptyResult(input);
  }

  const header = `Found ${items.length} item${items.length === 1 ? '' : 's'}${items.length > limit ? ` (showing newest ${limit})` : ''}:`;
  const body = sliced.map(formatItem).join('\n\n');
  return `${header}\n\n${body}`;
}

export interface RecentRunsInput {
  jobName?: string;
  status?: string;
  limit?: number;
}

export async function recentRuns(input: RecentRunsInput): Promise<string> {
  const limit = clampLimit(input.limit);
  let runs = await listSchedulerRuns(MAX_LIMIT);
  if (input.jobName) {
    runs = runs.filter((run) => run.job === input.jobName);
  }
  if (input.status) {
    const status = input.status.trim().toLowerCase();
    runs = runs.filter((run) => run.status === status);
  }
  const sliced = runs.slice(0, limit);
  if (sliced.length === 0) {
    return input.jobName
      ? `No scheduler runs recorded for job "${input.jobName}".`
      : 'No scheduler runs recorded yet.';
  }
  const header = `Showing ${sliced.length} recent run${sliced.length === 1 ? '' : 's'}:`;
  const body = sliced.map(formatRun).join('\n\n');
  return `${header}\n\n${body}`;
}

function clampLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_LIMIT;
  const floored = Math.floor(value);
  if (floored <= 0) return DEFAULT_LIMIT;
  return Math.min(floored, MAX_LIMIT);
}

function sanitizeStates(states: string[] | undefined): QueueItemState[] | undefined {
  if (!states || states.length === 0) return undefined;
  const cleaned = states
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is QueueItemState => KNOWN_STATES.has(value as QueueItemState));
  return cleaned.length > 0 ? cleaned : undefined;
}

function formatItem(item: QueueItem): string {
  // Use the producer's custom summarizer when available — it provides friendlier output
  // than the generic field dump below (e.g. "Tech article: 'AI study' — 3 min read").
  const producerWorker = item.producerWorkerId
    ? listWorkers().find((w) => w.id === item.producerWorkerId)
    : undefined;
  if (producerWorker?.summarizeForAssistant) {
    try {
      const summary = producerWorker.summarizeForAssistant(item as unknown as Record<string, unknown>);
      return `• ${summary}`;
    } catch { /* fall through to default */ }
  }

  const lines: string[] = [];
  lines.push(`• ${item.title}`);
  const meta: string[] = [];
  if (item.producerWorkerId) meta.push(`from ${item.producerWorkerId}`);
  if (item.itemType) meta.push(item.itemType);
  meta.push(item.state);
  meta.push(formatRelative(item.addedAt));
  lines.push(`  ${meta.join(' · ')}`);
  if (item.shortDesc) lines.push(`  ${item.shortDesc}`);
  lines.push(`  ${item.url}`);
  return lines.join('\n');
}

function formatRun(run: SchedulerRunRecord): string {
  const finished = run.finishedAt ? formatRelative(run.finishedAt) : 'running';
  const duration =
    run.finishedAt && run.startedAt
      ? `${Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000)}s`
      : null;
  const tail = [
    run.status,
    finished,
    duration ? `${duration}` : null,
    run.itemCount != null ? `${run.itemCount} items` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const lines = [`• ${run.label} (${run.job})`, `  ${tail}`];
  if (run.summary) lines.push(`  ${run.summary}`);
  if (run.error) lines.push(`  error: ${run.error}`);
  return lines.join('\n');
}

function formatRelative(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return iso;
  const diffMs = Date.now() - ts;
  if (diffMs < 0) return new Date(ts).toISOString();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toISOString().slice(0, 10);
}

function describeEmptyResult(input: QueryItemsInput): string {
  const filters: string[] = [];
  if (input.itemType) filters.push(`itemType="${input.itemType}"`);
  if (input.itemTypes?.length) filters.push(`itemTypes=[${input.itemTypes.join(', ')}]`);
  if (input.producerWorkerId) filters.push(`producerWorkerId="${input.producerWorkerId}"`);
  if (input.tags?.length) filters.push(`tags=[${input.tags.join(', ')}]`);
  if (input.states?.length) filters.push(`states=[${input.states.join(', ')}]`);
  if (input.since) filters.push(`since="${input.since}"`);
  return filters.length > 0
    ? `No items match these filters: ${filters.join(', ')}.`
    : 'No items have been published to the bus yet.';
}
