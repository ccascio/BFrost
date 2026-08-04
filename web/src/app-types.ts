// Shared frontend types + module-level constants, extracted from App.tsx so the
// core shell and (incrementally) per-tab modules import them instead of nesting
// them in one 7k-line file. (CODE_ROADMAP Phase 1.2)
import type { SidebarEntry } from './Sidebar';
import type { WorkerDashboardViewDefinition } from './workers/types';
export * from './app-types/store';

export type RunStatus = 'idle' | 'success' | 'error' | 'skipped';
export type CoreDashboardTab = 'overview' | 'channels' | 'workers' | 'jobs' | 'config' | 'chat' | 'system' | 'store' | 'actions' | 'health' | 'pipeline';

export interface AppError {
  friendly: string;
  /** Raw technical message — shown under 'Details' toggle and included in the diagnostic bundle. */
  detail?: string;
}

/** Map a raw caught error to a user-facing AppError. */
export function toAppError(raw: unknown): AppError {
  const msg = raw instanceof Error ? raw.message : String(raw);
  const lower = msg.toLowerCase();
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || msg === 'Load failed') {
    return { friendly: 'Could not reach BFrost. Check that the server is still running.', detail: msg };
  }
  if (lower.includes('econnrefused')) {
    return { friendly: 'Connection refused — BFrost may not be running.', detail: msg };
  }
  if (lower.includes('unauthorized') || msg.includes('401')) {
    return { friendly: 'Your session has expired. Please log in again.', detail: msg };
  }
  if (lower.includes('forbidden') || msg.includes('403')) {
    return { friendly: "You don't have permission to do that.", detail: msg };
  }
  if (lower.includes('not found') || msg.includes('404')) {
    return { friendly: "That resource wasn't found. Try refreshing.", detail: msg };
  }
  if (msg.includes('500') || lower.includes('internal server error')) {
    return { friendly: 'BFrost encountered an unexpected server error. Try again in a moment.', detail: msg };
  }
  if (msg.includes('502') || msg.includes('503')) {
    return { friendly: 'BFrost is temporarily unavailable. Try again shortly.', detail: msg };
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return { friendly: 'The request timed out. Try again.', detail: msg };
  }
  if (msg === 'Request failed') {
    return { friendly: "The action didn't complete. Try again, or check the server logs.", detail: msg };
  }
  // Looks like a stack trace / long technical string
  const looksLikeTechnical = msg.includes('\n') || /^error:/i.test(msg) || msg.length > 150
    || (msg.includes(' at ') && msg.includes('.js:'));
  if (looksLikeTechnical) {
    return { friendly: 'Something went wrong.', detail: msg };
  }
  return { friendly: msg };
}
export type DashboardTab = CoreDashboardTab | `worker:${string}` | `worker-config:${string}`;
// Core queue states + 'all'/'retrying' plus any worker-declared filter key (e.g. "pending",
// "unclassified") — worker dashboards define their own filter semantics as opaque strings.
export type QueueFilter = 'all' | QueueItem['state'] | 'retrying' | (string & {});
export type CoreConfigKey = 'platform-routing' | 'embedding-model' | 'platform-security' | `worker:${string}`;

export const DASHBOARD_REFRESH_INTERVAL_MS = 30000;
export const JOBS_REFRESH_INTERVAL_MS = 5000;

export interface ChatPromptExample {
  label: string;
  description: string;
  prompt: string;
}

export interface WorkerOnboardingAction {
  id: string;
  title: string;
  description: string;
  endpoint?: string;
  runJob?: string;
  /** When true, activating routes to the contributing worker's own dashboard tab. */
  navigateWorkerTab?: boolean;
  /** Worker health requirement key that marks this onboarding action complete. */
  completedWhenHealthKey?: string;
  priority?: number;
}

export interface ChatPromptButton extends ChatPromptExample {
  id: string;
  source?: string;
  category?: string;
}

export const CORE_CHAT_PROMPTS: ChatPromptExample[] = [
  {
    label: 'Pipeline status',
    description: 'Get a full summary of the redaction pipeline.',
    prompt: 'Give me a summary of the content pipeline: how many items are at each stage, what needs attention, and what was published recently.',
  },
  {
    label: 'Jobs today',
    description: 'Review recent scheduler activity.',
    prompt: 'What jobs ran today, and did any fail?',
  },
  {
    label: 'What needs review?',
    description: 'See articles waiting for human approval.',
    prompt: 'Which articles are currently waiting for reviewer approval? List them with their draft headline.',
  },
  {
    label: 'Loaded models',
    description: 'Check which AI models are active.',
    prompt: 'What AI models are currently loaded and in use?',
  },
];

