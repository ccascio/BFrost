// Pure presentational components + stateless helpers extracted from App.tsx.
// All top-level (no App closure state) — they take props/args only. (CODE_ROADMAP 1.2)
import { useState, type ReactNode, type CSSProperties } from 'react';
import type { WorkerDashboardViewDefinition } from './workers/types';
import {
  ActionClass, ActionRequest, ActionState, AppBackupRecord, AppError, AuthSession, AutoBackupSettings, CORE_CHAT_PROMPTS, CORE_MENU_ENTRIES, ChatProject, ChatPromptButton, ChatPromptExample, ChatThread, ChatTurn, CoreConfigKey, CoreDashboardTab, DASHBOARD_REFRESH_INTERVAL_MS, DashboardSectionName, DashboardState, DashboardTab, EventLogRecord, HealthStatus, JOBS_REFRESH_INTERVAL_MS, JobBaseField, JobBooleanField, JobDashboardField, JobDraft, JobMetricsResponse, JobNumberField, JobParamDraftValue, JobPreset, JobRunMetrics, JobSecretReferenceField, JobSelectField, JobStringListField, JobTextField, JobTextareaField, ModelOption, PERMISSION_INFO, PlatformSettings, QueueFilter, QueueItem, RecipeInputStorage, RegisteredPlatformEntry, RunStatus, SchedulerJobState, SchedulerRunRecord, SourceQualityRules, StoreWorkerDetail, StoreWorkerListing, StoreWorkerVersion, WhatsNewEntry, WorkerDashboardManifest, WorkerDashboardSurface, WorkerHealthRequirementStatus, WorkerHealthState, WorkerJobSummary, WorkerKind, WorkerLoadIssue, WorkerOnboardingAction, WorkerOwnedSetting, WorkerRecipe, WorkerRecipeInput, WorkerRecipeStep, WorkerRunMetrics, WorkerSummary, WorkerTabDefinition, toAppError,
} from './app-types';

export function sectionEndpoint(name: DashboardSectionName): string {
  switch (name) {
    case 'queue': return '/api/dashboard/queue';
    case 'cronRuns': return '/api/dashboard/cron-runs';
    case 'events': return '/api/dashboard/events';
    case 'backups': return '/api/dashboard/backups';
    case 'workerData': return '/api/dashboard/worker-data';
    case 'lmStudioModels': return '/api/dashboard/lmstudio-models';
  }
}

export function jobScheduleChanges(job: SchedulerJobState, draft: JobDraft): Array<{ field: string; from: string; to: string }> {
  const changes: Array<{ field: string; from: string; to: string }> = [];
  if (draft.enabled !== job.enabled) {
    changes.push({ field: 'Enabled', from: job.enabled ? 'Yes' : 'No', to: draft.enabled ? 'Yes' : 'No' });
  }
  if (draft.cron !== job.cron) {
    changes.push({ field: 'Schedule', from: job.cron, to: draft.cron });
  }
  if (draft.modelAlias !== job.modelAlias) {
    changes.push({
      field: 'Model',
      from: job.modelAlias || '(platform default)',
      to: draft.modelAlias || '(platform default)',
    });
  }
  if (draft.approvalRequired !== job.approvalRequired) {
    changes.push({
      field: 'Require approval',
      from: job.approvalRequired ? 'Yes' : 'No',
      to: draft.approvalRequired ? 'Yes' : 'No',
    });
  }
  return changes;
}

export function mergeSection(
  dashboard: DashboardState,
  name: DashboardSectionName,
  payload: any,
): DashboardState {
  switch (name) {
    case 'queue':
      return { ...dashboard, queue: payload.queue };
    case 'cronRuns':
      return { ...dashboard, cron: { ...dashboard.cron, runs: payload.runs } };
    case 'events':
      return { ...dashboard, events: payload.events };
    case 'backups':
      return { ...dashboard, backups: payload.backups };
    case 'workerData':
      return { ...dashboard, workerData: payload.workerData } as DashboardState;
    case 'lmStudioModels':
      return { ...dashboard, lmStudio: { ...dashboard.lmStudio, loadedModels: payload.loadedModels } };
  }
}

