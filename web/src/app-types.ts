// Shared frontend types + module-level constants, extracted from App.tsx so the
// core shell and (incrementally) per-tab modules import them instead of nesting
// them in one 7k-line file. (CODE_ROADMAP Phase 1.2)
import type { SidebarEntry } from './Sidebar';
import type { WorkerDashboardViewDefinition } from './workers/types';

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
export type QueueFilter = 'all' | QueueItem['state'] | 'retrying';
export type CoreConfigKey = 'platform-routing' | 'embedding-model' | 'platform-security';

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
  priority?: number;
}

export interface ChatPromptButton extends ChatPromptExample {
  id: string;
  source?: string;
}

export const CORE_CHAT_PROMPTS: ChatPromptExample[] = [
  {
    label: 'Jobs today',
    description: 'Review recent scheduler activity.',
    prompt: 'What jobs ran today?',
  },
  {
    label: 'Recent queue',
    description: 'Inspect the newest Item Bus entries.',
    prompt: 'Show me recent items in the queue.',
  },
  {
    label: 'Loaded models',
    description: 'Check active and loaded AI models.',
    prompt: 'What models are loaded?',
  },
  {
    label: 'Recent failures',
    description: 'Find jobs or workers that need attention.',
    prompt: 'Did any jobs fail recently?',
  },
];

export const CORE_MENU_ENTRIES: Array<Omit<SidebarEntry<DashboardTab>, 'count'>> = [
  { id: 'overview', label: 'Overview', icon: 'overview', group: 'Workspace', order: 10 },
  { id: 'pipeline', label: 'Pipeline', icon: 'pipeline', group: 'Workspace', order: 12 },
  { id: 'channels', label: 'Channels', icon: 'channels', group: 'Workspace', order: 15 },
  { id: 'jobs', label: 'Jobs', icon: 'jobs', group: 'Workspace', order: 20 },
  { id: 'workers', label: 'Workers', icon: 'workers', group: 'Workspace', order: 30 },
  { id: 'store', label: 'Store', icon: 'store', group: 'Workspace', order: 35 },
  { id: 'config', label: 'Config', icon: 'config', group: 'Workspace', order: 40 },
  { id: 'health', label: 'Health', icon: 'health', group: 'System', order: 3 },
  { id: 'actions', label: 'Actions', icon: 'actions', group: 'System', order: 5 },
  { id: 'chat', label: 'Chat', icon: 'chat', group: 'System', order: 10 },
  { id: 'system', label: 'System', icon: 'system', group: 'System', order: 20 },
];

export interface ModelOption {
  alias: string;
  id: string;
  label: string;
  provider: string;
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
  modelAlias: string;
  approvalRequired: boolean;
  promptEditable: boolean;
  promptHelpText?: string;
  promptExamples?: Array<{ label: string; description: string; value: string }>;
  prompt: string;
  params?: Record<string, unknown>;
  dashboardFields: JobDashboardField[];
  presets: JobPreset[];
  effectiveModelAlias: string;
  running: boolean;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastStatus: RunStatus;
  lastSummary: string | null;
  lastError: string | null;
  lastTrigger: 'schedule' | 'manual' | null;
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
  | JobSecretReferenceField;

export interface JobBaseField {
  key: string;
  label: string;
  helpText?: string;
  /**
   * Dotted path into workerData that seeds the form draft with the current runtime
   * value. Falls back to `defaultValue` when the path resolves to undefined.
   */
  seedPath?: string;
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

export interface SchedulerRunRecord {
  id: string;
  job: string;
  label: string;
  trigger: 'schedule' | 'manual';
  modelAlias: string;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'success' | 'error' | 'skipped';
  summary: string | null;
  error: string | null;
  itemCount: number | null;
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

export interface PlatformSettings {
  activeLocalProviderId: string;
  primaryChannelId: string;
  embeddingProvider: string;
  embeddingModel: string;
  adminPasswordSet: boolean;
  localWorkerCodeEnabled: boolean;
  adminSessionTtlHours: number;
  jobLlmTimeoutMs: number;
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
  demoNotice?: string;
  builtIn: boolean;
  /** True when the built-in worker can be soft-deleted and later restored from the store. */
  deletable?: boolean;
  kind: WorkerKind;
  section?: 'workers' | 'system';
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
  fields?: JobDashboardField[];
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

// Plain-language labels and descriptions for each store-level permission category.
// Mirrors PERMISSION_INFO in BFrost-Website (kept in sync by scripts/check-manifest-enums.js).
export const PERMISSION_INFO: Record<string, { label: string; description: string }> = {
  'network:http': {
    label: 'HTTP network access',
    description: 'Can make outbound HTTP requests (unencrypted). Only needed for local or legacy endpoints.',
  },
  'network:https': {
    label: 'HTTPS network access',
    description: 'Can make outbound HTTPS requests to the internet.',
  },
  'storage:worker-kv': {
    label: 'Worker key-value storage',
    description: 'Can read and write its own namespaced key-value store inside BFrost.',
  },
  'filesystem:scoped-read': {
    label: 'Scoped filesystem read',
    description: 'Can read files within a specific folder you approve at install time.',
  },
  'filesystem:scoped-write': {
    label: 'Scoped filesystem write',
    description: 'Can create or modify files within a specific folder you approve at install time.',
  },
  'filesystem:workspace-read': {
    label: 'Workspace filesystem read',
    description: 'Can read any file in the configured workspace directory.',
  },
  'operator-notify': {
    label: 'Operator notifications',
    description: 'Can send you notifications via configured channels (e.g. Telegram).',
  },
  'local-process': {
    label: 'Local process execution',
    description: 'Can spawn shell commands or subprocesses on this machine.',
  },
};

// Community store types (mirrors api.bfrost.net schema)
export interface StoreWorkerListing {
  id: string;
  name: string;
  tagline: string;
  author: string;
  category: string;
  tags: string[];
  trust: string;
  latestVersion: string;
  bfrostEngine: string;
  permissions: string[];
  capabilities: {
    jobs: string[];
    tools: string[];
    channels: string[];
    providers: string[];
    itemProduces: string[];
    itemConsumes: string[];
  };
  downloadCount: number;
  updatedAt: string;
  /** True for workers that ship with BFrost. Infrastructure workers are always included;
   *  plugin workers (news, publisher-x, research) can be deleted and restored. */
  builtIn?: boolean;
}

export interface StoreWorkerVersion {
  version: string;
  bfrostEngine: string;
  releaseUrl?: string;
  bundleUrl?: string;
  bundleSha256?: string;
  bundleSizeBytes?: number;
  changelog?: string;
  publishedAt: string;
  yanked: boolean;
  yankReason?: string;
}

export interface StoreWorkerDetail extends StoreWorkerListing {
  description: string;
  repoUrl: string;
  readmeUrl?: string;
  license: string;
  versions: StoreWorkerVersion[];
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

export type DashboardSectionName = 'queue' | 'cronRuns' | 'events' | 'backups' | 'workerData' | 'lmStudioModels';

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
  lmStudio: {
    running: boolean;
    loadedModels: string[];
    loadedCount: number;
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
  dependencies: {
    lmStudioCli: HealthStatus;
    ffmpeg: HealthStatus;
    whisperCli: HealthStatus;
    whisperModel: HealthStatus;
    sqliteCli: HealthStatus;
    embeddingModelReachable: HealthStatus;
  };
  events: EventLogRecord[];
  backups: AppBackupRecord[];
  recipes: WorkerRecipe[];
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