/** Configuration tabs that live in Settings, plus legacy operational route ids. */
export type SettingsTab = 'channels' | 'workers' | 'jobs' | 'config' | 'store' | 'health' | 'system' | 'actions' | `worker-settings:${string}`;

/**
 * Ordering of the primary nav group headings. Opaque to the shell — the names are
 * just strings; provider/worker manifests slot their tabs into these groups via
 * `menu.group`. The shell never reasons about what "Sites" or "Content" mean.
 */
export const CORE_MENU_GROUP_ORDER = ['Home', 'Assistant', 'Portfolio', 'Analysis', 'Desk internals', 'Pipeline', 'Workers', 'Operations'];

export const CORE_MENU_ENTRIES: Array<Omit<SidebarEntry<DashboardTab>, 'count'>> = [
  { id: 'overview', label: 'Home', icon: 'overview', group: 'Home', order: 10 },
  { id: 'chat', label: 'Assistant', icon: 'chat', group: 'Assistant', order: 10 },
  { id: 'health', label: 'Health', icon: 'health', group: 'Operations', order: 10 },
  { id: 'actions', label: 'Actions', icon: 'actions', group: 'Operations', order: 20 },
  { id: 'jobs', label: 'Jobs', icon: 'jobs', group: 'Operations', order: 30 },
  { id: 'system', label: 'System', icon: 'system', group: 'Operations', order: 40 },
  { id: 'channels', label: 'Channels', icon: 'channels', group: 'Operations', order: 50 },
  { id: 'workers', label: 'Worker manager', icon: 'workers', group: 'Operations', order: 60 },
  { id: 'store', label: 'Worker store', icon: 'store', group: 'Operations', order: 70 },
];

export interface ModelOption {
  alias: string;
  id: string;
  label: string;
  provider: string;
  /** Vendor-declared reasoning levels, lightest first; absent when not selectable. */
  reasoningLevels?: string[];
}

export type ActionClass = 'read-only' | 'approved-write' | 'draft' | 'trusted-automation' | 'blocked';
export type ActionState = 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';

export interface ActionRequest {
  id: string;
  workerId: string;
  actionClass: ActionClass;
  label: string;
  rationale: string;
  payload: Record<string, unknown>;
  preview: string | null;
  state: ActionState;
  createdAt: string;
  decidedAt: string | null;
  executedAt: string | null;
}

export interface SchedulerJobState {
  name: string;
  label: string;
  description: string;
  workerId: string;
  workerName: string;
  workerBuiltIn: boolean;
  workerEnabled: boolean;
  approvalRequiredEditable: boolean;
  enabled: boolean;
  cron: string;
  nextScheduledAt: string | null;
  modelAlias: string;
  /** Reasoning level override for this job ('' = follow the platform default). */
  reasoningLevel: string;
  approvalRequired: boolean;
  promptEditable: boolean;
  promptHelpText?: string;
  promptExamples?: Array<{ label: string; description: string; value: string }>;
  prompt: string;
  params?: Record<string, unknown>;
  dashboardFields: JobDashboardField[];
  presets: JobPreset[];
  effectiveModelAlias: string;
  /** Level the next run will actually use ('' when the effective model has no levels). */
  effectiveReasoningLevel: string;
  queued: boolean;
  queuedAt: string | null;
  running: boolean;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastStatus: RunStatus;
  lastSummary: string | null;
  lastError: string | null;
  lastTrigger: 'schedule' | 'manual' | 'pipeline' | 'event' | null;
  consecutiveErrors?: number;
}

export interface JobPreset {
  id: string;
  label: string;
  description: string;
  cron?: string;
  params?: Record<string, unknown>;
}

export type JobDashboardField =
  | JobTextField
  | JobTextareaField
  | JobNumberField
  | JobBooleanField
  | JobSelectField
  | JobStringListField
  | JobSecretReferenceField
  | JobModelAliasField
  | JobActionField;