// Map each dashboard tab to the sections it needs before it can render correctly. Worker
// tabs and anything that reads queue/events/workerData get a wide fetch — keeping this
// table conservative is safer than under-fetching and showing empty UI.
export function sectionsForTab(tab: DashboardTab): DashboardSectionName[] {
  if (tab === 'overview') return ['queue', 'events', 'lmStudioModels'];
  if (tab === 'pipeline') return ['queue'];
  if (tab === 'channels') return ['workerData'];
  if (tab === 'jobs') return ['cronRuns', 'queue'];
  if (tab === 'system') return ['events', 'backups'];
  if (tab === 'chat') return [];
  if (tab === 'config') return ['queue', 'workerData'];
  if (tab === 'workers') return [];
  if (tab.startsWith('worker-config:')) return ['queue', 'workerData'];
  // Worker-provided tabs may render queue items, events, or worker dashboard slices.
  return ['queue', 'events', 'workerData'];
}

export function safeWorkerViewCount(definition: WorkerDashboardViewDefinition, ctx: Record<string, any>): number | undefined {
  if (typeof definition.count !== 'function') return undefined;
  try {
    return definition.count(ctx);
  } catch (err) {
    console.warn(`[Workers] Count renderer for ${definition.workerId} failed:`, err);
    return undefined;
  }
}

export function renderWorkerDashboardView(tab: WorkerTabDefinition, ctx: Record<string, any>): ReactNode {
  if (typeof tab.definition.render !== 'function') {
    return (
      <section className="panel tab-page">
        <div className="panel-head">
          <div>
            <p className="panel-kicker">{tab.worker.name}</p>
            <h2>Dashboard unavailable</h2>
          </div>
        </div>
        <p className="empty-state">This worker did not register a dashboard renderer.</p>
      </section>
    );
  }
  try {
    return tab.definition.render(ctx);
  } catch (err) {
    console.warn(`[Workers] Dashboard renderer for ${tab.worker.id} failed:`, err);
    return (
      <section className="panel tab-page">
        <div className="panel-head">
          <div>
            <p className="panel-kicker">{tab.worker.name}</p>
            <h2>Dashboard unavailable</h2>
          </div>
        </div>
        <p className="empty-state">This worker dashboard failed to render. The rest of BFrost is still available.</p>
      </section>
    );
  }
}

export function buildWorkerTabDefinitions(
  workers: WorkerSummary[],
  views: WorkerDashboardViewDefinition[],
): WorkerTabDefinition[] {
  return workers.flatMap((worker) => {
    if (!worker.enabled || worker.missing) {
      return [];
    }
    // Channel workers have their own Channels tab — no additional sidebar entry needed.
    if (worker.kind === 'channel') {
      return [];
    }

    const definition = views.find((view) => view.workerId === worker.id && workerDeclaresView(worker, view));
    if (definition) {
      return [{ id: workerTabId(worker.id), worker, definition }];
    }
    return [];
  });
}

export function workerDeclaresView(worker: WorkerSummary, definition: WorkerDashboardViewDefinition): boolean {
  const surfaceIds = new Set([
    ...(Array.isArray(worker.dashboard?.routes) ? worker.dashboard.routes.map((surface) => surface.id) : []),
    ...(Array.isArray(worker.dashboard?.settings) ? worker.dashboard.settings.map((surface) => surface.id) : []),
  ]);
  const definitionSurfaceIds = Array.isArray(definition.surfaceIds) ? definition.surfaceIds : [];
  return definitionSurfaceIds.some((surfaceId) => surfaceIds.has(surfaceId));
}

export function workerTabId(workerId: string): `worker:${string}` {
  return `worker:${workerId}`;
}

export function configSurfaceKey(workerId: string, surfaceId: string): string {
  return `${workerId}:${surfaceId}`;
}

export function jobConfigSummary(job: SchedulerJobState): string {
  const parts = ['model'];
  if (job.dashboardFields.length > 0) {
    parts.push(`${job.dashboardFields.length} field${job.dashboardFields.length === 1 ? '' : 's'}`);
  }
  if (job.promptEditable) {
    parts.push('prompt');
  }
  return parts.join(' · ');
}

