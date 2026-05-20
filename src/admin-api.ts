import { z } from 'zod';
import { QueueItemSchema } from './jobs/queue';

export const AdminLoginBodySchema = z.object({
  password: z.string().min(1),
}).strict();

export const DefaultModelBodySchema = z.object({
  alias: z.string().min(1),
}).strict();

export const CloudApiKeysBodySchema = z.object({
  openaiApiKey: z.string().optional(),
  anthropicApiKey: z.string().optional(),
}).strict();

export const PlatformSettingsBodySchema = z.object({
  activeLocalProviderId: z.string().optional(),
  primaryChannelId: z.string().optional(),
}).strict();

export const EmbeddingSettingsBodySchema = z.object({
  provider: z.enum(['local', 'openai']).optional(),
  model: z.string().min(1).optional(),
}).strict();

export const PlatformSettingsSchema = z.object({
  activeLocalProviderId: z.string(),
  primaryChannelId: z.string(),
  embeddingProvider: z.enum(['local', 'openai']),
  embeddingModel: z.string(),
}).strict();

export const RegisteredPlatformEntrySchema = z.object({
  id: z.string(),
  label: z.string(),
  workerId: z.string(),
  workerName: z.string(),
}).strict();

export const XCredentialsBodySchema = z.object({
  xConsumerKey: z.string().optional(),
  xConsumerSecret: z.string().optional(),
  xAccessToken: z.string().optional(),
  xAccessTokenSecret: z.string().optional(),
  xUsername: z.string().optional(),
}).strict();

export const CronJobUpdateBodySchema = z.object({
  enabled: z.boolean().optional(),
  cron: z.string().optional(),
  modelAlias: z.string().optional(),
  approvalRequired: z.boolean().optional(),
  prompt: z.string().optional(),
  params: z.record(z.unknown()).optional(),
}).strict();

export const QueueItemActionBodySchema = z.object({
  id: z.string().min(1),
  action: z.enum(['approve', 'reject']),
}).strict();

export const SourceQualityRulesSchema = z.object({
  minScore: z.number().int(),
  allowHosts: z.array(z.string()),
  blockHosts: z.array(z.string()),
  preferredHosts: z.array(z.string()),
  lowQualityHosts: z.array(z.string()),
}).strict();

export const LmStudioActionBodySchema = z.object({
  action: z.enum(['start', 'stop', 'load-default', 'unload-default', 'unload-all', 'pin-load', 'pin-unload']),
  alias: z.string().min(1).optional(),
}).strict();

export const ChatMessageBodySchema = z.object({
  message: z.string().min(1).max(8000),
  conversationId: z.string().min(1).max(120).optional(),
}).strict();

export const WorkerUpdateBodySchema = z.object({
  enabled: z.boolean(),
}).strict();

export const ModelOptionSchema = z.object({
  alias: z.string(),
  id: z.string(),
  label: z.string(),
  provider: z.string(),
}).strict();

export const RunStatusSchema = z.enum(['idle', 'success', 'error', 'skipped']);

export const JobDashboardFieldSchema = z.discriminatedUnion('type', [
  z.object({
    key: z.string(),
    label: z.string(),
    type: z.literal('text'),
    defaultValue: z.string(),
    helpText: z.string().optional(),
    seedPath: z.string().optional(),
  }).strict(),
  z.object({
    key: z.string(),
    label: z.string(),
    type: z.literal('textarea'),
    defaultValue: z.string(),
    rows: z.number().optional(),
    helpText: z.string().optional(),
    seedPath: z.string().optional(),
  }).strict(),
  z.object({
    key: z.string(),
    label: z.string(),
    type: z.literal('number'),
    defaultValue: z.number(),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().optional(),
    helpText: z.string().optional(),
    seedPath: z.string().optional(),
  }).strict(),
  z.object({
    key: z.string(),
    label: z.string(),
    type: z.literal('boolean'),
    defaultValue: z.boolean(),
    helpText: z.string().optional(),
    seedPath: z.string().optional(),
  }).strict(),
  z.object({
    key: z.string(),
    label: z.string(),
    type: z.literal('select'),
    defaultValue: z.string(),
    options: z.array(z.object({
      label: z.string(),
      value: z.string(),
    }).strict()),
    helpText: z.string().optional(),
    seedPath: z.string().optional(),
  }).strict(),
  z.object({
    key: z.string(),
    label: z.string(),
    type: z.literal('string-list'),
    defaultValue: z.array(z.string()),
    rows: z.number().optional(),
    suggestions: z.array(z.string()).optional(),
    placeholder: z.string().optional(),
    helpText: z.string().optional(),
    seedPath: z.string().optional(),
  }).strict(),
  z.object({
    key: z.string(),
    label: z.string(),
    type: z.literal('secret-reference'),
    defaultValue: z.string(),
    placeholder: z.string().optional(),
    helpText: z.string().optional(),
    seedPath: z.string().optional(),
  }).strict(),
]);