export interface JobBaseField {
  key: string;
  label: string;
  group?: string;
  helpText?: string;
  /**
   * Dotted path into workerData that seeds the form draft with the current runtime
   * value. Falls back to `defaultValue` when the path resolves to undefined.
   */
  seedPath?: string;
  /** Hide this field unless another field in the same form matches the given condition. */
  visibleWhen?: JobFieldCondition;
}

export interface JobTextField extends JobBaseField {
  type: 'text';
  defaultValue: string;
  placeholder?: string;
}

export interface JobTextareaField extends JobBaseField {
  type: 'textarea';
  defaultValue: string;
  rows?: number;
  placeholder?: string;
}

export interface JobNumberField extends JobBaseField {
  type: 'number';
  defaultValue: number;
  min?: number;
  max?: number;
  step?: number;
}

export interface JobBooleanField extends JobBaseField {
  type: 'boolean';
  defaultValue: boolean;
}

export interface JobSelectField extends JobBaseField {
  type: 'select';
  defaultValue: string;
  options: Array<{ label: string; value: string }>;
  /** When true, the renderer replaces `options` with `fieldSuggestions[key]` from the worker data slice. */
  dynamicOptions?: boolean;
}

export interface JobStringListField extends JobBaseField {
  type: 'string-list';
  defaultValue: string[];
  rows?: number;
  suggestions?: string[];
  placeholder?: string;
}

export interface JobSecretReferenceField extends JobBaseField {
  type: 'secret-reference';
  defaultValue: string;
  placeholder?: string;
}

export interface JobModelAliasField extends JobBaseField {
  type: 'model-alias';
  defaultValue: string;
  targetJob: string;
}

export interface JobActionField extends JobBaseField {
  type: 'action';
  actionPath: string;
  method?: 'POST' | 'GET';
  buttonLabel?: string;
  openInPopup?: boolean;
  enabledWhen?: JobFieldCondition;
  disabled?: boolean;
  disabledReason?: string;
}

export interface JobFieldCondition {
  field: string;
  equals: string;
}

export interface SchedulerRunRecord {
  id: string;
  job: string;
  label: string;
  trigger: 'schedule' | 'manual' | 'pipeline' | 'event';
  modelAlias: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'success' | 'error' | 'skipped';
  summary: string | null;
  error: string | null;
  itemCount: number | null;
  skipReason?: 'missed' | 'overlap' | 'no_work' | null;
  /** Consecutive slots a missed record stands for — one record is kept per job. */
  missedSlotCount?: number;
  attempts: SchedulerRunAttempt[];
}

export interface SchedulerRunAttempt {
  attempt: number;
  startedAt: string;
  finishedAt: string;
  status: 'success' | 'error' | 'skipped';
  summary?: string | null;
  error?: string | null;
  itemCount?: number | null;
  nextDelayMs?: number;
}

export interface WorkerJobSummary {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  running: boolean;
  lastStatus: RunStatus;
}

export type WorkerHealthState = 'healthy' | 'degraded' | 'missing_credentials' | 'missing_dependency' | 'disabled';

export interface WorkerHealthRequirementStatus {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
  required: boolean;
  kind: 'credential' | 'dependency';
  settingsTarget?: string;
}

export type WorkerKind = 'feature' | 'channel' | 'provider';

export interface WorkerProviderSummary {
  id: string;
  label: string;
  description: string;
  capabilities: {
    chat: boolean;
    embeddings: boolean;
    vision: boolean;
    localRuntime: boolean;
  };
}

export interface PlatformSettings {
  activeLocalProviderId: string;
  primaryChannelId: string;
  embeddingProvider: string;
  embeddingModel: string;
  adminPasswordSet: boolean;
  localWorkerCodeEnabled: boolean;
  adminSessionTtlHours: number;
  jobLlmTimeoutMs: number;
  automaticMissedRunRecovery: boolean;
  adminHost: string;
  adminPort: number;
}

export interface RegisteredPlatformEntry {
  id: string;
  label: string;
  workerId: string;
  workerName: string;
}