export function coreMenuCount(
  id: DashboardTab,
  counts: { workers: number; channels: number; jobs: number; config: number; chat: number; system: number; store: number; pendingActions: number },
): number | undefined {
  switch (id) {
    case 'workers':
      return counts.workers;
    case 'channels':
      return counts.channels;
    case 'jobs':
      return counts.jobs;
    case 'config':
      return counts.config;
    case 'chat':
      return counts.chat;
    case 'system':
      return counts.system;
    case 'store':
      return counts.store > 0 ? counts.store : undefined;
    case 'actions':
      return counts.pendingActions > 0 ? counts.pendingActions : undefined;
    default:
      return undefined;
  }
}

export function Metric({
  label,
  value,
  active,
  onClick,
}: {
  label: string;
  value: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span>{label}</span>
      <strong>{value}</strong>
    </>
  );

  if (onClick) {
    return (
      <button
        className={`metric metric-button${active ? ' active' : ''}`}
        type="button"
        aria-pressed={Boolean(active)}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }

  return (
    <div className="metric">
      {content}
    </div>
  );
}

export function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function DetailBlock({
  label,
  value,
  tone,
}: {
  label: string;
  value?: string;
  tone?: 'error';
}) {
  if (!value) return null;
  return (
    <div className={`detail-block${tone === 'error' ? ' error' : ''}`}>
      <span>{label}</span>
      <p>{value}</p>
    </div>
  );
}

export function stringListDraftRows(value: JobParamDraftValue): string[] {
  const rows = String(value).split('\n');
  return rows.length > 0 ? rows : [''];
}

export function stringListDraftItems(value: JobParamDraftValue): string[] {
  return stringListDraftRows(value)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normalizeStringListItem(value: string): string {
  return value.trim().toLowerCase();
}

export function stringListDraftIncludes(value: JobParamDraftValue, item: string): boolean {
  const normalized = normalizeStringListItem(item);
  return stringListDraftItems(value).some((current) => normalizeStringListItem(current) === normalized);
}

export function addStringListDraftValue(value: JobParamDraftValue, item: string): string {
  const trimmed = item.trim();
  if (!trimmed) return String(value);
  const items = stringListDraftItems(value);
  if (items.some((current) => normalizeStringListItem(current) === normalizeStringListItem(trimmed))) {
    return items.join('\n');
  }
  return [...items, trimmed].join('\n');
}

export function toggleStringListDraftValue(value: JobParamDraftValue, item: string): string {
  const normalized = normalizeStringListItem(item);
  const items = stringListDraftItems(value);
  if (items.some((current) => normalizeStringListItem(current) === normalized)) {
    return items.filter((current) => normalizeStringListItem(current) !== normalized).join('\n');
  }
  return addStringListDraftValue(value, item);
}

export function fieldListPlaceholder(field: JobStringListField): string {
  if (field.placeholder) return field.placeholder;
  const key = field.key.toLowerCase();
  if (key.includes('host')) return 'example.com';
  if (key.includes('quer')) return 'Add an interest';
  return 'Add an item';
}

export function buildJobParamsDraft(job: SchedulerJobState): Record<string, JobParamDraftValue> {
  const params = job.params ?? {};
  return Object.fromEntries(
    job.dashboardFields.map((field) => {
      const value = params[field.key];
      if (field.type === 'number') {
        return [field.key, typeof value === 'number' ? value : field.defaultValue];
      }
      if (field.type === 'boolean') {
        return [field.key, typeof value === 'boolean' ? value : field.defaultValue];
      }
      if (field.type === 'string-list') {
        return [
          field.key,
          Array.isArray(value)
            ? value.filter((item) => typeof item === 'string').join('\n')
            : field.defaultValue.join('\n'),
        ];
      }
      if (field.type === 'select' || field.type === 'secret-reference') {
        return [field.key, typeof value === 'string' ? value : field.defaultValue];
      }
      return [field.key, typeof value === 'string' ? value : field.defaultValue];
    }),
  );
}

export function buildSurfaceDraft(
  surface: WorkerDashboardSurface,
  workerData?: Record<string, unknown>,
): Record<string, JobParamDraftValue> {
  return Object.fromEntries(
    (surface.fields ?? []).map((field) => [field.key, fieldDefaultDraftValue(field, workerData)]),
  );
}

export function fieldDefaultDraftValue(
  field: JobDashboardField,
  workerData?: Record<string, unknown>,
): JobParamDraftValue {
  if (field.seedPath && workerData) {
    const seeded = resolveSeedPath(workerData, field.seedPath);
    if (seeded !== undefined) {
      if (field.type === 'string-list' && Array.isArray(seeded)) {
        return seeded.filter((v) => typeof v === 'string').join('\n');
      }
      if (field.type === 'number' && typeof seeded === 'number') return seeded;
      if (field.type === 'boolean' && typeof seeded === 'boolean') return seeded;
      if ((field.type === 'text' || field.type === 'textarea' || field.type === 'select' || field.type === 'secret-reference') && typeof seeded === 'string') {
        return seeded;
      }
    }
  }
  if (field.type === 'string-list') return field.defaultValue.join('\n');
  return field.defaultValue;
}

export function resolveSeedPath(root: Record<string, unknown>, path: string): unknown {
  let cursor: unknown = root;
  let segments = path.split('.');
  while (segments.length > 0) {
    if (cursor === null || cursor === undefined || typeof cursor !== 'object') return undefined;
    const current = cursor as Record<string, unknown>;
    let matched = false;
    for (let length = segments.length; length >= 1; length -= 1) {
      const key = segments.slice(0, length).join('.');
      if (Object.prototype.hasOwnProperty.call(current, key)) {
        cursor = current[key];
        segments = segments.slice(length);
        matched = true;
        break;
      }
    }
    if (!matched) return undefined;
  }
  return cursor;
}

export function serializeDashboardFields(
  fields: JobDashboardField[],
  draft: Record<string, JobParamDraftValue>,
): Record<string, unknown> {
  return Object.fromEntries(
    fields.map((field) => {
      const value = draft[field.key] ?? fieldDefaultDraftValue(field);
      if (field.type === 'string-list') {
        return [field.key, String(value).split('\n').map((item) => item.trim()).filter(Boolean)];
      }
      if (field.type === 'number') {
        return [field.key, typeof value === 'number' ? value : Number(value)];
      }
      if (field.type === 'boolean') {
        return [field.key, Boolean(value)];
      }
      return [field.key, String(value)];
    }),
  );
}

export function serializeJobParams(job: SchedulerJobState, draft: JobDraft): Record<string, unknown> {
  return serializeDashboardFields(job.dashboardFields, draft.params);
}

export function surfaceDraftHasValue(fields: JobDashboardField[], draft: Record<string, JobParamDraftValue>): boolean {
  return fields.some((field) => {
    const value = draft[field.key] ?? fieldDefaultDraftValue(field);
    if (field.type === 'boolean') return true;
    if (field.type === 'number') return typeof value === 'number' && Number.isFinite(value);
    if (field.type === 'string-list') {
      return String(value).split('\n').some((item) => item.trim().length > 0);
    }
    return String(value).trim().length > 0;
  });
}

/**
 * Inline contextual help. Renders a small "?" button; clicking it toggles a plain-text
 * explanation panel directly below the trigger. No external dependencies.
 */
export function HelpTip({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="helptip">
      <button
        type="button"
        className="helptip-trigger"
        aria-label="Help"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >?</button>
      {open ? <span className="helptip-body">{children}</span> : null}
    </span>
  );
}

export function HealthRow({ label, status }: { label: string; status: HealthStatus }) {
  return (
    <div className="health-row">
      <div>
        <strong>{label}</strong>
        <span className="health-copy">{status.detail}</span>
      </div>
      <StatusPill tone={status.ok ? 'good' : 'warning'}>{status.ok ? 'ready' : 'missing'}</StatusPill>
    </div>
  );
}

export type StoreVisualWorker = Pick<StoreWorkerListing, 'id' | 'category' | 'tags'>;

export const STORE_VISUAL_RULES: Array<{ icon: string; keywords: string[] }> = [
  { icon: '📡', keywords: ['rss', 'feed', 'feeds', 'atom', 'reader'] },
  { icon: '🐘', keywords: ['fediverse', 'mastodon', 'activitypub', 'social'] },
  { icon: '📝', keywords: ['wordpress', 'publishing', 'publish', 'blog', 'cms', 'writer', 'write', 'post'] },
  { icon: '🤖', keywords: ['ai', 'llm', 'agent', 'assistant', 'model', 'automation'] },
  { icon: '🔔', keywords: ['notify', 'notification', 'alert', 'webhook', 'mail', 'message'] },
  { icon: '🔍', keywords: ['search', 'lookup', 'crawl', 'discover', 'index', 'knowledge'] },
];

export const STORE_PALETTE_COUNT = 8;

export function StoreWorkerLogo({
  worker,
  size = 'default',
  installed = false,
}: {
  worker: StoreVisualWorker;
  size?: 'default' | 'large';
  installed?: boolean;
}) {
  return (
    <span className={`store-worker-logo store-palette-${storePaletteIndex(worker.category)} ${size === 'large' ? 'large' : ''}`}>
      <span aria-hidden="true">{storeWorkerIcon(worker)}</span>
      {installed ? <span className="store-installed-badge" aria-label="Installed">✓</span> : null}
    </span>
  );
}

export function StoreTrustBadge({ trust }: { trust: string }) {
  const label = trust.trim() || 'Community';
  return <span className={`store-trust-badge ${storeTrustTone(label)}`}>{label}</span>;
}

export function storeWorkerIcon(worker: StoreVisualWorker): string {
  const signal = [worker.category, worker.id, ...worker.tags].join(' ').toLowerCase();
  return STORE_VISUAL_RULES.find((rule) => rule.keywords.some((keyword) => signal.includes(keyword)))?.icon ?? '📦';
}

export function storePaletteIndex(category: string): number {
  const label = storeCategoryLabel(category).toLowerCase();
  let hash = 0;
  for (const char of label) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % STORE_PALETTE_COUNT;
}

export function storeCategoryKey(category: string): string {
  return storeCategoryLabel(category).toLowerCase();
}

export function storeCategoryLabel(category: string): string {
  const label = category.trim();
  return label || 'General';
}

export function storeTrustTone(trust: string): 'review' | 'community' | 'verified' | 'trusted' | 'core' {
  const normalized = trust.trim().toLowerCase();
  if (normalized === 'review') return 'review';
  if (normalized === 'verified') return 'verified';
  if (normalized === 'trusted') return 'trusted';
  if (normalized === 'core') return 'core';
  return 'community';
}

export function storeAuthorHandle(author: string): string {
  const trimmed = author.trim();
  if (!trimmed) return 'Unknown author';
  if (trimmed.startsWith('@') || trimmed.includes(' ')) return trimmed;
  return `@${trimmed}`;
}

export function buildChatPromptButtons(dashboard: DashboardState): ChatPromptButton[] {
  const core = CORE_CHAT_PROMPTS.map((prompt) => ({
    ...prompt,
    id: `core:${prompt.label}`,
  }));
  const workerPrompts = dashboard.workers
    .filter((worker) => worker.enabled && !worker.missing)
    .flatMap((worker) =>
      (worker.chatPrompts ?? []).map((prompt) => ({
        ...prompt,
        id: `${worker.id}:${prompt.label}`,
        source: worker.displayName ?? worker.name,
      })),
    );
  return [...core, ...workerPrompts];
}

export function ChatWelcome({
  prompts,
  onSelect,
}: {
  prompts: ChatPromptButton[];
  onSelect: (prompt: string) => void;
}) {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const filteredPrompts = normalizedQuery
    ? prompts.filter((example) =>
        [
          example.label,
          example.description,
          example.source ?? '',
          example.prompt,
        ].some((value) => value.toLowerCase().includes(normalizedQuery)),
      )
    : prompts;

  return (
    <div className="chat-empty" role="note">
      <p className="chat-empty-kicker">Welcome to dashboard chat</p>
      <h3>Ask freely, or hand work to a worker.</h3>
      <p>
        Ask open questions about BFrost, your queue, your schedules, or your models — or ask a worker
        to do something, in plain language.
      </p>
      <p className="footnote" style={{ marginTop: '0.75rem' }}>
        Try one of these:
      </p>
      <div className="chat-prompt-search">
        <input
          type="search"
          aria-label="Filter example requests"
          placeholder="Filter example requests"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span>{filteredPrompts.length} shown</span>
      </div>
      <div className="chat-empty-prompts">
        {filteredPrompts.map((example, index) => (
          <button
            key={example.id}
            type="button"
            className="chat-empty-prompt"
            title={example.prompt}
            style={{ animationDelay: `${Math.min(index, 18) * 32}ms` }}
            onClick={() => onSelect(example.prompt)}
          >
            <span>{example.label}</span>
            <small>{example.source ? `${example.source}: ${example.description}` : example.description}</small>
          </button>
        ))}
        {filteredPrompts.length === 0 ? (
          <p className="empty-state chat-prompt-empty">No matching example requests.</p>
        ) : null}
      </div>
    </div>
  );
}

export function ChatSuggestions({
  prompts,
  onSelect,
}: {
  prompts: ChatPromptButton[];
  onSelect: (prompt: string) => void;
}) {
  const chips = prompts.slice(0, 4);
  if (chips.length === 0) return null;
  return (
    <div className="chat-suggestions" aria-label="Quick prompts">
      {chips.map((p) => (
        <button
          key={p.id}
          type="button"
          className="chat-suggestion-chip"
          title={p.prompt}
          onClick={() => onSelect(p.prompt)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

export function StatusPill({
  children,
  tone,
}: {
  children: string;
  tone: 'good' | 'warning' | 'info' | 'muted';
}) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
}

export const RUN_ERROR_PREVIEW_CHARS = 180;

export function RunError({ message }: { message: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = message.length > RUN_ERROR_PREVIEW_CHARS;
  const display = expanded || !isLong ? message : `${message.slice(0, RUN_ERROR_PREVIEW_CHARS)}…`;
  return (
    <div className="run-error">
      <p className="error-text">{display}</p>
      {isLong ? (
        <button
          type="button"
          className="run-error-toggle"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </div>
  );
}

export function statusTone(status: RunStatus): 'good' | 'warning' | 'info' | 'muted' {
  if (status === 'success') return 'good';
  if (status === 'error') return 'warning';
  if (status === 'skipped') return 'info';
  return 'muted';
}

// ---------------------------------------------------------------------------
// Pipeline view — builds a generic producer/consumer graph from Item Bus data
// ---------------------------------------------------------------------------

export interface PipelineNode {
  workerId: string;
  displayName: string;
  count: number;
  itemTypes: string[];
}

export interface PipelineTopology {
  producers: PipelineNode[];
  consumers: PipelineNode[];
  totalItems: number;
  unconsumedCount: number;
}

export function buildPipelineTopology(items: QueueItem[], workers: WorkerSummary[]): PipelineTopology {
  const producerMap = new Map<string, { count: number; types: Set<string> }>();
  const consumerMap = new Map<string, { count: number; types: Set<string> }>();
  let unconsumedCount = 0;

  for (const item of items) {
    if (!item.producerWorkerId) continue;
    if (!producerMap.has(item.producerWorkerId)) {
      producerMap.set(item.producerWorkerId, { count: 0, types: new Set() });
    }
    const p = producerMap.get(item.producerWorkerId)!;
    p.count++;
    if (item.itemType) p.types.add(item.itemType);

    const consumers = Object.keys(item.metadata ?? {});
    if (consumers.length === 0) unconsumedCount++;
    for (const cId of consumers) {
      if (!consumerMap.has(cId)) consumerMap.set(cId, { count: 0, types: new Set() });
      const c = consumerMap.get(cId)!;
      c.count++;
      if (item.itemType) c.types.add(item.itemType);
    }
  }

  const label = (id: string) => workers.find((w) => w.id === id)?.displayName ?? id;

  return {
    producers: [...producerMap.entries()].map(([workerId, d]) => ({
      workerId,
      displayName: label(workerId),
      count: d.count,
      itemTypes: [...d.types],
    })),
    consumers: [...consumerMap.entries()].map(([workerId, d]) => ({
      workerId,
      displayName: label(workerId),
      count: d.count,
      itemTypes: [...d.types],
    })),
    totalItems: items.filter((i) => i.producerWorkerId).length,
    unconsumedCount,
  };
}

export function renderPipelineTab(dashboard: DashboardState, onRunDemo: () => void): ReactNode {
  const topology = buildPipelineTopology(dashboard.queue.recentItems, dashboard.workers);
  const isEmpty = topology.producers.length === 0 && topology.consumers.length === 0;

  return (
    <section className="tab-page pipeline-tab">
      <div className="pipeline-tab-header">
        <p className="panel-kicker">Live view</p>
        <h2>Item Bus Pipeline</h2>
        <p className="footnote">
          Every item in the bus, organised by who produced it and who consumed it.
          Producers publish items; consumers stamp their workerId into the metadata —
          this graph is derived from those stamps alone, with no worker names baked in.
        </p>
      </div>

      {isEmpty ? (
        <section className="panel">
          <div className="empty-state">
            <p>The bus is empty — no items have been produced yet.</p>
            <p className="footnote">
              Run the demo to see a live producer → bus → consumer graph, or enable the
              news and research workers to start a real pipeline.
            </p>
            <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
              <button type="button" className="primary" onClick={onRunDemo}>
                Go to the demo →
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section className="panel pipeline-graph-card">
          <div className="pipeline-graph">
            {/* Producers */}
            <div className="pipeline-col pipeline-producers-col" aria-label="Producers">
              <p className="pipeline-col-label">Producers</p>
              {topology.producers.map((node) => (
                <div key={node.workerId} className="pipeline-node pipeline-node-producer">
                  <strong className="pipeline-node-name">{node.displayName}</strong>
                  <span className="pipeline-node-count">{node.count} item{node.count !== 1 ? 's' : ''}</span>
                  <span className="pipeline-node-types footnote">{node.itemTypes.join(' · ')}</span>
                </div>
              ))}
            </div>

            {/* Left flow lane */}
            <div className="pipeline-lane" aria-hidden>
              <div className="pipeline-lane-track">
                <span className="pipeline-dot" style={{ '--dot-delay': '0s' } as CSSProperties} />
                <span className="pipeline-dot" style={{ '--dot-delay': '0.5s' } as CSSProperties} />
                <span className="pipeline-dot" style={{ '--dot-delay': '1.0s' } as CSSProperties} />
              </div>
            </div>

            {/* Item Bus center */}
            <div className="pipeline-bus-col" aria-label="Item Bus">
              <p className="pipeline-col-label">Item Bus</p>
              <div className="pipeline-bus-node">
                <strong className="pipeline-bus-count">{topology.totalItems}</strong>
                <span className="pipeline-bus-label">items</span>
                {topology.unconsumedCount > 0 ? (
                  <span className="pipeline-bus-inflight footnote">{topology.unconsumedCount} queued</span>
                ) : null}
                {topology.totalItems - topology.unconsumedCount > 0 ? (
                  <span className="pipeline-bus-consumed footnote">{topology.totalItems - topology.unconsumedCount} consumed</span>
                ) : null}
              </div>
            </div>

            {/* Right flow lane */}
            <div className="pipeline-lane pipeline-lane-right" aria-hidden>
              <div className="pipeline-lane-track">
                <span className="pipeline-dot" style={{ '--dot-delay': '0.25s' } as CSSProperties} />
                <span className="pipeline-dot" style={{ '--dot-delay': '0.75s' } as CSSProperties} />
                <span className="pipeline-dot" style={{ '--dot-delay': '1.25s' } as CSSProperties} />
              </div>
            </div>

            {/* Consumers */}
            <div className="pipeline-col pipeline-consumers-col" aria-label="Consumers">
              <p className="pipeline-col-label">Consumers</p>
              {topology.consumers.length > 0 ? topology.consumers.map((node) => (
                <div key={node.workerId} className="pipeline-node pipeline-node-consumer">
                  <strong className="pipeline-node-name">{node.displayName}</strong>
                  <span className="pipeline-node-count">{node.count} consumed</span>
                  <span className="pipeline-node-types footnote">{node.itemTypes.join(' · ')}</span>
                </div>
              )) : (
                <div className="pipeline-node pipeline-node-empty">
                  <span className="pipeline-node-name muted">No consumers yet</span>
                  <span className="pipeline-node-types footnote">Items are queued, waiting to be picked up</span>
                </div>
              )}
            </div>
          </div>

          <p className="footnote pipeline-graph-footer">
            Producers left · consumers right · the bus in the middle. Item types and consumer IDs
            come from the queue — adding a worker that produces or consumes a type updates this graph automatically.
          </p>
        </section>
      )}
    </section>
  );
}

export function workerHealthTone(state: WorkerHealthState): 'good' | 'warning' | 'info' | 'muted' {
  if (state === 'healthy') return 'good';
  if (state === 'missing_credentials' || state === 'missing_dependency') return 'warning';
  if (state === 'degraded') return 'info';
  return 'muted';
}

export function workerHealthLabel(state: WorkerHealthState): string {
  if (state === 'missing_credentials') return 'missing credentials';
  if (state === 'missing_dependency') return 'missing dependency';
  return state;
}

export function workerOwnsEvent(worker: WorkerSummary, event: EventLogRecord): boolean {
  if (event.metadata.workerId === worker.id) return true;

  const workerIds = event.metadata.workerIds;
  if (Array.isArray(workerIds) && workerIds.includes(worker.id)) return true;

  const eventJob = event.metadata.job;
  return typeof eventJob === 'string' && worker.jobs.some((job) => job.id === eventJob);
}

export function resolveDashboardTab(value: string | undefined): DashboardTab | null {
  if (value === 'overview' ||
    value === 'workers' ||
    value === 'jobs' ||
    value === 'config' ||
    value === 'chat' ||
    value === 'system' ||
    value === 'pipeline') {
    return value;
  }
  if (value === 'settings' || value === 'configuration') return 'config';
  if (value === 'events' || value === 'health') return 'system';
  return null;
}

export function eventSeverityTone(severity: EventLogRecord['severity']): 'good' | 'warning' | 'info' | 'muted' {
  if (severity === 'error') return 'warning';
  if (severity === 'warning') return 'info';
  return 'muted';
}

export function runDuration(run: SchedulerRunRecord | undefined): string | null {
  if (!run?.finishedAt) return null;

  const startedMs = Date.parse(run.startedAt);
  const finishedMs = Date.parse(run.finishedAt);
  if (Number.isNaN(startedMs) || Number.isNaN(finishedMs) || finishedMs < startedMs) {
    return null;
  }

  return formatDuration(finishedMs - startedMs);
}

export function runSeverity(run: SchedulerRunRecord): EventLogRecord['severity'] {
  if (run.status === 'error') return 'error';
  if (run.status === 'skipped') return 'warning';
  return 'info';
}

export function runStatusTone(status: SchedulerRunRecord['status']): 'good' | 'warning' | 'info' | 'muted' {
  if (status === 'success') return 'good';
  if (status === 'error') return 'warning';
  if (status === 'skipped' || status === 'running') return 'info';
  return 'muted';
}

export function runStatusSummary(run: SchedulerRunRecord): string {
  if (run.status === 'running') return `${run.label} is running.`;
  if (run.status === 'skipped') return `${run.label} was skipped.`;
  if (run.status === 'error') return `${run.label} failed.`;
  return `${run.label} completed successfully.`;
}

export function queueItemTone(
  state: QueueItem['state'],
): 'good' | 'warning' | 'info' | 'muted' {
  if (state === 'posted') return 'good';
  if (state === 'failed' || state === 'rejected') return 'warning';
  if (state === 'queued' || state === 'approved') return 'info';
  return 'muted';
}

export function queueItemReason(item: QueueItem): string | null {
  return item.stateReason ?? item.selectionReason ?? item.rejectionReason ?? item.lastError ?? null;
}

export function providerLabel(provider: string, workers: WorkerSummary[]): string {
  const match = workers.find(
    (w) => w.kind === 'provider' && w.id.endsWith(`.${provider}`)
  );
  return match?.displayName ?? match?.name ?? provider;
}

export function hostsToDraft(values: string[]): string {
  return values.join('\n');
}

export function draftToHosts(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function safeHost(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

export function formatDate(value: string | null): string {
  if (!value) return 'n/a';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

export function formatRelativeTime(value: string): string {
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return '';
  const diffMs = Date.now() - ts;
  if (diffMs < 60_000) return 'just now';
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(ts);
}