export const SchedulerJobStateSchema = z.object({
  name: z.string(),
  label: z.string(),
  description: z.string(),
  workerId: z.string(),
  workerName: z.string(),
  workerBuiltIn: z.boolean(),
  workerEnabled: z.boolean(),
  approvalRequiredEditable: z.boolean(),
  enabled: z.boolean(),
  cron: z.string(),
  modelAlias: z.string(),
  approvalRequired: z.boolean(),
  promptEditable: z.boolean(),
  promptHelpText: z.string().optional(),
  prompt: z.string(),
  params: z.record(z.unknown()).optional(),
  dashboardFields: z.array(JobDashboardFieldSchema),
  presets: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      description: z.string(),
      cron: z.string().optional(),
      params: z.record(z.unknown()).optional(),
    }).strict(),
  ),
  effectiveModelAlias: z.string(),
  running: z.boolean(),
  lastStartedAt: z.string().nullable(),
  lastFinishedAt: z.string().nullable(),
  lastStatus: RunStatusSchema,
  lastSummary: z.string().nullable(),
  lastError: z.string().nullable(),
  lastTrigger: z.enum(['schedule', 'manual']).nullable(),
}).strict();

export const SchedulerRunRecordSchema = z.object({
  id: z.string(),
  job: z.string(),
  label: z.string(),
  trigger: z.enum(['schedule', 'manual']),
  modelAlias: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  status: z.enum(['running', 'success', 'error', 'skipped']),
  summary: z.string().nullable(),
  error: z.string().nullable(),
  itemCount: z.number().nullable(),
}).strict();

export const WorkerJobSummarySchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  running: z.boolean(),
  lastStatus: RunStatusSchema,
}).strict();

export const WorkerHealthStateSchema = z.enum([
  'healthy',
  'degraded',
  'missing_credentials',
  'missing_dependency',
  'disabled',
]);

export const WorkerHealthRequirementStatusSchema = z.object({
  key: z.string(),
  label: z.string(),
  ok: z.boolean(),
  detail: z.string(),
  required: z.boolean(),
  kind: z.enum(['credential', 'dependency']),
  settingsTarget: z.string().optional(),
}).strict();

export const WorkerOwnedSettingSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string(),
  scope: z.enum(['job', 'worker', 'global']),
  storageKey: z.string(),
  dashboardTarget: z.string().optional(),
}).strict();

export const WorkerDashboardSurfaceSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  path: z.string().optional(),
  tab: z.string().optional(),
  fields: z.array(JobDashboardFieldSchema).optional(),
}).strict();

export const WorkerDashboardManifestSchema = z.object({
  settings: z.array(WorkerDashboardSurfaceSchema),
  routes: z.array(WorkerDashboardSurfaceSchema),
}).strict();

export const WorkerSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string().optional(),
  version: z.string(),
  description: z.string(),
  tagline: z.string().optional(),
  builtIn: z.boolean(),
  kind: z.enum(['feature', 'channel', 'provider']),
  enabled: z.boolean(),
  missing: z.boolean(),
  sourcePath: z.string().optional(),
  hasDashboardBundle: z.boolean().optional(),
  healthState: WorkerHealthStateSchema,
  healthDetail: z.string(),
  jobCount: z.number(),
  enabledJobCount: z.number(),
  runningJobCount: z.number(),
  health: z.array(WorkerHealthRequirementStatusSchema),
  ownedSettings: z.array(WorkerOwnedSettingSchema),
  dashboard: WorkerDashboardManifestSchema,
  jobs: z.array(WorkerJobSummarySchema),
}).strict();

export const WorkerLoadIssueSchema = z.object({
  sourcePath: z.string(),
  message: z.string(),
}).strict();

export const QueueRunSchema = z.object({
  file: z.string(),
  ranAt: z.string(),
  fetchedCount: z.number(),
  candidateCount: z.number().optional(),
  articleFetchSuccessCount: z.number(),
  articleFetchFailureCount: z.number(),
  sourceQualifiedCount: z.number(),
  allowlistedCount: z.number(),
  blockedSourceCount: z.number(),
  lowScoreRejectedCount: z.number(),
  queuedCount: z.number(),
  rejectedCount: z.number(),
  seenCount: z.number(),
  duplicateUrlCount: z.number().optional(),
  duplicateTitleCount: z.number().optional(),
  nearDuplicateCount: z.number(),
  droppedHallucinated: z.number().optional(),
  undecidedCount: z.number().optional(),
}).strict();