export interface WorkerSummary {
  id: string;
  name: string;
  displayName?: string;
  version: string;
  description: string;
  tagline?: string;
  chatPrompts: ChatPromptExample[];
  onboarding?: WorkerOnboardingAction;
  /** Optional worker-owned banner, rendered without core knowing the worker id. */
  demoNotice?: string;
  builtIn: boolean;
  /** True when the built-in worker can be soft-deleted and later restored from the store. */
  deletable?: boolean;
  kind: WorkerKind;
  /** True when this worker can refresh externally-held portfolio data (e.g. a brokerage sync). */
  portfolioSource?: boolean;
  section?: 'workers' | 'system';
  menuOrder?: number;
  settingsOnly?: boolean;
  enabled: boolean;
  missing: boolean;
  sourcePath?: string;
  hasDashboardBundle?: boolean;
  healthState: WorkerHealthState;
  healthDetail: string;
  jobCount: number;
  enabledJobCount: number;
  runningJobCount: number;
  health: WorkerHealthRequirementStatus[];
  ownedSettings: WorkerOwnedSetting[];
  dashboard: WorkerDashboardManifest;
  providers: WorkerProviderSummary[];
  jobs: WorkerJobSummary[];
}

export interface WorkerTabDefinition {
  id: `worker:${string}`;
  worker: WorkerSummary;
  definition: WorkerDashboardViewDefinition;
}

export interface WorkerOwnedSetting {
  key: string;
  label: string;
  description: string;
  scope: 'job' | 'worker' | 'global';
  storageKey: string;
  dashboardTarget?: string;
}

export interface WorkerDashboardManifest {
  settings: WorkerDashboardSurface[];
  routes: WorkerDashboardSurface[];
}

export interface WorkerDashboardSurface {
  id: string;
  label: string;
  description: string;
  path?: string;
  tab?: string;
  fieldGroups?: WorkerDashboardFieldGroup[];
  fields?: JobDashboardField[];
}

export interface WorkerDashboardFieldGroup {
  id: string;
  label: string;
  description?: string;
}

export interface WorkerLoadIssue {
  sourcePath: string;
  message: string;
}

export interface QueueItem {
  id: string;
  title: string;
  shortDesc: string;
  url: string;
  addedAt: string;
  state: 'seen' | 'rejected' | 'queued' | 'approved' | 'posted' | 'failed';
  stateChangedAt: string;
  stateReason?: string;
  selectionReason?: string;
  rejectionReason?: string;
  postedAt?: string;
  attemptCount?: number;
  lastAttemptAt?: string;
  lastError?: string;
  producerWorkerId?: string;
  itemType?: string;
  tags?: string[];
  payload?: Record<string, any>;
  metadata?: Record<string, Record<string, any>>;
}

export interface HealthStatus {
  ok: boolean;
  detail: string;
  label?: string;
  action?: {
    label: string;
    method: 'POST';
    path: string;
    successMessage: string;
  };
}

export interface EventLogRecord {
  id: string;
  createdAt: string;
  category: string;
  action: string;
  severity: 'info' | 'warning' | 'error';
  summary: string;
  metadata: Record<string, unknown>;
}

export interface AppBackupRecord {
  file: string;
  path: string;
  createdAt: string;
  sizeBytes: number;
  restorePending?: boolean;
}

export interface AutoBackupSettings {
  enabled: boolean;
  retentionDays: number;
}

export interface WhatsNewEntry {
  version: string;
  date: string;
  headline: string;
  items: string[];
}

export interface SourceQualityRules {
  minScore: number;
  allowHosts: string[];
  blockHosts: string[];
  preferredHosts: string[];
  lowQualityHosts: string[];
}

export interface AuthSession {
  authenticated: boolean;
  authEnabled: boolean;
}

// Per-worker job metrics (Health tab)
export interface JobRunMetrics {
  jobName: string;
  jobLabel: string;
  workerId: string;
  totalRuns: number;
  successCount: number;
  errorCount: number;
  skippedCount: number;
  successRate: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  avgItemCount: number | null;
  lastFailureReason: string | null;
  recentStatuses: Array<'success' | 'error' | 'skipped'>;
}

export interface WorkerRunMetrics {
  workerId: string;
  workerName: string;
  totalRuns: number;
  successRate: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  lastFailureReason: string | null;
  jobs: JobRunMetrics[];
}

export interface JobMetricsResponse {
  workers: WorkerRunMetrics[];
  windowRuns: number;
  computedAt: string;
}

export type DashboardSectionName = 'queue' | 'cronRuns' | 'events' | 'backups' | 'workerData' | 'localRuntimeModels' | 'pipelineStages';

/**
 * One block in the dashboard's live pipeline-stage strip. Derived generically from any
 * registered job that declares `pendingCount` + `pipelineStageOrder` on its manifest — the
 * frontend has no knowledge of which specific workers these are.
 */
export interface PipelineStageSummary {
  jobId: string;
  workerId: string;
  workerDisplayName: string;
  jobLabel: string;
  pendingCount: number;
  order: number;
  /** True while this stage's job is executing — the platform's only in-flight signal. */
  running: boolean;
  /** True while the job is waiting for its turn on the scheduler's FIFO chain. */
  queued: boolean;
  /** ISO start time of the current run, when `running`. */
  startedAt: string | null;
}

export interface RecipeInputStorage {
  type: 'worker-kv' | 'global-kv-array';
  workerId?: string;
  kvKey: string;
  kvField?: string;
  arrayField?: string;
}

export interface WorkerRecipeInput {
  key: string;
  label: string;
  helpText?: string;
  inputType?: 'text' | 'password';
  storage: RecipeInputStorage;
}

export interface WorkerRecipeStep {
  workerId: string;
}

export interface WorkerRecipe {
  id: string;
  label: string;
  description: string;
  steps: WorkerRecipeStep[];
  requiredInputs?: WorkerRecipeInput[];
  platformSettings?: { primaryChannelId?: string };
}

export interface DashboardState {
  app: {
    name: string;
    adminUrl: string;
    timezone: string;
    now: string;
    pid: number;
  };
  models: ModelOption[];
  defaultModel: ModelOption;
  /** Platform-wide reasoning level used when a job has no per-job override. */
  defaultReasoningLevel: string;
  localRuntime: {
    running: boolean;
    loadedModels: string[];
    loadedCount: number;
    pinnedModelId: string | null;
  };
  cron: {
    timezone: string;
    jobs: SchedulerJobState[];
    runs: SchedulerRunRecord[];
  };
  workers: WorkerSummary[];
  workerIssues: WorkerLoadIssue[];
  platform: PlatformSettings;
  availableLocalProviders: RegisteredPlatformEntry[];
  availableChannels: RegisteredPlatformEntry[];
  queue: {
    total: number;
    queued: number;
    approved: number;
    posted: number;
    rejected: number;
    failed: number;
    seen: number;
    retrying: number;
    recentItems: QueueItem[];
  };
  // Open-ended map: each entry is a health row contributed by a worker's
  // requiredCredentials/optionalCredentials, or by a small set of core-owned
  // checks (cloud LLM providers, allowed-user gate). Don't add hardcoded keys
  // here — read what the backend sends and let workers declare their own.
  integrations: Record<string, HealthStatus>;
  dependencies: Record<string, HealthStatus>;
  events: EventLogRecord[];
  backups: AppBackupRecord[];
  recipes: WorkerRecipe[];
  workerData: Record<string, unknown>;
  pipelineStages: PipelineStageSummary[];
  /**
   * Active-scope summary (generic multisite primitive). `providerWorkerId` is whichever
   * worker declared `scopeProvider`; `activeScopeId` is the opaque selected scope. The
   * option list lives in that worker's `workerData` slice.
   */
  scope?: { providerWorkerId: string | null; activeScopeId: string | null };
  [key: string]: unknown;
}

export type JobParamDraftValue = string | number | boolean;

export interface JobDraft {
  enabled: boolean;
  cron: string;
  modelAlias: string;
  approvalRequired: boolean;
  prompt: string;
  params: Record<string, JobParamDraftValue>;
}

export interface ArtifactVersion {
  content: string;
  messageId: string;
  createdAt: string;
}

export interface ChatArtifact {
  id: string;
  conversationId: string;
  messageId: string;
  identifier: string;
  type: string;
  title: string;
  content: string;
  versions: ArtifactVersion[];
  createdAt: string;
  updatedAt: string;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
}

export interface ChatThread {
  conversationId: string;
  chatId: number;
  channel: string;
  title: string;
  createdAt: string;
  lastMessageAt: string;
  projectId?: string | null;
}

export interface ChatProject {
  projectId: string;
  name: string;
  createdAt: string;
}