export const QueueDashboardSchema = z.object({
  total: z.number(),
  queued: z.number(),
  approved: z.number(),
  posted: z.number(),
  rejected: z.number(),
  failed: z.number(),
  seen: z.number(),
  retrying: z.number(),
  recentItems: z.array(QueueItemSchema),
}).strict();

export const HealthStatusSchema = z.object({
  ok: z.boolean(),
  detail: z.string(),
}).strict();

export const EventLogRecordSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  category: z.string(),
  action: z.string(),
  severity: z.enum(['info', 'warning', 'error']),
  summary: z.string(),
  metadata: z.record(z.unknown()),
}).strict();

export const AppBackupRecordSchema = z.object({
  file: z.string(),
  path: z.string(),
  createdAt: z.string(),
  sizeBytes: z.number(),
}).strict();

// Heavy sections (queue, cron runs, events, backups, worker data, loaded LM Studio
// models, research slice, source rules) are fetched lazily by per-tab endpoints. The
// shell response below carries everything needed to render the tab bar + overview at
// console open time; tabs request their slice when the user navigates to them.
export const DashboardStateSchema = z.object({
  app: z.object({
    name: z.string(),
    adminUrl: z.string(),
    timezone: z.string(),
    now: z.string(),
    pid: z.number(),
  }).strict(),
  models: z.array(ModelOptionSchema),
  defaultModel: ModelOptionSchema,
  lmStudio: z.object({
    running: z.boolean(),
    loadedModels: z.array(z.string()).optional(),
    loadedCount: z.number(),
    pinnedModelId: z.string().nullable(),
  }).strict(),
  cron: z.object({
    timezone: z.string(),
    jobs: z.array(SchedulerJobStateSchema),
    runs: z.array(SchedulerRunRecordSchema).optional(),
  }).strict(),
  workers: z.array(WorkerSummarySchema),
  workerIssues: z.array(WorkerLoadIssueSchema),
  platform: PlatformSettingsSchema,
  availableLocalProviders: z.array(RegisteredPlatformEntrySchema),
  availableChannels: z.array(RegisteredPlatformEntrySchema),
  queue: QueueDashboardSchema.optional(),
  integrations: z.record(HealthStatusSchema),
  dependencies: z.object({
    lmStudioCli: HealthStatusSchema,
    ffmpeg: HealthStatusSchema,
    whisperCli: HealthStatusSchema,
    whisperModel: HealthStatusSchema,
    sqliteCli: HealthStatusSchema,
    embeddingModelReachable: HealthStatusSchema,
  }).strict(),
  events: z.array(EventLogRecordSchema).optional(),
  backups: z.array(AppBackupRecordSchema).optional(),
  workerData: z.record(z.unknown()).default({}),
}).passthrough();

// Per-section schemas. Each section endpoint returns one of these so the frontend can
// merge slices into its in-memory dashboard state.
export const QueueSectionSchema = z.object({
  queue: QueueDashboardSchema,
}).strict();

export const CronRunsSectionSchema = z.object({
  runs: z.array(SchedulerRunRecordSchema),
}).strict();

export const EventsSectionSchema = z.object({
  events: z.array(EventLogRecordSchema),
}).strict();

export const BackupsSectionSchema = z.object({
  backups: z.array(AppBackupRecordSchema),
}).strict();

export const WorkerDataSectionSchema = z.object({
  workerData: z.record(z.unknown()),
}).strict();

export const LmStudioModelsSectionSchema = z.object({
  loadedModels: z.array(z.string()),
}).strict();

export const LocalEmbeddingModelsSectionSchema = z.object({
  models: z.array(z.object({ id: z.string(), label: z.string() }).strict()),
}).strict();

export type LocalEmbeddingModelsSection = z.infer<typeof LocalEmbeddingModelsSectionSchema>;

export type QueueSection = z.infer<typeof QueueSectionSchema>;
export type CronRunsSection = z.infer<typeof CronRunsSectionSchema>;
export type EventsSection = z.infer<typeof EventsSectionSchema>;
export type BackupsSection = z.infer<typeof BackupsSectionSchema>;
export type WorkerDataSection = z.infer<typeof WorkerDataSectionSchema>;
export type LmStudioModelsSection = z.infer<typeof LmStudioModelsSectionSchema>;

export type DashboardState = z.infer<typeof DashboardStateSchema>;
