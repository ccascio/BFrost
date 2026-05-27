import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Sidebar, type SidebarEntry } from './Sidebar';
import { TopBar } from './TopBar';
import { Markdown } from './Markdown';
import { loadRuntimeWorkerBundle, workerQueueItemDetails, useWorkerDashboardViews } from './workers/registry';
import type { WorkerDashboardViewDefinition } from './workers/types';
import { Wizard } from './Wizard';

type RunStatus = 'idle' | 'success' | 'error' | 'skipped';
type CoreDashboardTab = 'overview' | 'channels' | 'workers' | 'jobs' | 'config' | 'chat' | 'system' | 'store' | 'actions' | 'health';

interface AppError {
  friendly: string;
  /** Raw technical message — shown under 'Details' toggle and included in the diagnostic bundle. */
  detail?: string;
}

/** Map a raw caught error to a user-facing AppError. */
function toAppError(raw: unknown): AppError {
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
type DashboardTab = CoreDashboardTab | `worker:${string}`;
type QueueFilter = 'all' | QueueItem['state'] | 'retrying';
type CoreConfigKey = 'cloud-api-keys' | 'platform-routing' | 'embedding-model';

const DASHBOARD_REFRESH_INTERVAL_MS = 30000;
const JOBS_REFRESH_INTERVAL_MS = 5000;

const CHAT_WELCOME = (
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
    <ul className="chat-empty-prompts footnote">
      <li>"What jobs ran today?"</li>
      <li>"Show me recent items in the queue."</li>
      <li>"What models are loaded?"</li>
      <li>"Did any jobs fail recently?"</li>
    </ul>
  </div>
);

const CORE_MENU_ENTRIES: Array<Omit<SidebarEntry<DashboardTab>, 'count'>> = [
  { id: 'overview', label: 'Overview', icon: 'overview', group: 'Workspace', order: 10 },
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

interface ModelOption {
  alias: string;
  id: string;
  label: string;
  provider: string;
}

type ActionClass = 'read-only' | 'approved-write' | 'draft' | 'trusted-automation' | 'blocked';
type ActionState = 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';

interface ActionRequest {
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

interface SchedulerJobState {
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

interface JobPreset {
  id: string;
  label: string;
  description: string;
  cron?: string;
  params?: Record<string, unknown>;
}

type JobDashboardField =
  | JobTextField
  | JobTextareaField
  | JobNumberField
  | JobBooleanField
  | JobSelectField
  | JobStringListField
  | JobSecretReferenceField;

interface JobBaseField {
  key: string;
  label: string;
  helpText?: string;
  /**
   * Dotted path into workerData that seeds the form draft with the current runtime
   * value. Falls back to `defaultValue` when the path resolves to undefined.
   */
  seedPath?: string;
}

interface JobTextField extends JobBaseField {
  type: 'text';
  defaultValue: string;
  placeholder?: string;
}

interface JobTextareaField extends JobBaseField {
  type: 'textarea';
  defaultValue: string;
  rows?: number;
  placeholder?: string;
}

interface JobNumberField extends JobBaseField {
  type: 'number';
  defaultValue: number;
  min?: number;
  max?: number;
  step?: number;
}

interface JobBooleanField extends JobBaseField {
  type: 'boolean';
  defaultValue: boolean;
}

interface JobSelectField extends JobBaseField {
  type: 'select';
  defaultValue: string;
  options: Array<{ label: string; value: string }>;
}

interface JobStringListField extends JobBaseField {
  type: 'string-list';
  defaultValue: string[];
  rows?: number;
  suggestions?: string[];
  placeholder?: string;
}

interface JobSecretReferenceField extends JobBaseField {
  type: 'secret-reference';
  defaultValue: string;
  placeholder?: string;
}

interface SchedulerRunRecord {
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

interface WorkerJobSummary {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  running: boolean;
  lastStatus: RunStatus;
}

type WorkerHealthState = 'healthy' | 'degraded' | 'missing_credentials' | 'missing_dependency' | 'disabled';

interface WorkerHealthRequirementStatus {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
  required: boolean;
  kind: 'credential' | 'dependency';
  settingsTarget?: string;
}

type WorkerKind = 'feature' | 'channel' | 'provider';

interface PlatformSettings {
  activeLocalProviderId: string;
  primaryChannelId: string;
  embeddingProvider: 'local' | 'openai';
  embeddingModel: string;
}

interface RegisteredPlatformEntry {
  id: string;
  label: string;
  workerId: string;
  workerName: string;
}

interface WorkerSummary {
  id: string;
  name: string;
  displayName?: string;
  version: string;
  description: string;
  builtIn: boolean;
  /** True when the built-in worker can be soft-deleted and later restored from the store. */
  deletable?: boolean;
  kind: WorkerKind;
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

interface WorkerTabDefinition {
  id: `worker:${string}`;
  worker: WorkerSummary;
  definition: WorkerDashboardViewDefinition;
}

interface WorkerOwnedSetting {
  key: string;
  label: string;
  description: string;
  scope: 'job' | 'worker' | 'global';
  storageKey: string;
  dashboardTarget?: string;
}

interface WorkerDashboardManifest {
  settings: WorkerDashboardSurface[];
  routes: WorkerDashboardSurface[];
}

interface WorkerDashboardSurface {
  id: string;
  label: string;
  description: string;
  path?: string;
  tab?: string;
  fields?: JobDashboardField[];
}

interface WorkerLoadIssue {
  sourcePath: string;
  message: string;
}

interface QueueItem {
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

interface HealthStatus {
  ok: boolean;
  detail: string;
}

interface EventLogRecord {
  id: string;
  createdAt: string;
  category: string;
  action: string;
  severity: 'info' | 'warning' | 'error';
  summary: string;
  metadata: Record<string, unknown>;
}

interface AppBackupRecord {
  file: string;
  path: string;
  createdAt: string;
  sizeBytes: number;
  restorePending?: boolean;
}

interface AutoBackupSettings {
  enabled: boolean;
  retentionDays: number;
}

// Community store types (mirrors api.bfrost.net schema)
interface StoreWorkerListing {
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

interface StoreWorkerVersion {
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

interface StoreWorkerDetail extends StoreWorkerListing {
  description: string;
  repoUrl: string;
  readmeUrl?: string;
  license: string;
  versions: StoreWorkerVersion[];
}

interface WhatsNewEntry {
  version: string;
  date: string;
  headline: string;
  items: string[];
}

interface SourceQualityRules {
  minScore: number;
  allowHosts: string[];
  blockHosts: string[];
  preferredHosts: string[];
  lowQualityHosts: string[];
}

interface AuthSession {
  authenticated: boolean;
  authEnabled: boolean;
}

// Per-worker job metrics (Health tab)
interface JobRunMetrics {
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

interface WorkerRunMetrics {
  workerId: string;
  workerName: string;
  totalRuns: number;
  successRate: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  lastFailureReason: string | null;
  jobs: JobRunMetrics[];
}

interface JobMetricsResponse {
  workers: WorkerRunMetrics[];
  windowRuns: number;
  computedAt: string;
}

type DashboardSectionName = 'queue' | 'cronRuns' | 'events' | 'backups' | 'workerData' | 'lmStudioModels';

interface DashboardState {
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
  [key: string]: unknown;
}

type JobParamDraftValue = string | number | boolean;

interface JobDraft {
  enabled: boolean;
  cron: string;
  modelAlias: string;
  approvalRequired: boolean;
  prompt: string;
  params: Record<string, JobParamDraftValue>;
}

interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
}

export default function App() {
  const [dashboard, setDashboard] = useState<DashboardState | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [selectedModelAlias, setSelectedModelAlias] = useState('');
  const [jobDrafts, setJobDrafts] = useState<Record<string, JobDraft>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [notice, setNotice] = useState<string>('Loading dashboard...');
  const [password, setPassword] = useState('');
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview');
  const [selectedJobName, setSelectedJobName] = useState<string | null>(null);
  const [selectedCoreConfigKey, setSelectedCoreConfigKey] = useState<CoreConfigKey | null>(null);
  const [selectedConfigJobName, setSelectedConfigJobName] = useState<string | null>(null);
  const [selectedConfigSurfaceKey, setSelectedConfigSurfaceKey] = useState<string | null>(null);
  const [surfaceDrafts, setSurfaceDrafts] = useState<Record<string, Record<string, JobParamDraftValue>>>({});
  const [openPromptEditors, setOpenPromptEditors] = useState<Record<string, boolean>>({});
  const [expandedChannelId, setExpandedChannelId] = useState<string | null>(null);
  const [customListItemDrafts, setCustomListItemDrafts] = useState<Record<string, string>>({});
  const [queueFilter, setQueueFilter] = useState<QueueFilter>('all');
  const [selectedQueueItemId, setSelectedQueueItemId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [chatDraft, setChatDraft] = useState('');
  const [chatTurns, setChatTurns] = useState<ChatTurn[]>([]);
  const chatLogRef = useRef<HTMLDivElement | null>(null);
  const [workerUploadFile, setWorkerUploadFile] = useState<File | null>(null);

  // Store tab state
  const [storeWorkers, setStoreWorkers] = useState<StoreWorkerListing[] | null>(null);
  const [storeLoading, setStoreLoading] = useState(false);
  const [storeError, setStoreError] = useState<string | null>(null);
  const [storeQuery, setStoreQuery] = useState('');
  const [storeQueryInput, setStoreQueryInput] = useState('');
  const [storeCategoryFilter, setStoreCategoryFilter] = useState('all');
  const [storeSelectedId, setStoreSelectedId] = useState<string | null>(null);
  const [storeDetail, setStoreDetail] = useState<StoreWorkerDetail | null>(null);
  const [storeDetailLoading, setStoreDetailLoading] = useState(false);
  const [sideloadFile, setSideloadFile] = useState<File | null>(null);
  // Map of workerId → latestVersion for workers with available updates
  const [storeUpdates, setStoreUpdates] = useState<Map<string, string>>(new Map());
  // Factory reset state
  const [resetChecks, setResetChecks] = useState({ wipeWorkerState: false, wipeCredentials: false, wipeBackups: false });
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  // In-product changelog
  const [whatsNew, setWhatsNew] = useState<WhatsNewEntry[] | null>(null);

  // Actions tab state
  const [pendingActions, setPendingActions] = useState<ActionRequest[]>([]);
  const [actionHistory, setActionHistory] = useState<ActionRequest[]>([]);
  const [actionsLoading, setActionsLoading] = useState(false);
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);

  // Health tab state
  const [jobMetrics, setJobMetrics] = useState<JobMetricsResponse | null>(null);
  const [jobMetricsLoading, setJobMetricsLoading] = useState(false);
  const [jobMetricsError, setJobMetricsError] = useState<string | null>(null);
  const [expandedWorkerIds, setExpandedWorkerIds] = useState<Set<string>>(new Set());

  // First-run wizard state
  const [wizardOpen, setWizardOpen] = useState(false);

  // Preview-before-save for schedule edits: holds job.name when awaiting confirmation
  const [confirmSaveJobName, setConfirmSaveJobName] = useState<string | null>(null);

  // Auto-backup settings state (system tab)
  const [autoBackupSettings, setAutoBackupSettings] = useState<AutoBackupSettings | null>(null);
  const [openaiApiKeyDraft, setOpenaiApiKeyDraft] = useState('');
  const [anthropicApiKeyDraft, setAnthropicApiKeyDraft] = useState('');
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [activeLocalProviderDraft, setActiveLocalProviderDraft] = useState('');
  const [primaryChannelDraft, setPrimaryChannelDraft] = useState('');
  const [embeddingProviderDraft, setEmbeddingProviderDraft] = useState<'local' | 'openai' | ''>('');
  const [embeddingModelDraft, setEmbeddingModelDraft] = useState('');
  const [localEmbeddingModels, setLocalEmbeddingModels] = useState<Array<{ id: string; label: string }> | null>(null);
  const [loadingEmbeddingModels, setLoadingEmbeddingModels] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('bfrost.sidebarCollapsed') === 'true';
  });

  useEffect(() => {
    window.localStorage.setItem('bfrost.sidebarCollapsed', String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    void initialize();
    const timer = window.setInterval(() => {
      // Skip the periodic refresh when the user is editing settings (Config tab) or
      // the browser tab is hidden. Polling /api/dashboard while someone is filling in
      // credential forms causes visible churn and serves no purpose.
      if (activeTabRef.current === 'config') return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (session?.authenticated || session?.authEnabled === false) {
        void fetchDashboard(true);
      } else {
        void refreshSession(false);
      }
    }, DASHBOARD_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [session?.authenticated, session?.authEnabled]);

  useEffect(() => {
    if (!dashboard || activeTab !== 'jobs') return;
    const timer = window.setInterval(() => {
      if (activeTabRef.current !== 'jobs') return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (session?.authenticated || session?.authEnabled === false) {
        void Promise.all([
          fetchSection('cronRuns', { force: true }),
          fetchSection('queue', { force: true }),
        ]);
      }
    }, JOBS_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [activeTab, dashboard !== null, session?.authenticated, session?.authEnabled]);

  useEffect(() => {
    if (!dashboard) return;
    // Pull in runtime dashboard bundles for any local worker that declares one. Each
    // bundle calls window.bfrost.registerDashboardView at top-level, which feeds the
    // view list via useWorkerDashboardViews(). Idempotent — we skip workers we've
    // already loaded for this session.
    for (const worker of dashboard.workers) {
      if (!worker.hasDashboardBundle || !worker.enabled || worker.missing) continue;
      if (loadedBundleWorkersRef.current.has(worker.id)) continue;
      loadedBundleWorkersRef.current.add(worker.id);
      void loadRuntimeWorkerBundle(worker.id);
    }
  }, [dashboard]);

  useEffect(() => {
    activeTabRef.current = activeTab;
    if (!dashboard) return;
    // Fetch sections required by the newly active tab. fetchSection no-ops when the
    // section is already loaded, so revisits are free.
    const sections = sectionsForTab(activeTab);
    for (const section of sections) {
      void fetchSection(section);
    }
  }, [activeTab, dashboard !== null]);

  useEffect(() => {
    const el = chatLogRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chatTurns.length, busyKey === 'dashboard-chat']);

  // Load store catalog when the Store tab is opened. Re-fetches when the search query changes.
  useEffect(() => {
    if (activeTab !== 'store') return;
    void fetchStoreCatalog(storeQuery);
  }, [activeTab, storeQuery]);

  // Poll for available updates once when the worker list first loads, then every 24 h.
  useEffect(() => {
    if (!dashboard) return;
    void fetchStoreUpdates(dashboard.workers);
    const timer = window.setInterval(() => {
      void fetchStoreUpdates(dashboard.workers);
    }, 24 * 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [dashboard !== null]);

  // Load "What's new" changelog when the System tab is opened.
  useEffect(() => {
    if (activeTab !== 'system' || whatsNew !== null) return;
    fetch('/whats-new.json')
      .then((r) => r.json())
      .then((data) => setWhatsNew(data as WhatsNewEntry[]))
      .catch(() => setWhatsNew([]));
  }, [activeTab, whatsNew]);

  // Load auto-backup settings when the System tab is opened.
  useEffect(() => {
    if (activeTab !== 'system' || autoBackupSettings !== null) return;
    void fetchAutoBackupSettings();
  }, [activeTab]);

  // Load job metrics when the Health tab is opened.
  // Note: no dashboard dependency — health metrics fetch independently.
  useEffect(() => {
    if (activeTab !== 'health') return;
    void fetchJobMetrics();
  }, [activeTab]);

  // Poll for pending actions + load history when on the Actions tab.
  useEffect(() => {
    if (activeTab !== 'actions') return;
    void fetchPendingActions();
    void fetchActionHistory();
    const timer = window.setInterval(() => void fetchPendingActions(), 3000);
    return () => window.clearInterval(timer);
  }, [activeTab]);

  async function refreshActiveTabSections(): Promise<void> {
    const sections = sectionsForTab(activeTabRef.current);
    await Promise.all(sections.map((section) => fetchSection(section, { force: true })));
  }

  // ── Store ──────────────────────────────────────────────────────────────────

  const STORE_API = 'https://api.bfrost.net/v1';
  // CDN fallback used when the first-party API is unavailable (pre-launch or offline).
  // Mirrors the registry data source used by the BFrost website.
  const STORE_CDN = 'https://raw.githubusercontent.com/ccascio/bfrost-workers/main/index.json';

  async function fetchStoreCatalog(query: string): Promise<void> {
    setStoreLoading(true);
    setStoreError(null);
    try {
      // ── Attempt first-party API ──────────────────────────────────────────────
      let apiOk = false;
      try {
        const params = new URLSearchParams({ limit: '50' });
        if (query.trim()) params.set('q', query.trim());
        const res = await fetch(`${STORE_API}/workers?${params.toString()}`);
        if (res.ok) {
          const data = await res.json() as { workers: StoreWorkerListing[] };
          setStoreWorkers(Array.isArray(data.workers) ? data.workers : []);
          apiOk = true;
        }
      } catch {
        // API unreachable — fall through to CDN
      }

      if (apiOk) return;

      // ── CDN fallback (same source as the BFrost website) ────────────────────
      const cdnRes = await fetch(STORE_CDN);
      if (!cdnRes.ok) throw new Error(`Store registry returned ${cdnRes.status}`);
      let all = await cdnRes.json() as StoreWorkerListing[];
      if (!Array.isArray(all)) all = [];

      // Client-side search filter when CDN is the source
      if (query.trim()) {
        const q = query.toLowerCase();
        all = all.filter(
          (w) =>
            w.name.toLowerCase().includes(q) ||
            w.tagline.toLowerCase().includes(q) ||
            w.tags.some((t) => t.toLowerCase().includes(q)),
        );
      }
      setStoreWorkers(all);
    } catch (err) {
      setStoreError(err instanceof Error ? err.message : 'Failed to load store catalog.');
    } finally {
      setStoreLoading(false);
    }
  }

  async function fetchStoreDetail(id: string): Promise<void> {
    setStoreDetailLoading(true);
    setStoreDetail(null);
    try {
      // ── Attempt first-party API (has bundleUrl, versions, etc.) ────────────
      try {
        const res = await fetch(`${STORE_API}/workers/${encodeURIComponent(id)}`);
        if (res.ok) {
          setStoreDetail(await res.json() as StoreWorkerDetail);
          return;
        }
      } catch {
        // fall through to CDN
      }
      // ── CDN fallback — index.json has all StoreWorkerDetail fields ─────────
      const cdnRes = await fetch(STORE_CDN);
      if (!cdnRes.ok) throw new Error(`CDN returned ${cdnRes.status}`);
      const all = await cdnRes.json() as StoreWorkerDetail[];
      const found = Array.isArray(all) ? all.find((w) => w.id === id) : null;
      if (!found) throw new Error('Worker not found in registry.');
      setStoreDetail(found);
    } catch (err) {
      // leave storeDetail null — UI shows "Could not load worker details"
      console.error('[store] fetchStoreDetail failed:', err);
    } finally {
      setStoreDetailLoading(false);
    }
  }

  async function fetchStoreUpdates(workers: WorkerSummary[]): Promise<void> {
    const localWorkers = workers.filter((w) => !w.builtIn);
    if (localWorkers.length === 0) return;
    try {
      const params = new URLSearchParams();
      localWorkers.forEach((w) => {
        params.append('ids', w.id);
        params.append('versions', w.version);
      });
      const res = await fetch(`${STORE_API}/updates?${params.toString()}`);
      if (!res.ok) return; // silently ignore network errors for update checks
      const data = await res.json() as { updates: Array<{ id: string; latestVersion: string }> };
      if (Array.isArray(data.updates)) {
        setStoreUpdates(new Map(data.updates.map((u) => [u.id, u.latestVersion])));
      }
    } catch {
      // Update checks are best-effort; never surface errors to the user.
    }
  }

  async function installFromStore(worker: StoreWorkerListing): Promise<void> {
    // Find the latest non-yanked version with bundle info from the detail panel.
    const detail = storeDetail?.id === worker.id ? storeDetail : null;
    const version = detail?.versions?.find((v) => !v.yanked && v.bundleUrl && v.bundleSha256);
    if (!version || !version.bundleUrl || !version.bundleSha256) {
      setError({ friendly: `No installable version found for "${worker.name}". Open the store listing to get more details.` });
      return;
    }
    setBusyKey(`store-install-${worker.id}`);
    try {
      const res = await fetch('/api/store/install', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: worker.id, bundleUrl: version.bundleUrl, bundleSha256: version.bundleSha256 }),
      });
      const payload = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !payload.ok) {
        throw new Error(payload.error ?? `Install failed (HTTP ${res.status})`);
      }
      setNotice(`"${worker.name}" installed! Use the Enable button to activate it.`);
      // Refresh dashboard to show the new worker.
      await fetchDashboard(true);
    } catch (err) {
      setError(toAppError(err));
    } finally {
      setBusyKey(null);
    }
  }

  async function sideloadWorkerZip(): Promise<void> {
    if (!sideloadFile) {
      setError({ friendly: 'Choose a worker archive before uploading.' });
      return;
    }
    setBusyKey('sideload-upload');
    try {
      const res = await fetch('/api/workers/upload', {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-Worker-Filename': sideloadFile.name },
        body: sideloadFile,
      });
      const payload = await res.json() as { ok?: boolean; error?: string; manifest?: { name: string } };
      if (!res.ok) throw new Error(payload.error ?? `Upload failed (HTTP ${res.status})`);
      setSideloadFile(null);
      setNotice(`"${payload.manifest?.name ?? sideloadFile.name}" installed! Enable it in the Workers tab.`);
      await fetchDashboard(true);
    } catch (err) {
      setError(toAppError(err));
    } finally {
      setBusyKey(null);
    }
  }

  // ── Auto-backup ────────────────────────────────────────────────────────────

  // ── Actions ────────────────────────────────────────────────────────────────

  async function fetchPendingActions(): Promise<void> {
    setActionsLoading(true);
    try {
      const res = await fetch('/api/actions/pending', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json() as { pendingActions: ActionRequest[] };
      setPendingActions(data.pendingActions ?? []);
    } catch {
      // best-effort
    } finally {
      setActionsLoading(false);
    }
  }

  async function fetchActionHistory(): Promise<void> {
    try {
      const res = await fetch('/api/actions?limit=50', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json() as { actions: ActionRequest[] };
      setActionHistory(data.actions ?? []);
    } catch {
      // best-effort
    }
  }

  async function decideAction(requestId: string, approved: boolean): Promise<void> {
    setBusyKey(`action-${requestId}`);
    try {
      const res = await fetch(`/api/actions/${encodeURIComponent(requestId)}/${approved ? 'approve' : 'reject'}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error('Request failed');
      // Remove from pending list immediately; re-poll will reconcile
      setPendingActions((prev) => prev.filter((a) => a.id !== requestId));
      if (selectedActionId === requestId) setSelectedActionId(null);
      // Refresh history so the decided action appears in the log
      void fetchActionHistory();
    } catch (err) {
      setError(toAppError(err));
    } finally {
      setBusyKey(null);
    }
  }

  async function fetchJobMetrics(force = false): Promise<void> {
    if (jobMetricsLoading) return;
    if (!force && jobMetrics !== null) return;
    setJobMetricsLoading(true);
    setJobMetricsError(null);
    try {
      const res = await fetch('/api/dashboard/job-metrics', { credentials: 'include' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        const msg = body.error ?? `HTTP ${res.status}`;
        setJobMetricsError(msg);
        console.error('[Health] job-metrics fetch failed:', res.status, msg);
        return;
      }
      setJobMetrics(await res.json() as JobMetricsResponse);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setJobMetricsError(msg);
      console.error('[Health] job-metrics fetch error:', err);
    } finally {
      setJobMetricsLoading(false);
    }
  }

  async function fetchAutoBackupSettings(): Promise<void> {
    try {
      const res = await fetch('/api/backups/settings', { credentials: 'include' });
      if (!res.ok) return;
      setAutoBackupSettings(await res.json() as AutoBackupSettings);
    } catch {
      // best-effort
    }
  }

  async function saveAutoBackup(patch: Partial<AutoBackupSettings>): Promise<void> {
    setBusyKey('auto-backup-settings');
    try {
      const res = await fetch('/api/backups/settings', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const updated = await res.json() as AutoBackupSettings;
      if (!res.ok) throw new Error((updated as any).error ?? 'Failed to save auto-backup settings.');
      setAutoBackupSettings(updated);
    } catch (err) {
      setError(toAppError(err));
    } finally {
      setBusyKey(null);
    }
  }

  async function restoreBackup(file: string): Promise<void> {
    if (!window.confirm(`Schedule restore from "${file}"?\n\nBFrost will apply this backup the next time it restarts. Your current data will be replaced.`)) return;
    setBusyKey(`restore-${file}`);
    try {
      const res = await fetch(`/api/backups/${encodeURIComponent(file)}/restore`, {
        method: 'POST',
        credentials: 'include',
      });
      const payload = await res.json() as { ok?: boolean; message?: string; error?: string };
      if (!res.ok || !payload.ok) throw new Error(payload.error ?? 'Restore scheduling failed.');
      setNotice(payload.message ?? 'Restore scheduled. Restart BFrost to apply.');
      // Refresh backup list to show restore-pending badge.
      await fetchSection('backups', { force: true });
    } catch (err) {
      setError(toAppError(err));
    } finally {
      setBusyKey(null);
    }
  }

  async function cancelRestore(): Promise<void> {
    await fetch('/api/backups/restore-cancel', { method: 'POST', credentials: 'include' });
    await fetchSection('backups', { force: true });
  }

  async function executeFactoryReset(): Promise<void> {
    if (!resetChecks.wipeWorkerState && !resetChecks.wipeCredentials && !resetChecks.wipeBackups) return;
    setBusyKey('factory-reset');
    try {
      const res = await fetch('/api/admin/factory-reset', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(resetChecks),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({})) as any;
        throw new Error(e?.error ?? `Reset failed (${res.status})`);
      }
      setResetConfirmOpen(false);
      setNotice('Factory reset complete. BFrost is shutting down — please restart it.');
    } catch (err) {
      setError(toAppError(err));
    } finally {
      setBusyKey(null);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────

  async function initialize() {
    const nextSession = await refreshSession(true);
    if (nextSession?.authenticated || nextSession?.authEnabled === false) {
      // Safe-mode boot: if ?safe=1 is in the URL, disable all workers before loading.
      const urlParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
      if (urlParams.get('safe') === '1') {
        await fetch('/api/admin/disable-all-workers', { method: 'POST', credentials: 'include' });
        setNotice('Safe mode: all workers have been disabled. Re-enable them one at a time from the Workers tab.');
        // Clean the URL so a refresh doesn't re-trigger safe mode.
        window.history.replaceState({}, '', window.location.pathname);
      }
      await fetchDashboard(false);
      // Check whether to open the first-run wizard.
      try {
        const wizRes = await fetch('/api/wizard/state', { credentials: 'include' });
        if (wizRes.ok) {
          const wizState = await wizRes.json() as { step: number; completed: boolean };
          if (!wizState.completed) {
            setWizardOpen(true);
          }
        }
      } catch {
        // Non-fatal — wizard won't auto-open on network error
      }
    }
  }

  async function refreshSession(showErrors: boolean): Promise<AuthSession | null> {
    try {
      const response = await fetch('/api/auth/session', { credentials: 'include' });
      const payload = (await response.json()) as AuthSession | { error: string };
      if (!response.ok || 'error' in payload) {
        throw new Error('error' in payload ? payload.error : 'Failed to load auth session');
      }

      setSession(payload);
      if (!payload.authenticated && payload.authEnabled) {
        setDashboard(null);
      }
      return payload;
    } catch (err) {
      if (showErrors) {
        setError(toAppError(err));
        setNotice('Authentication check failed.');
      }
      return null;
    }
  }

  // Sections fetched lazily on tab activation. Loaded set prevents re-fetching on each
  // tab switch; activeTabRef lets the 15s poll refresh only what's currently on screen
  // instead of every endpoint the user has ever touched.
  const loadedSectionsRef = useRef<Set<DashboardSectionName>>(new Set());
  const inflightSectionsRef = useRef<Map<DashboardSectionName, Promise<void>>>(new Map());
  const activeTabRef = useRef<DashboardTab>('overview');
  const loadedBundleWorkersRef = useRef<Set<string>>(new Set());
  const dashboardViews = useWorkerDashboardViews();

  function seedEmptySections(shell: DashboardState): DashboardState {
    return {
      ...shell,
      lmStudio: { ...shell.lmStudio, loadedModels: shell.lmStudio.loadedModels ?? [] },
      cron: { ...shell.cron, runs: shell.cron.runs ?? [] },
      queue: shell.queue ?? {
        total: 0, queued: 0, approved: 0, posted: 0, rejected: 0,
        failed: 0, seen: 0, retrying: 0, recentItems: [],
      },
      events: shell.events ?? [],
      backups: shell.backups ?? [],
      workerData: (shell as any).workerData ?? {},
    } as DashboardState;
  }

  async function fetchDashboard(preserveDrafts: boolean) {
    try {
      const response = await fetch('/api/dashboard', { credentials: 'include' });
      const payload = (await response.json()) as DashboardState | { error: string };
      if (!response.ok || 'error' in payload) {
        if (response.status === 401) {
          setSession({ authenticated: false, authEnabled: true });
          setDashboard(null);
        }
        throw new Error('error' in payload ? payload.error : 'Failed to load dashboard');
      }

      setDashboard((prev) => {
        // Preserve previously loaded section data so the UI doesn't flash empty while a
        // section refetch is in flight; section loaders below will overwrite as they arrive.
        const seeded = seedEmptySections(payload);
        if (!prev) return seeded;
        return {
          ...seeded,
          lmStudio: loadedSectionsRef.current.has('lmStudioModels')
            ? { ...seeded.lmStudio, loadedModels: prev.lmStudio.loadedModels }
            : seeded.lmStudio,
          cron: loadedSectionsRef.current.has('cronRuns')
            ? { ...seeded.cron, runs: prev.cron.runs }
            : seeded.cron,
          queue: loadedSectionsRef.current.has('queue') ? prev.queue : seeded.queue,
          events: loadedSectionsRef.current.has('events') ? prev.events : seeded.events,
          backups: loadedSectionsRef.current.has('backups') ? prev.backups : seeded.backups,
          workerData: loadedSectionsRef.current.has('workerData') ? prev.workerData : seeded.workerData,
        } as DashboardState;
      });
      if (!preserveDrafts || !selectedModelAlias) {
        syncDrafts(seedEmptySections(payload));
      }
      setError(null);
      setNotice(`Updated ${formatTime(payload.app.now)}`);

      // Refresh sections for the current tab only. Other tabs keep their cached data
      // until the user navigates to them — that's what makes opening the console fast
      // and keeps the poll cycle from hitting every endpoint every 15s.
      await refreshActiveTabSections();
    } catch (err) {
      setError(toAppError(err));
      setNotice('Dashboard refresh failed.');
    }
  }

  async function fetchSection(name: DashboardSectionName, opts: { force?: boolean } = {}): Promise<void> {
    if (!opts.force && loadedSectionsRef.current.has(name)) return;
    // If a fetch for this section is already in flight, reuse it. Prevents the
    // initial-mount race where activeTab useEffect + a parallel refresh both fire
    // for the same section.
    const inflight = inflightSectionsRef.current.get(name);
    if (inflight) return inflight;

    const promise = (async () => {
      try {
        const response = await fetch(sectionEndpoint(name), { credentials: 'include' });
        const payload = await response.json();
        if (!response.ok || 'error' in payload) {
          throw new Error(payload.error ?? `Failed to load ${name}`);
        }
        // Only sync editable drafts on the *first* successful load. Subsequent forced
        // refreshes (15s poll, post-mutation refresh) must not overwrite whatever the
        // user is currently typing — otherwise the form visibly resets every few
        // seconds and credentials can't be entered.
        loadedSectionsRef.current.add(name);
        setDashboard((prev) => (prev ? mergeSection(prev, name, payload) : prev));
      } catch (err) {
        setError(toAppError(err));
      } finally {
        inflightSectionsRef.current.delete(name);
      }
    })();
    inflightSectionsRef.current.set(name, promise);
    return promise;
  }

  function syncDrafts(payload: DashboardState) {
    setSelectedModelAlias(payload.defaultModel.alias);
    setJobDrafts(
      Object.fromEntries(
        payload.cron.jobs.map((job) => {
          const draft: JobDraft = {
            enabled: job.enabled,
            cron: job.cron,
            modelAlias: job.modelAlias,
            approvalRequired: job.approvalRequired,
            prompt: job.prompt,
            params: buildJobParamsDraft(job),
          };
          return [job.name, draft];
        }),
      ),
    );
    // Surface drafts are now lazy: render falls back to buildSurfaceDraft(surface,
    // dashboard.workerData) when surfaceDrafts[key] is absent. That way fields with
    // `seedPath` reflect the latest workerData snapshot until the user types into
    // them — typing snapshots the draft and user input wins from then on.
  }

  async function mutate(
    key: string,
    input: RequestInfo,
    init: RequestInit,
    successMessage: string,
  ) {
    setBusyKey(key);
    setError(null);

    try {
      const response = await fetch(input, {
        ...init,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(init.headers || {}),
        },
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok || 'error' in payload) {
        if (response.status === 401) {
          setSession({ authenticated: false, authEnabled: true });
          setDashboard(null);
        }
        throw new Error(payload.error ?? 'Request failed');
      }

      setNotice(successMessage);
      await fetchDashboard(true);
    } catch (err) {
      setError(toAppError(err));
    } finally {
      setBusyKey(null);
    }
  }

  async function triggerRun(key: string, url: string, successMessage: string) {
    setBusyKey(key);
    setError(null);
    try {
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const payload = (await response.json()) as { started?: boolean; error?: string };
      if (!response.ok || 'error' in payload) {
        if (response.status === 401) setSession({ authenticated: false, authEnabled: true });
        throw new Error('error' in payload ? payload.error : 'Request failed');
      }
      setNotice(successMessage);
      await fetchDashboard(true);
    } catch (err) {
      setError(toAppError(err));
    } finally {
      setBusyKey(null);
    }
  }

  async function uploadWorkerZip() {
    if (!workerUploadFile) {
      setError({ friendly: 'Choose a worker zip before uploading.' });
      return;
    }

    setBusyKey('worker-upload');
    setError(null);
    try {
      const response = await fetch('/api/workers/upload', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/zip',
          'X-Worker-Filename': workerUploadFile.name,
        },
        body: workerUploadFile,
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok || 'error' in payload) {
        if (response.status === 401) setSession({ authenticated: false, authEnabled: true });
        throw new Error(payload.error ?? 'Worker upload failed');
      }
      setWorkerUploadFile(null);
      setNotice('Worker uploaded.');
      await fetchDashboard(true);
    } catch (err) {
      setError(toAppError(err));
    } finally {
      setBusyKey(null);
    }
  }

  async function deleteWorker(worker: WorkerSummary) {
    if (worker.builtIn) return;
    if (!window.confirm(`Delete ${worker.name} from local workers?`)) return;

    setBusyKey(`worker-delete-${worker.id}`);
    setError(null);
    try {
      const response = await fetch(`/api/workers/${encodeURIComponent(worker.id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok || 'error' in payload) {
        if (response.status === 401) setSession({ authenticated: false, authEnabled: true });
        throw new Error(payload.error ?? 'Worker delete failed');
      }
      setNotice(`${worker.name} worker deleted.`);
      await fetchDashboard(true);
    } catch (err) {
      setError(toAppError(err));
    } finally {
      setBusyKey(null);
    }
  }

  async function updateQueueItem(id: string, action: 'approve' | 'reject') {
    await mutate(
      `${action}-${id}`,
      '/api/queue-item',
      {
        method: 'POST',
        body: JSON.stringify({ id, action }),
      },
      action === 'approve' ? 'Queue item approved.' : 'Queue item rejected.',
    );
  }

  async function savePlatformRouting() {
    const current = dashboard?.platform;
    if (!current) return;
    const next = {
      activeLocalProviderId:
        activeLocalProviderDraft && activeLocalProviderDraft !== current.activeLocalProviderId
          ? activeLocalProviderDraft
          : undefined,
      primaryChannelId:
        primaryChannelDraft && primaryChannelDraft !== current.primaryChannelId
          ? primaryChannelDraft
          : undefined,
    };
    if (!next.activeLocalProviderId && !next.primaryChannelId) return;
    await mutate(
      'save-platform-routing',
      '/api/platform-settings',
      { method: 'POST', body: JSON.stringify(next) },
      'Platform routing updated.',
    );
    setActiveLocalProviderDraft('');
    setPrimaryChannelDraft('');
  }

  async function fetchLocalEmbeddingModels() {
    if (loadingEmbeddingModels) return;
    setLoadingEmbeddingModels(true);
    try {
      const res = await fetch('/api/dashboard/local-embedding-models');
      if (res.ok) {
        const data = await res.json() as { models: Array<{ id: string; label: string }> };
        setLocalEmbeddingModels(data.models);
      }
    } catch {
      // leave previous list in place
    } finally {
      setLoadingEmbeddingModels(false);
    }
  }

  async function saveEmbeddingSettings() {
    const current = dashboard?.platform;
    if (!current) return;
    const next: { provider?: 'local' | 'openai'; model?: string } = {};
    if (embeddingProviderDraft && embeddingProviderDraft !== current.embeddingProvider) {
      next.provider = embeddingProviderDraft;
    }
    if (embeddingModelDraft.trim() && embeddingModelDraft.trim() !== current.embeddingModel) {
      next.model = embeddingModelDraft.trim();
    }
    if (!next.provider && !next.model) return;
    await mutate(
      'save-embedding-settings',
      '/api/embedding-settings',
      { method: 'POST', body: JSON.stringify(next) },
      'Embedding settings saved.',
    );
    setEmbeddingProviderDraft('');
    setEmbeddingModelDraft('');
  }

  async function saveCloudApiKeys() {
    await mutate(
      'save-cloud-api-keys',
      '/api/cloud-api-keys',
      {
        method: 'POST',
        body: JSON.stringify({
          openaiApiKey: openaiApiKeyDraft.trim() || undefined,
          anthropicApiKey: anthropicApiKeyDraft.trim() || undefined,
        }),
      },
      'Cloud API keys saved to local .env.',
    );
    setOpenaiApiKeyDraft('');
    setAnthropicApiKeyDraft('');
  }

  async function saveWorkerConfigurationSurface(worker: WorkerSummary, surface: WorkerDashboardSurface) {
    if (!surface.path || surface.path.includes('#')) return;
    const key = configSurfaceKey(worker.id, surface.id);
    const fields = surface.fields ?? [];
    const draft = surfaceDrafts[key] ?? buildSurfaceDraft(surface, dashboard?.workerData);

    await mutate(
      `config-surface-${key}`,
      surface.path,
      {
        method: 'POST',
        body: JSON.stringify(serializeDashboardFields(fields, draft)),
      },
      `${surface.label} saved.`,
    );
  }

  async function sendDashboardChat() {
    const message = chatDraft.trim();
    if (!message) return;

    const userTurn: ChatTurn = { role: 'user', text: message, createdAt: new Date().toISOString() };
    setChatTurns((current) => [...current, userTurn]);
    setChatDraft('');
    setBusyKey('dashboard-chat');
    setError(null);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, conversationId: 'dashboard-admin' }),
      });
      const payload = (await response.json()) as { response: string; dashboard: DashboardState } | { error: string };
      if (!response.ok || 'error' in payload) {
        throw new Error('error' in payload ? payload.error : 'Chat request failed');
      }

      // The chat endpoint now returns a shell-only dashboard. Route it through
      // fetchDashboard so the merge logic preserves already-loaded sections and triggers
      // a refresh of whatever the current tab needs, instead of wiping section state.
      setChatTurns((current) => [
        ...current,
        { role: 'assistant', text: payload.response, createdAt: new Date().toISOString() },
      ]);
      await fetchDashboard(true);
      setNotice('Dashboard chat answered.');
    } catch (err) {
      setError(toAppError(err));
    } finally {
      setBusyKey(null);
    }
  }

  async function login() {
    setBusyKey('login');
    setError(null);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const payload = (await response.json()) as AuthSession | { error: string };
      if (!response.ok || 'error' in payload) {
        throw new Error('error' in payload ? payload.error : 'Login failed');
      }

      setPassword('');
      setSession(payload);
      setNotice('Authenticated.');
      await fetchDashboard(false);
    } catch (err) {
      setError(toAppError(err));
    } finally {
      setBusyKey(null);
    }
  }

  async function logout() {
    setBusyKey('logout');
    setError(null);

    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
    } finally {
      setSession((current) =>
        current ? { authenticated: false, authEnabled: current.authEnabled } : { authenticated: false, authEnabled: true },
      );
      setDashboard(null);
      setBusyKey(null);
      setNotice('Signed out.');
    }
  }

  if (!session) {
    return (
      <main className="shell">
        <section className="hero">
          <p className="eyebrow">BFrost</p>
          <h1>Control Room</h1>
          <p className="hero-copy">Checking authentication status.</p>
          {error ? <p className="error-text">{error}</p> : null}
        </section>
      </main>
    );
  }

  if (session.authEnabled && !session.authenticated) {
    return (
      <main className="shell">
        <section className="hero">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <img
              src="/bfrost-logo.jpeg"
              alt="BFrost"
              style={{ width: 72, height: 72, borderRadius: 16, objectFit: 'cover', flexShrink: 0 }}
            />
            <div>
              <p className="eyebrow">BFrost</p>
              <h1>Control Room</h1>
              <p className="hero-copy">Enter the admin password to unlock operator controls.</p>
            </div>
          </div>
        </section>

        <section className="panel auth-panel">
          <label className="field">
            <span>Admin password</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && busyKey !== 'login') {
                  void login();
                }
              }}
            />
          </label>

          <div className="panel-actions">
            <button
              className="primary"
              disabled={busyKey === 'login' || password.length === 0}
              onClick={() => void login()}
            >
              {busyKey === 'login' ? 'Unlocking...' : 'Unlock dashboard'}
            </button>
          </div>

          {error ? <p className="error-box">{error.friendly}</p> : null}
        </section>
      </main>
    );
  }

  if (!dashboard) {
    return (
      <div className="bfrost-splash" aria-busy="true" aria-live="polite">
        <img src="/bfrost-logo.jpeg" alt="BFrost" />
        <span>Loading BFrost…</span>
        {error ? (
          <p className="error-text" style={{ marginTop: '0.5rem' }}>{error?.friendly}</p>
        ) : null}
      </div>
    );
  }

  const filteredQueueItems = dashboard.queue.recentItems.filter((item) => {
    if (queueFilter === 'all') return true;
    if (queueFilter === 'retrying') return item.state === 'failed' && (item.attemptCount ?? 0) > 0;
    return item.state === queueFilter;
  });
  const selectedQueueItem =
    filteredQueueItems.find((item) => item.id === selectedQueueItemId) ??
    dashboard.queue.recentItems.find((item) => item.id === selectedQueueItemId) ??
    filteredQueueItems[0] ??
    null;
  const selectedJob =
    selectedJobName ? dashboard.cron.jobs.find((job) => job.name === selectedJobName) ?? null : null;
  const selectedJobRuns = selectedJob
    ? dashboard.cron.runs.filter((run) => run.job === selectedJob.name)
    : [];
  const jobsByWorker = dashboard.workers
    .map((worker) => ({
      worker,
      jobs: dashboard.cron.jobs.filter((job) => job.workerId === worker.id),
    }))
    .filter((group) => group.jobs.length > 0);
  const configGroupsByWorker = dashboard.workers
    .filter((worker) => worker.kind !== 'channel') // channel workers have their own Channels tab
    .map((worker) => ({
      worker,
      surfaces: worker.dashboard.settings.filter((surface) => surface.tab === 'config'),
      jobs: dashboard.cron.jobs.filter((job) => job.workerId === worker.id),
    }))
    .filter((group) => group.surfaces.length > 0 || group.jobs.length > 0);
  const configJobCount = configGroupsByWorker.reduce((count, group) => count + group.jobs.length, 0);
  const configSurfaceCount = configGroupsByWorker.reduce((count, group) => count + group.surfaces.length, 0);
  const configCoreCount = 1;
  const selectedConfigJob =
    selectedConfigJobName ? dashboard.cron.jobs.find((job) => job.name === selectedConfigJobName) ?? null : null;
  const selectedConfigSurface = selectedConfigSurfaceKey
    ? configGroupsByWorker
      .flatMap(({ worker, surfaces }) => surfaces.map((surface) => ({ worker, surface })))
      .find(({ worker, surface }) => configSurfaceKey(worker.id, surface.id) === selectedConfigSurfaceKey) ?? null
    : null;
  const workerTabDefinitions = buildWorkerTabDefinitions(dashboard.workers, dashboardViews);
  const activeWorkerTab = workerTabDefinitions.find((tab) => tab.id === activeTab) ?? null;
  const workerViewContext = {
    activeWorkerTab,
    dashboard,
    filteredQueueItems,
    selectedQueueItem,
    selectedRunId,
    queueFilter,
    busyKey,
    setSelectedQueueItemId,
    setSelectedRunId,
    setQueueFilter,
    updateQueueItem,
    refreshDashboard: () => fetchDashboard(true),
    triggerRun,
    renderQueueMetrics,
    renderQueueDetail,
    queueItemReason,
    queueItemTone,
    formatDate,
    eventSeverityTone,
    StatusPill,
    HealthRow,
    Detail,
  };
  const sidebarEntries: SidebarEntry<DashboardTab>[] = [
    ...CORE_MENU_ENTRIES.map((entry) => ({
      ...entry,
      count: coreMenuCount(entry.id, {
        workers: dashboard.workers.length,
        channels: dashboard.workers.filter((w) => w.kind === 'channel').length,
        jobs: dashboard.cron.jobs.length,
        config: configJobCount + configSurfaceCount + configCoreCount,
        chat: chatTurns.length,
        system: dashboard.events.length,
        store: storeUpdates.size,
        pendingActions: pendingActions.length,
      }),
    })),
    ...workerTabDefinitions.map((tab) => ({
      id: tab.id,
      label: tab.definition.menu?.label ?? tab.worker.name,
      icon: tab.definition.menu?.icon ?? 'workers',
      group: tab.definition.menu?.group ?? 'Workers',
      order: tab.definition.menu?.order ?? 1000,
      count: tab.definition.count(workerViewContext),
    })),
  ];

  function updateJobDraftParam(jobName: string, draft: JobDraft, key: string, value: JobParamDraftValue) {
    setJobDrafts((current) => ({
      ...current,
      [jobName]: {
        ...draft,
        params: {
          ...draft.params,
          [key]: value,
        },
      },
    }));
  }

  function updateSurfaceDraftParam(surfaceKey: string, key: string, value: JobParamDraftValue) {
    setSurfaceDrafts((current) => ({
      ...current,
      [surfaceKey]: {
        ...(current[surfaceKey] ?? {}),
        [key]: value,
      },
    }));
  }

  function renderDashboardField(
    field: JobDashboardField,
    value: JobParamDraftValue,
    onChange: (value: JobParamDraftValue) => void,
    options: { draftKey?: string } = {},
  ) {
    if (field.type === 'boolean') {
      return (
        <label className="field checkbox" key={field.key}>
          <span>{field.label}</span>
          <input
            type="checkbox"
            checked={typeof value === 'boolean' ? value : field.defaultValue}
            onChange={(event) => onChange(event.target.checked)}
          />
          {field.helpText ? <small>{field.helpText}</small> : null}
        </label>
      );
    }

    if (field.type === 'string-list') {
      const rows = stringListDraftRows(value);
      const suggestions = field.suggestions ?? [];
      const draftKey = options.draftKey ?? field.key;
      const customDraft = customListItemDrafts[draftKey] ?? '';
      const placeholder = field.placeholder ?? fieldListPlaceholder(field);

      function addCustomItem() {
        const item = customDraft.trim();
        if (!item) return;
        onChange(addStringListDraftValue(value, item));
        setCustomListItemDrafts((current) => ({ ...current, [draftKey]: '' }));
      }

      return (
        <div className={`field list-field${suggestions.length > 0 ? ' has-suggestions' : ''}`} key={field.key}>
          <span>{field.label}</span>
          {field.helpText ? <small>{field.helpText}</small> : null}

          {suggestions.length > 0 ? (
            <div className="suggestion-picker">
              <span>Suggestions</span>
              <div className="suggestion-chip-grid">
                {suggestions.map((suggestion) => {
                  const selected = stringListDraftIncludes(value, suggestion);
                  return (
                    <button
                      key={suggestion}
                      type="button"
                      className={`suggestion-chip${selected ? ' selected' : ''}`}
                      aria-pressed={selected}
                      onClick={() => onChange(toggleStringListDraftValue(value, suggestion))}
                    >
                      {suggestion}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* For suggestion-based fields, hide the editor until at least one item is selected.
              Items arrive via chip clicks or the custom-entry below, not by typing in an empty row. */}
          {(suggestions.length === 0 || stringListDraftItems(value).length > 0) ? (
            <div className="list-editor">
              {suggestions.length > 0 ? (
                <span className="list-editor-label">Selected</span>
              ) : null}
              {rows.map((item, index) => (
                <div className="list-editor-row" key={`${field.key}-${index}`}>
                  <input
                    type="text"
                    value={item}
                    placeholder={placeholder}
                    onChange={(event) => {
                      const nextRows = rows.slice();
                      nextRows[index] = event.target.value;
                      onChange(nextRows.join('\n'));
                    }}
                  />
                  <button
                    type="button"
                    aria-label={`Remove ${field.label.toLowerCase()} item ${index + 1}`}
                    title="Remove item"
                    onClick={() => {
                      const nextRows = rows.slice();
                      nextRows.splice(index, 1);
                      onChange(nextRows.join('\n'));
                    }}
                    disabled={rows.length <= 1 && item.trim().length === 0}
                  >
                    -
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {suggestions.length > 0 ? (
            <div className="list-custom-entry">
              <input
                type="text"
                value={customDraft}
                placeholder={placeholder}
                onChange={(event) =>
                  setCustomListItemDrafts((current) => ({ ...current, [draftKey]: event.target.value }))
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addCustomItem();
                  }
                }}
              />
              <button type="button" onClick={addCustomItem} disabled={!customDraft.trim()}>
                Add item
              </button>
            </div>
          ) : (
            <div className="field-actions">
              <button
                type="button"
                onClick={() => onChange([...rows, ''].join('\n'))}
              >
                Add item
              </button>
            </div>
          )}
        </div>
      );
    }

    if (field.type === 'textarea') {
      return (
        <label className="field prompt-field" key={field.key}>
          <span>{field.label}</span>
          <textarea
            value={String(value)}
            rows={field.rows ?? 4}
            placeholder={field.placeholder}
            onChange={(event) => onChange(event.target.value)}
          />
          {field.helpText ? <small>{field.helpText}</small> : null}
        </label>
      );
    }

    if (field.type === 'select') {
      return (
        <label className="field" key={field.key}>
          <span>{field.label}</span>
          <select
            value={String(value)}
            onChange={(event) => onChange(event.target.value)}
          >
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {field.helpText ? <small>{field.helpText}</small> : null}
        </label>
      );
    }

    return (
      <label className="field" key={field.key}>
        <span>{field.label}</span>
        <input
          type={field.type === 'number' ? 'number' : field.type === 'secret-reference' ? 'password' : 'text'}
          value={value as string | number}
          placeholder={field.type === 'secret-reference' || field.type === 'text' ? field.placeholder : undefined}
          min={field.type === 'number' ? field.min : undefined}
          max={field.type === 'number' ? field.max : undefined}
          step={field.type === 'number' ? field.step : undefined}
          autoComplete={field.type === 'secret-reference' ? 'off' : undefined}
          onChange={(event) => onChange(field.type === 'number' ? Number(event.target.value) : event.target.value)}
        />
        {field.helpText ? <small>{field.helpText}</small> : null}
      </label>
    );
  }

  function renderJobParamField(job: SchedulerJobState, draft: JobDraft, field: JobDashboardField) {
    const value = draft.params[field.key] ?? fieldDefaultDraftValue(field);
    return renderDashboardField(
      field,
      value,
      (nextValue) => updateJobDraftParam(job.name, draft, field.key, nextValue),
      { draftKey: `${job.name}.${field.key}` },
    );
  }

  return (
    <div className={`dashboard-layout${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <TopBar
        notice={notice}
        error={error}
        environment={dashboard.lmStudio.running ? 'Local runtime online' : 'Local runtime offline'}
        adminUrl={dashboard.app.adminUrl}
        pid={dashboard.app.pid}
        models={dashboard.models}
        selectedModelAlias={selectedModelAlias}
        modelBusy={busyKey === 'save-model'}
        selectedModelIsLocal={
          dashboard.models.find((m) => m.alias === selectedModelAlias)?.provider ===
            dashboard.platform.activeLocalProviderId
        }
        selectedModelIsPinned={
          !!dashboard.lmStudio.pinnedModelId &&
          dashboard.models.find((m) => m.alias === selectedModelAlias)?.id ===
            dashboard.lmStudio.pinnedModelId
        }
        pinBusy={busyKey === 'toggle-pin'}
        authEnabled={session.authEnabled}
        logoutBusy={busyKey === 'logout'}
        onModelChange={(event) => setSelectedModelAlias(event.target.value)}
        onSaveModel={() =>
          void mutate(
            'save-model',
            '/api/default-model',
            {
              method: 'POST',
              body: JSON.stringify({ alias: selectedModelAlias }),
            },
            'Default model updated.',
          )
        }
        onTogglePin={() => {
          const isPinned =
            !!dashboard.lmStudio.pinnedModelId &&
            dashboard.models.find((m) => m.alias === selectedModelAlias)?.id ===
              dashboard.lmStudio.pinnedModelId;
          void mutate(
            'toggle-pin',
            '/api/lmstudio',
            {
              method: 'POST',
              body: JSON.stringify(
                isPinned ? { action: 'pin-unload' } : { action: 'pin-load', alias: selectedModelAlias },
              ),
            },
            isPinned ? 'Model unloaded.' : 'Model loaded and pinned.',
          );
        }}
        onDismissError={() => setError(null)}
        onLogout={() => void logout()}
      />
      <Sidebar
        entries={sidebarEntries}
        activeTab={activeTab}
        collapsed={sidebarCollapsed}
        onSelect={setActiveTab}
        onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
      />
      <main className="shell dashboard-main">

      {activeTab === 'overview' ? (
        <section className="tab-page">
          {renderStuckDetectorBanner()}
          <section className="grid top-grid">
            {renderModelPanel()}
            {(() => {
              // Render the active local provider's runtime panel from its worker bundle.
              // The bundle owns the JSX; we just find + call it here.
              const lmView = dashboardViews.find((v) => v.workerId === 'core.providers.lmstudio');
              const lmWorker = dashboard.workers.find((w) => w.id === 'core.providers.lmstudio');
              if (!lmView || !lmWorker || !lmWorker.enabled) return null;
              return lmView.render(workerViewContext);
            })()}
          </section>

          <section className="grid overview-grid">
            <article className="panel">
              <div className="panel-head">
                <div>
                  <p className="panel-kicker">Capabilities</p>
                  <h2>Installed worker status <HelpTip>Workers are the building blocks of BFrost. Each one does a specific job — fetching news, posting to social media, running research — on a schedule you control. Enable or disable them from the Workers tab. A green "healthy" badge means everything it needs is configured.</HelpTip></h2>
                </div>
                <StatusPill tone={dashboard.workers.some((worker) => worker.healthState !== 'healthy' && worker.healthState !== 'disabled') ? 'warning' : 'good'}>
                  {dashboard.workers.length} installed
                </StatusPill>
              </div>
              <div className="stack-list compact">
                {dashboard.workers.map((worker) => (
                  <div className="summary-row" key={`${worker.id}-overview`}>
                    <div>
                      <strong>{worker.displayName ?? worker.name}</strong>
                      <span>{worker.tagline ?? worker.description}</span>
                      <span>{worker.builtIn ? 'built-in' : 'local'} · {worker.jobCount} jobs</span>
                    </div>
                    <StatusPill tone={workerHealthTone(worker.healthState)}>
                      {worker.runningJobCount > 0 ? 'running' : workerHealthLabel(worker.healthState)}
                    </StatusPill>
                  </div>
                ))}
              </div>
            </article>

            <article className="panel">
              <div className="panel-head">
                <div>
                  <p className="panel-kicker">Activity</p>
                  <h2>Recent events <HelpTip>A live log of everything BFrost has done — fetched news, ran a job, published a post, recorded an error. Events are stored locally; nothing is sent to any server.</HelpTip></h2>
                </div>
                <StatusPill tone="muted">{dashboard.events.length} stored</StatusPill>
              </div>
              <div className="stack-list compact">
                {dashboard.events.slice(0, 8).map((event) => (
                  <div className="summary-row" key={`${event.id}-overview`}>
                    <div>
                      <strong>{event.summary}</strong>
                      <span>{event.category} · {event.action}</span>
                      <span>{formatDate(event.createdAt)}</span>
                    </div>
                    <StatusPill tone={eventSeverityTone(event.severity)}>{event.severity}</StatusPill>
                  </div>
                ))}
                {dashboard.events.length === 0 ? (
                  <div className="empty-state">
                    <p>Nothing has happened here yet.</p>
                    <p className="footnote">
                      Events show up when a worker runs, finishes, or changes state. Enable a worker
                      to start collecting activity, or open Chat to ask the assistant a question.
                    </p>
                    <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
                      <button type="button" onClick={() => setActiveTab('workers')}>
                        Open Workers
                      </button>
                      <button type="button" onClick={() => setActiveTab('chat')}>
                        Open Chat
                      </button>
                      <button
                        type="button"
                        disabled={busyKey === 'seed-sample-data'}
                        onClick={() => void (async () => {
                          setBusyKey('seed-sample-data');
                          try {
                            await fetch('/api/admin/seed-sample-data', { method: 'POST', credentials: 'include' });
                            await fetchDashboard(true);
                            setNotice('Sample data loaded — browse the Jobs tab to see queued items.');
                          } finally { setBusyKey(null); }
                        })()}
                      >
                        {busyKey === 'seed-sample-data' ? 'Loading…' : 'Load sample data'}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </article>
          </section>
        </section>
      ) : null}

      {activeTab === 'chat' ? (
        <section className="panel tab-page chat-page">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">Assistant</p>
              <h2>Dashboard chat <HelpTip>Type naturally to ask about your queue, schedules, or workers — or give commands like "enable the news digest at 8am". The assistant uses the same AI model you have configured in Settings. All messages stay on your machine.</HelpTip></h2>
            </div>
            <StatusPill tone={
              dashboard.workers.find(
                (w) => w.kind === 'provider' && w.id.endsWith(`.${dashboard.defaultModel.provider}`)
              )?.healthState === 'healthy' ? 'good' : 'warning'
            }>
              {dashboard.defaultModel.alias}
            </StatusPill>
          </div>

          <div className="chat-log" ref={chatLogRef}>
            {chatTurns.length === 0 ? CHAT_WELCOME : null}
            {chatTurns.map((turn, index) => (
              <div className={`chat-turn ${turn.role}`} key={`${turn.createdAt}-${index}`}>
                <div className="chat-turn-meta">
                  <span className="chat-turn-role">{turn.role === 'user' ? 'You' : 'Assistant'}</span>
                  <span className="chat-turn-time">{formatTime(turn.createdAt)}</span>
                </div>
                {turn.role === 'assistant' ? (
                  <Markdown source={turn.text} className="chat-turn-body" />
                ) : (
                  <div className="chat-turn-body chat-turn-body-user">{turn.text}</div>
                )}
              </div>
            ))}
            {busyKey === 'dashboard-chat' ? (
              <div className="chat-turn assistant chat-turn-pending">
                <div className="chat-turn-meta">
                  <span className="chat-turn-role">Assistant</span>
                  <span className="chat-turn-time">…</span>
                </div>
                <div className="chat-turn-body">
                  <span className="chat-typing"><i /><i /><i /></span>
                </div>
              </div>
            ) : null}
          </div>

          <form
            className="chat-composer"
            onSubmit={(event) => {
              event.preventDefault();
              if (busyKey !== 'dashboard-chat' && chatDraft.trim().length > 0) {
                void sendDashboardChat();
              }
            }}
          >
            <textarea
              className="chat-composer-input"
              placeholder="Send a message — ⌘/Ctrl + Enter to send"
              value={chatDraft}
              onChange={(event) => setChatDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && busyKey !== 'dashboard-chat') {
                  event.preventDefault();
                  void sendDashboardChat();
                }
              }}
              rows={2}
            />
            <button
              className="primary chat-composer-send"
              type="submit"
              disabled={busyKey === 'dashboard-chat' || chatDraft.trim().length === 0}
            >
              {busyKey === 'dashboard-chat' ? 'Thinking…' : 'Send'}
            </button>
          </form>
        </section>
      ) : null}

      {activeTab === 'channels' ? renderChannelsTab() : null}

      {activeTab === 'jobs' ? (
        <section className="panel tab-page">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">Cron jobs</p>
              <h2>Schedules and run status <HelpTip>Each worker can run one or more scheduled jobs — cron-based tasks that fire automatically (e.g. "fetch news every morning at 7am"). Select a job on the left to change its schedule, adjust parameters, or trigger it manually. The last-run timestamp and any errors are shown inline.</HelpTip></h2>
            </div>
            <StatusPill tone="muted">{dashboard.cron.timezone}</StatusPill>
          </div>

          <div className="jobs-workspace">
            <div className="jobs">
              {jobsByWorker.map(({ worker, jobs }) => (
                <section className="job-worker-group" key={worker.id}>
                  <div className="job-worker-head">
                    <div>
                      <p className="panel-kicker">{worker.builtIn ? 'Built-in worker' : 'Local worker'}</p>
                      <h3>{worker.displayName ?? worker.name}</h3>
                      <span>{worker.id} · {worker.enabledJobCount}/{worker.jobCount} jobs enabled</span>
                    </div>
                    <StatusPill tone={workerHealthTone(worker.healthState)}>
                      {worker.runningJobCount > 0 ? 'running' : workerHealthLabel(worker.healthState)}
                    </StatusPill>
                  </div>

                  <div className="stack-list compact">
                    {jobs.map((job) => (
                      <button
                        className={`run-item run-button job-row-button${selectedJob?.name === job.name ? ' selected' : ''}`}
                        key={job.name}
                        type="button"
                        aria-pressed={selectedJob?.name === job.name}
                        onClick={() => setSelectedJobName(job.name)}
                      >
                        <div>
                          <strong>{job.label}</strong>
                          <span>{job.description}</span>
                          <span>{job.enabled ? job.cron : 'disabled'} · {job.effectiveModelAlias}</span>
                        </div>
                        <StatusPill tone={statusTone(job.lastStatus)}>
                          {job.running ? 'running' : job.lastStatus}
                        </StatusPill>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>

            <aside className="queue-detail-column">
              <section className="detail-panel">
                <div className="panel-head">
                  <div>
                    <p className="panel-kicker">Job detail</p>
                    <h2>{selectedJob?.label ?? 'No job selected'}</h2>
                  </div>
                  {selectedJob ? (
                    <StatusPill tone={statusTone(selectedJob.lastStatus)}>
                      {selectedJob.running ? 'running' : selectedJob.lastStatus}
                    </StatusPill>
                  ) : null}
                </div>

                {selectedJob ? renderJobOperations(selectedJob, selectedJobRuns) : (
                  <p className="empty-state">Select a job row to edit its standard schedule controls and inspect its timeline.</p>
                )}
              </section>
            </aside>
          </div>

          <p className="footnote">
            Cron format uses standard five-field expressions, for example <code>*/30 * * * *</code>{' '}
            for every 30 minutes.
          </p>
        </section>
      ) : null}

      {activeTab === 'config' ? (
        <section className="panel tab-page">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">Worker configuration</p>
              <h2>Manifest settings <HelpTip>Configuration surfaces declared by each worker — news source rules, API keys, prompt templates, and more. Select a worker on the left; its settings panels appear on the right. Changes take effect the next time the worker runs.</HelpTip></h2>
            </div>
            <StatusPill tone="muted">{configJobCount + configSurfaceCount + configCoreCount} configurable</StatusPill>
          </div>

          <div className="jobs-workspace">
            <div className="jobs">
              <section className="job-worker-group">
                <div className="job-worker-head">
                  <div>
                    <p className="panel-kicker">Platform</p>
                    <h3>Model providers <HelpTip>A model provider is the AI service BFrost uses to think — OpenAI (GPT-4o), Anthropic (Claude), or a local model via LM Studio. Each provider is a worker you can install separately. Configure your API keys below; BFrost uses the cheapest model that can handle the task unless you specify otherwise.</HelpTip></h3>
                    <span>Local credential configuration</span>
                  </div>
                  <StatusPill tone={dashboard.integrations.openaiConfigured.ok || dashboard.integrations.anthropicConfigured.ok ? 'good' : 'warning'}>
                    {dashboard.integrations.openaiConfigured.ok || dashboard.integrations.anthropicConfigured.ok ? 'Configured' : 'Missing'}
                  </StatusPill>
                </div>

                <div className="stack-list compact">
                  <button
                    className={`run-item run-button job-row-button${selectedCoreConfigKey === 'platform-routing' ? ' selected' : ''}`}
                    type="button"
                    aria-pressed={selectedCoreConfigKey === 'platform-routing'}
                    onClick={() => {
                      setSelectedCoreConfigKey('platform-routing');
                      setSelectedConfigSurfaceKey(null);
                      setSelectedConfigJobName(null);
                    }}
                  >
                    <div>
                      <strong>Platform routing</strong>
                      <span>Active local LLM platform and primary channel for operator notifications.</span>
                      <span>{dashboard.platform.activeLocalProviderId} · {dashboard.platform.primaryChannelId}</span>
                    </div>
                    <StatusPill tone="muted">Setting</StatusPill>
                  </button>
                  <button
                    className={`run-item run-button job-row-button${selectedCoreConfigKey === 'cloud-api-keys' ? ' selected' : ''}`}
                    type="button"
                    aria-pressed={selectedCoreConfigKey === 'cloud-api-keys'}
                    onClick={() => {
                      setSelectedCoreConfigKey('cloud-api-keys');
                      setSelectedConfigSurfaceKey(null);
                      setSelectedConfigJobName(null);
                    }}
                  >
                    <div>
                      <strong>Cloud API keys</strong>
                      <span>OpenAI and Anthropic credentials for cloud model providers.</span>
                      <span>Stored locally in the environment configuration.</span>
                    </div>
                    <StatusPill tone="muted">Setting</StatusPill>
                  </button>
                  <button
                    className={`run-item run-button job-row-button${selectedCoreConfigKey === 'embedding-model' ? ' selected' : ''}`}
                    type="button"
                    aria-pressed={selectedCoreConfigKey === 'embedding-model'}
                    onClick={() => {
                      setSelectedCoreConfigKey('embedding-model');
                      setSelectedConfigSurfaceKey(null);
                      setSelectedConfigJobName(null);
                      void fetchLocalEmbeddingModels();
                    }}
                  >
                    <div>
                      <strong>Embedding model</strong>
                      <span>Provider and model used for long-term memory embeddings.</span>
                      <span>{dashboard?.platform.embeddingProvider ?? '—'} · {dashboard?.platform.embeddingModel ?? '—'}</span>
                    </div>
                    <StatusPill tone={dashboard?.dependencies.embeddingModelReachable.ok ? 'good' : 'warning'}>
                      {dashboard?.dependencies.embeddingModelReachable.ok ? 'Ready' : 'Not configured'}
                    </StatusPill>
                  </button>
                </div>
              </section>

              {configGroupsByWorker.map(({ worker, surfaces, jobs }) => (
                <section className="job-worker-group" key={`${worker.id}-config`}>
                  <div className="job-worker-head">
                    <div>
                      <p className="panel-kicker">{worker.builtIn ? 'Built-in worker' : 'Local worker'}</p>
                      <h3>{worker.displayName ?? worker.name}</h3>
                      <span>{worker.id}</span>
                    </div>
                    <StatusPill tone={workerHealthTone(worker.healthState)}>
                      {workerHealthLabel(worker.healthState)}
                    </StatusPill>
                  </div>

                  <div className="stack-list compact">
                    {surfaces.map((surface) => {
                      const key = configSurfaceKey(worker.id, surface.id);
                      return (
                        <button
                          className={`run-item run-button job-row-button${selectedConfigSurfaceKey === key ? ' selected' : ''}`}
                          key={key}
                          type="button"
                          aria-pressed={selectedConfigSurfaceKey === key}
                          onClick={() => {
                            setSelectedCoreConfigKey(null);
                            setSelectedConfigSurfaceKey(key);
                            setSelectedConfigJobName(null);
                          }}
                        >
                          <div>
                            <strong>{surface.label}</strong>
                            <span>{surface.description}</span>
                            <span>{surface.path ?? 'dashboard setting'}</span>
                          </div>
                          <StatusPill tone="muted">Setting</StatusPill>
                        </button>
                      );
                    })}

                    {jobs.map((job) => (
                      <button
                        className={`run-item run-button job-row-button${selectedConfigJob?.name === job.name ? ' selected' : ''}`}
                        key={`${job.name}-config`}
                        type="button"
                        aria-pressed={selectedConfigJob?.name === job.name}
                        onClick={() => {
                          setSelectedCoreConfigKey(null);
                          setSelectedConfigJobName(job.name);
                          setSelectedConfigSurfaceKey(null);
                        }}
                      >
                        <div>
                          <strong>{job.label}</strong>
                          <span>{job.description}</span>
                          <span>{jobConfigSummary(job)}</span>
                        </div>
                        <StatusPill tone="muted">Job</StatusPill>
                      </button>
                    ))}
                  </div>
                </section>
              ))}

              {configGroupsByWorker.length === 0 ? (
                <p className="empty-state">No worker-provided custom job settings are currently declared.</p>
              ) : null}
            </div>

            <aside className="queue-detail-column config-detail-column">
              <section className="detail-panel config-detail-panel">
                <div className="panel-head">
                  <div>
                    <p className="panel-kicker">Configuration</p>
                    <h2>{selectedCoreConfigKey === 'cloud-api-keys' ? 'Cloud API keys' : selectedCoreConfigKey === 'platform-routing' ? 'Platform routing' : selectedCoreConfigKey === 'embedding-model' ? 'Embedding model' : selectedConfigJob?.label ?? selectedConfigSurface?.surface.label ?? 'No item selected'}</h2>
                  </div>
                  {selectedCoreConfigKey ? <StatusPill tone="muted">Platform</StatusPill> : null}
                  {selectedConfigJob ? <StatusPill tone="muted">{selectedConfigJob.workerName}</StatusPill> : null}
                  {selectedConfigSurface ? <StatusPill tone="muted">{selectedConfigSurface.worker.name}</StatusPill> : null}
                </div>

                {selectedCoreConfigKey === 'cloud-api-keys' ? renderCloudApiKeysConfiguration() : null}
                {selectedCoreConfigKey === 'platform-routing' ? renderPlatformRoutingConfiguration() : null}
                {selectedCoreConfigKey === 'embedding-model' ? renderEmbeddingConfiguration() : null}
                {selectedConfigJob ? renderJobConfiguration(selectedConfigJob) : null}
                {selectedConfigSurface ? renderWorkerConfigurationSurface(selectedConfigSurface) : null}
                {!selectedCoreConfigKey && !selectedConfigJob && !selectedConfigSurface ? (
                  <p className="empty-state">Select a platform setting, worker setting, or configurable job row to edit settings.</p>
                ) : null}
              </section>
            </aside>
          </div>
        </section>
      ) : null}

      {activeWorkerTab ? activeWorkerTab.definition.render(workerViewContext) : null}

      {activeTab === 'workers' ? (
        <section className="panel tab-page">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">Workers</p>
              <h2>Installed capabilities <HelpTip>Every feature in BFrost is a worker. This list shows every worker that is installed — built-in ones that ship with BFrost and any community workers you have added. Toggle the switch to enable or disable a worker; a disabled worker stops running its jobs and exposing its tools.</HelpTip></h2>
            </div>
            <div className="panel-actions">
              <label className="file-picker">
                <input
                  type="file"
                  accept=".zip,application/zip"
                  onChange={(event) => setWorkerUploadFile(event.target.files?.[0] ?? null)}
                />
                {workerUploadFile ? workerUploadFile.name : 'Choose zip'}
              </label>
              <button
                type="button"
                disabled={busyKey === 'worker-upload' || !workerUploadFile}
                onClick={() => void uploadWorkerZip()}
              >
                Upload
              </button>
              <button
                type="button"
                disabled={busyKey === 'workers-rescan'}
                onClick={() =>
                  void mutate(
                    'workers-rescan',
                    '/api/workers/rescan',
                    { method: 'POST', body: JSON.stringify({}) },
                    'Local workers rescanned.',
                  )
                }
              >
                Rescan
              </button>
              <StatusPill tone="muted">{dashboard.workers.length} loaded</StatusPill>
            </div>
          </div>

          {dashboard.workerIssues.length > 0 ? (
            <div className="stack-list section-break">
              {dashboard.workerIssues.map((issue) => (
                <div className="summary-row" key={`${issue.sourcePath}-${issue.message}`}>
                  <div>
                    <strong>Worker manifest rejected</strong>
                    <span>{issue.sourcePath}</span>
                    <span>{issue.message}</span>
                  </div>
                  <StatusPill tone="warning">invalid</StatusPill>
                </div>
              ))}
            </div>
          ) : null}

          {dashboard.workers.length === 0 ? (
            <div className="empty-state">
              <p>No workers loaded.</p>
              <p className="footnote">
                BFrost ships with bundled workers (news, research, publishers, channels, providers).
                If none are showing here, click <strong>Rescan</strong> above. To add a community
                worker, drop its folder under <code>workers/local/</code> and rescan.
              </p>
            </div>
          ) : (
            renderWorkerGroups(dashboard.workers)
          )}
        </section>
      ) : null}

      {activeTab === 'store' ? renderStoreTab() : null}

      {activeTab === 'health' ? renderHealthTab() : null}

      {activeTab === 'actions' ? renderActionsTab() : null}

      {activeTab === 'system' && whatsNew && whatsNew.length > 0 ? (
        <section className="panel tab-page">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">Changelog</p>
              <h2>What's new</h2>
            </div>
          </div>
          <div className="detail-body">
            {whatsNew.map((entry) => (
              <div key={entry.version} className="whats-new-entry">
                <div className="whats-new-header">
                  <strong>v{entry.version}</strong>
                  <span className="whats-new-headline">{entry.headline}</span>
                  <span className="whats-new-date">{entry.date}</span>
                </div>
                <ul className="whats-new-list">
                  {entry.items.map((item, i) => (
                    <li key={i}>{item.replace(/\*\*(.*?)\*\*/g, '$1')}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {activeTab === 'system' ? (() => {
        const hasModel = dashboard.workers.some(
          (w) => w.kind === 'provider' && w.enabled && w.healthState === 'healthy',
        ) || dashboard.lmStudio?.running;
        const hasChannel = dashboard.workers.some((w) => w.kind === 'channel' && w.healthState === 'healthy');
        const hasEnabledWorker = dashboard.workers.some((w) => w.enabled && w.healthState === 'healthy');
        const hasRun = dashboard.cron.jobs.some((j) => j.lastStartedAt !== null && j.lastStartedAt !== undefined);
        const allDone = hasModel && hasChannel && hasEnabledWorker && hasRun;
        const steps = [
          { done: hasModel, label: 'Connect a model', detail: 'Configure a model provider — add a cloud API key or start your local AI runtime.', action: () => setActiveTab('config') },
          { done: hasChannel, label: 'Connect a channel', detail: 'Set up Telegram or Discord so BFrost can reach you.', action: () => setActiveTab('channels') },
          { done: hasEnabledWorker, label: 'Enable a worker', detail: 'Turn on a worker from the Workers tab — try the News Digest.', action: () => setActiveTab('workers') },
          { done: hasRun, label: 'Let a job run', detail: 'Trigger a job manually from the Jobs tab, or wait for the scheduler.', action: () => setActiveTab('jobs') },
        ];
        return (
          <section className="panel tab-page">
            <div className="panel-head">
              <div>
                <p className="panel-kicker">Setup</p>
                <h2>Getting started</h2>
              </div>
              {allDone ? <StatusPill tone="good">All done ✓</StatusPill> : <StatusPill tone="info">{steps.filter((s) => s.done).length}/{steps.length} complete</StatusPill>}
            </div>
            <div className="detail-body">
              <ol className="getting-started-list">
                {steps.map((step, i) => (
                  <li key={i} className={`getting-started-step ${step.done ? 'done' : ''}`}>
                    <span className="step-check">{step.done ? '✓' : (i + 1)}</span>
                    <div>
                      <strong>{step.label}</strong>
                      <span className="footnote">{step.detail}</span>
                    </div>
                    {!step.done ? (
                      <button type="button" onClick={step.action}>Go →</button>
                    ) : null}
                  </li>
                ))}
              </ol>
              <p className="footnote" style={{ marginTop: '0.75rem' }}>
                You can return to this checklist any time from the System tab. Nothing is permanent — enable or disable workers freely.
              </p>
              <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="primary"
                  onClick={() => setWizardOpen(true)}
                >
                  Open setup wizard
                </button>
              </div>
            </div>
          </section>
        );
      })() : null}

      {activeTab === 'system' ? (
        <section className="panel tab-page">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">System</p>
              <h2>Runtime readiness <HelpTip>Shows whether BFrost's required services are running and configured — the AI model, any connected channels (Telegram, Discord), and the local database. A yellow "missing" pill means a credential or dependency is not yet set up; click the Config tab to fix it.</HelpTip></h2>
            </div>
          </div>

          <div className="panel-head section-break">
            <div>
              <p className="panel-kicker">Dependencies</p>
              <h2>Local runtime readiness <HelpTip>Optional tools that some workers need. LM Studio lets you run AI models locally without sending data to the cloud. sqlite3 and ffmpeg are used by a few workers for data storage and audio processing. Missing items are only a problem if a worker that needs them is enabled.</HelpTip></h2>
            </div>
          </div>

          <div className="stack-list">
            <HealthRow label="LM Studio CLI" status={dashboard.dependencies.lmStudioCli} />
            <HealthRow label="sqlite3" status={dashboard.dependencies.sqliteCli} />
            <HealthRow label="ffmpeg" status={dashboard.dependencies.ffmpeg} />
            <HealthRow label="whisper-cli" status={dashboard.dependencies.whisperCli} />
            <HealthRow label="Whisper model" status={dashboard.dependencies.whisperModel} />
            <HealthRow label="Embedding model" status={dashboard.dependencies.embeddingModelReachable} />
          </div>

          <div className="panel-head section-break">
            <div>
              <p className="panel-kicker">Backups</p>
              <h2>Backups &amp; database <HelpTip>BFrost stores everything — queue items, events, worker settings, run history — in a single SQLite file on your machine. Enable automatic daily backups here; use the Restore button next to any snapshot to roll back. This is the easiest way to recover from a mistake.</HelpTip></h2>
            </div>
            <StatusPill tone={dashboard.backups.length > 0 ? 'good' : 'warning'}>
              {dashboard.backups.length} backups
            </StatusPill>
          </div>

          {/* Auto-backup settings */}
          {autoBackupSettings ? (
            <div className="form-grid" style={{ marginBottom: '0.75rem' }}>
              <label className="field">
                <span>Automatic daily backup</span>
                <select
                  value={autoBackupSettings.enabled ? 'yes' : 'no'}
                  onChange={(e) => void saveAutoBackup({ enabled: e.target.value === 'yes' })}
                  disabled={busyKey === 'auto-backup-settings'}
                >
                  <option value="no">Off</option>
                  <option value="yes">On — every day at 03:00</option>
                </select>
              </label>
              {autoBackupSettings.enabled ? (
                <label className="field">
                  <span>Keep backups for (days)</span>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={autoBackupSettings.retentionDays}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (v >= 1 && v <= 365) {
                        setAutoBackupSettings((prev) => prev ? { ...prev, retentionDays: v } : prev);
                      }
                    }}
                    onBlur={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (v >= 1 && v <= 365) void saveAutoBackup({ retentionDays: v });
                    }}
                    disabled={busyKey === 'auto-backup-settings'}
                  />
                </label>
              ) : null}
            </div>
          ) : null}

          <div className="panel-actions wrap">
            <button
              className="primary"
              disabled={busyKey === 'create-backup'}
              onClick={() =>
                void mutate(
                  'create-backup',
                  '/api/backups',
                  { method: 'POST', body: JSON.stringify({}) },
                  'SQLite backup created.',
                )
              }
            >
              {busyKey === 'create-backup' ? 'Creating...' : 'Create backup'}
            </button>
          </div>

          <div className="stack-list compact">
            {dashboard.backups.map((backup) => (
              <div className="backup-row" key={backup.file}>
                <div>
                  <strong>
                    {backup.file}
                    {backup.restorePending ? (
                      <span className="status-pill warning" style={{ marginLeft: '0.5rem' }}>Restore pending</span>
                    ) : null}
                  </strong>
                  <span>{formatBytes(backup.sizeBytes)} · {formatDate(backup.createdAt)}</span>
                  <span>{backup.path}</span>
                </div>
                <div className="panel-actions" style={{ flexShrink: 0 }}>
                  {backup.restorePending ? (
                    <button type="button" onClick={() => void cancelRestore()}>
                      Cancel restore
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busyKey === `restore-${backup.file}`}
                      onClick={() => void restoreBackup(backup.file)}
                    >
                      {busyKey === `restore-${backup.file}` ? 'Scheduling...' : 'Restore'}
                    </button>
                  )}
                </div>
              </div>
            ))}
            {dashboard.backups.length === 0 ? (
              <div className="empty-state">
                <p>No backups yet.</p>
                <p className="footnote">
                  A backup is a snapshot of your local BFrost database — workers, settings,
                  queue, events, and run history. Click <strong>Create backup</strong> above to
                  make your first one; backups stay on this machine.
                </p>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {activeTab === 'system' ? (
        <section className="panel tab-page">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">Danger zone</p>
              <h2>Factory reset <HelpTip>Use this when something is badly broken and you want a fresh start. You can choose what to wipe: worker state (job history, queue, notes), credentials (API keys), or both. The app restarts automatically afterward. This cannot be undone — take a backup first.</HelpTip></h2>
            </div>
          </div>
          <div className="detail-body">
            <div className="danger-zone-row">
              <div>
                <strong>Safe mode</strong>
                <span className="footnote">Opens the dashboard with all workers disabled. Re-enable them one at a time to diagnose a broken worker.</span>
              </div>
              <button type="button" onClick={() => { window.location.href = '/?safe=1'; }}>
                Restart in Safe Mode
              </button>
            </div>
            <p className="footnote" style={{ marginTop: '1rem' }}>
              Choose what to erase. <strong>Worker state</strong> includes all jobs, queue items, run
              history, and worker settings. <strong>Credentials</strong> removes all stored API keys.
              <strong> Backups</strong> deletes all local backup files. This cannot be undone.
            </p>
            <div className="factory-reset-checks">
              {(['wipeWorkerState', 'wipeCredentials', 'wipeBackups'] as const).map((key) => (
                <label key={key} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={resetChecks[key]}
                    onChange={(e) => setResetChecks((c) => ({ ...c, [key]: e.target.checked }))}
                  />
                  {key === 'wipeWorkerState' ? 'Worker state (queue, runs, settings)' :
                   key === 'wipeCredentials' ? 'Credentials (API keys)' :
                   'Backups (all local backup files)'}
                </label>
              ))}
            </div>
            {!resetConfirmOpen ? (
              <button
                type="button"
                className="btn-danger"
                disabled={!resetChecks.wipeWorkerState && !resetChecks.wipeCredentials && !resetChecks.wipeBackups}
                onClick={() => setResetConfirmOpen(true)}
              >
                Reset…
              </button>
            ) : (
              <div className="factory-reset-confirm">
                <p><strong>Are you sure?</strong> This will permanently delete the selected data and exit BFrost. You must restart it manually.</p>
                <div className="panel-actions">
                  <button
                    type="button"
                    className="btn-danger"
                    disabled={busyKey === 'factory-reset'}
                    onClick={() => void executeFactoryReset()}
                  >
                    {busyKey === 'factory-reset' ? 'Resetting…' : 'Yes, reset and exit'}
                  </button>
                  <button type="button" onClick={() => setResetConfirmOpen(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      ) : null}

      {activeTab === 'system' ? (
        <section className="panel tab-page">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">Event history</p>
              <h2>Recent operations <HelpTip>The full event log for this session — every action BFrost has taken across all workers. Use the search box above to filter by category or keyword. The most recent events are shown first.</HelpTip></h2>
            </div>
            <StatusPill tone="muted">{dashboard.events.length} events</StatusPill>
          </div>

          <div className="stack-list">
            {dashboard.events.map((event) => (
              <div className="event-row" key={event.id}>
                <div>
                  <strong>{event.summary}</strong>
                  <span>
                    {event.category} / {event.action} · {formatDate(event.createdAt)}
                  </span>
                </div>
                <StatusPill tone={eventSeverityTone(event.severity)}>{event.severity}</StatusPill>
              </div>
            ))}
            {dashboard.events.length === 0 ? (
              <div className="empty-state">
                <p>No events recorded yet.</p>
                <p className="footnote">
                  Every job run, worker change, queue update, and credential edit shows up here as a
                  durable record. Enable a worker and trigger a run to populate this list.
                </p>
                <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
                  <button type="button" onClick={() => setActiveTab('workers')}>
                    Open Workers
                  </button>
                  <button type="button" onClick={() => setActiveTab('jobs')}>
                    Open Jobs
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {activeTab === 'system' ? (
        <section className="panel tab-page">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">Privacy</p>
              <h2>Zero telemetry</h2>
            </div>
            <StatusPill tone="good">Local-only</StatusPill>
          </div>
          <div className="detail-body">
            <p className="footnote">
              BFrost collects <strong>no telemetry, no usage data, and no analytics</strong> — not even
              crash reports. All data (workers, queue, events, conversations, credentials) stays on your
              machine in <code>data/</code>. The only outbound connections BFrost makes are the ones you
              explicitly configure: AI provider API calls, channel messages, and optional store catalog
              lookups (which are opt-in when you open the Store tab).
            </p>
            <p className="footnote">
              Cloud provider API keys are stored in the local <code>.env</code> file and sent only to
              the respective provider (OpenAI, Anthropic). They are never sent to bfrost.net or any
              third-party service.
            </p>
          </div>
        </section>
      ) : null}
      </main>

      {/* First-run wizard overlay */}
      {wizardOpen && dashboard ? (
        <Wizard
          dashboard={dashboard}
          onDismiss={() => {
            setWizardOpen(false);
            void fetch('/api/wizard/state', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ completed: true }),
            });
          }}
          onComplete={() => {
            setWizardOpen(false);
            void fetchDashboard(true);
          }}
          onRefreshDashboard={() => fetchDashboard(true)}
          onNavigate={(tab) => {
            setWizardOpen(false);
            setActiveTab(tab as CoreDashboardTab);
          }}
        />
      ) : null}
    </div>
  );

  function renderModelPanel() {
    const providersInUse = Array.from(new Set(dashboard.models.map((model) => model.provider)));
    const currentModel =
      dashboard.models.find((model) => model.alias === selectedModelAlias) ?? dashboard.defaultModel;
    const selectedProvider = currentModel.provider;
    const modelsForProvider = dashboard.models.filter((model) => model.provider === selectedProvider);

    function changeProvider(nextProvider: string) {
      const firstForProvider = dashboard.models.find((model) => model.provider === nextProvider);
      if (firstForProvider) setSelectedModelAlias(firstForProvider.alias);
    }

    return (
      <article className="panel">
        <div className="panel-head">
          <div>
            <p className="panel-kicker">Default model</p>
            <h2>Assistant baseline</h2>
          </div>
          <StatusPill tone="info">{dashboard.defaultModel.label}</StatusPill>
        </div>

        <div className="form-grid">
          <label className="field">
            <span>Provider</span>
            <select
              value={selectedProvider}
              onChange={(event) => changeProvider(event.target.value)}
            >
              {providersInUse.map((provider) => (
                <option key={provider} value={provider}>
                  {providerLabel(provider, dashboard.workers)}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Model</span>
            <select
              value={selectedModelAlias}
              onChange={(event) => setSelectedModelAlias(event.target.value)}
              disabled={modelsForProvider.length === 0}
            >
              {modelsForProvider.length === 0 ? (
                <option value="">(no models available for this provider)</option>
              ) : null}
              {modelsForProvider.map((model) => (
                <option key={model.alias} value={model.alias}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <p className="footnote">
          Pick the provider first, then the model. Cloud provider lists are refreshed from the API
          when you save an API key; local lists come from your active runtime.
        </p>

        <div className="panel-actions">
          <button
            className="primary"
            disabled={busyKey === 'save-model'}
            onClick={() =>
              void mutate(
                'save-model',
                '/api/default-model',
                {
                  method: 'POST',
                  body: JSON.stringify({ alias: selectedModelAlias }),
                },
                'Default model updated.',
              )
            }
          >
            {busyKey === 'save-model' ? 'Saving...' : 'Save default model'}
          </button>
        </div>
      </article>
    );
  }

  function renderQueueDetail(item: QueueItem) {
    const workerDetails = workerQueueItemDetails(item as any);
    return (
      <div className="detail-body">
        <a className="detail-title" href={item.url} target="_blank" rel="noreferrer">
          {item.title}
        </a>
        <p>{item.shortDesc}</p>

        <div className="detail-grid">
          <Detail label="Host" value={safeHost(item.url)} />
          <Detail label="Producer" value={item.producerWorkerId ?? 'n/a'} />
          <Detail label="Item type" value={item.itemType ?? 'n/a'} />
          <Detail label="Added" value={formatDate(item.addedAt)} />
          <Detail label="State changed" value={formatDate(item.stateChangedAt)} />
          <Detail label="Attempts" value={String(item.attemptCount ?? 0)} />
          <Detail label="Last attempt" value={formatDate(item.lastAttemptAt ?? null)} />
          <Detail label="Posted" value={formatDate(item.postedAt ?? null)} />
        </div>

        <DetailBlock label="State reason" value={item.stateReason} />
        <DetailBlock label="Selection reason" value={item.selectionReason} />
        <DetailBlock label="Rejection reason" value={item.rejectionReason} />
        <DetailBlock label="Last error" value={item.lastError} tone="error" />

        {workerDetails.map((entry) => (
          <div key={entry.workerId}>{entry.node}</div>
        ))}

        <div className="panel-actions wrap">
          {(item.state === 'queued' || item.state === 'failed') ? (
            <button
              className="primary"
              disabled={busyKey === `approve-${item.id}`}
              onClick={() => void updateQueueItem(item.id, 'approve')}
            >
              Approve
            </button>
          ) : null}
          {item.state !== 'posted' && item.state !== 'rejected' ? (
            <button
              disabled={busyKey === `reject-${item.id}`}
              onClick={() => void updateQueueItem(item.id, 'reject')}
            >
              Reject
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  function renderJobOperations(job: SchedulerJobState, runs: SchedulerRunRecord[]) {
    const draft = jobDrafts[job.name] ?? {
      enabled: job.enabled,
      cron: job.cron,
      modelAlias: job.modelAlias,
      approvalRequired: job.approvalRequired,
      prompt: job.prompt,
      params: buildJobParamsDraft(job),
    };

    return (
      <div className="detail-body">
        {!job.workerEnabled ? <p className="error-box">Worker disabled. Enable it from Workers to run this job.</p> : null}

        <div className="job-grid standard-job-grid">
          <label className="field checkbox">
            <span>Enabled</span>
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) =>
                setJobDrafts((current) => ({
                  ...current,
                  [job.name]: { ...draft, enabled: event.target.checked },
                }))
              }
            />
          </label>

          <label className="field">
            <span>Cron expression</span>
            <input
              type="text"
              value={draft.cron}
              onChange={(event) =>
                setJobDrafts((current) => ({
                  ...current,
                  [job.name]: { ...draft, cron: event.target.value },
                }))
              }
            />
          </label>

          <label className="field">
            <span>Model override</span>
            <select
              value={draft.modelAlias}
              onChange={(event) =>
                setJobDrafts((current) => ({
                  ...current,
                  [job.name]: { ...draft, modelAlias: event.target.value },
                }))
              }
            >
              <option value="">Use default model</option>
              {dashboard.models.map((model) => (
                <option key={model.alias} value={model.alias}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>

          {job.approvalRequiredEditable ? (
            <label className="field checkbox">
              <span>Require approval</span>
              <input
                type="checkbox"
                checked={draft.approvalRequired}
                onChange={(event) =>
                  setJobDrafts((current) => ({
                    ...current,
                    [job.name]: { ...draft, approvalRequired: event.target.checked },
                  }))
                }
              />
            </label>
          ) : null}
        </div>

        {/* Preview-before-save confirmation panel */}
        {confirmSaveJobName === job.name ? (() => {
          const changes: Array<{ field: string; from: string; to: string }> = [];
          if (draft.enabled !== job.enabled)
            changes.push({ field: 'Enabled', from: job.enabled ? 'Yes' : 'No', to: draft.enabled ? 'Yes' : 'No' });
          if (draft.cron !== job.cron)
            changes.push({ field: 'Schedule', from: job.cron, to: draft.cron });
          if (draft.modelAlias !== job.modelAlias)
            changes.push({ field: 'Model', from: job.modelAlias || '(platform default)', to: draft.modelAlias || '(platform default)' });
          if (draft.approvalRequired !== job.approvalRequired)
            changes.push({ field: 'Require approval', from: job.approvalRequired ? 'Yes' : 'No', to: draft.approvalRequired ? 'Yes' : 'No' });
          return (
            <div className="schedule-preview-box" role="region" aria-label="Review changes before saving" aria-live="polite">
              <p className="schedule-preview-title">Review changes before saving</p>
              {changes.length === 0 ? (
                <p className="schedule-preview-no-changes">No changes to save.</p>
              ) : (
                <table className="schedule-preview-table">
                  <thead>
                    <tr><th>Field</th><th>Current</th><th>New value</th></tr>
                  </thead>
                  <tbody>
                    {changes.map((c) => (
                      <tr key={c.field}>
                        <td>{c.field}</td>
                        <td className="schedule-preview-old">{c.from}</td>
                        <td className="schedule-preview-new">{c.to}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="panel-actions wrap" style={{ marginTop: '0.5rem' }}>
                <button
                  className="primary"
                  disabled={busyKey === `save-${job.name}` || changes.length === 0}
                  onClick={() => {
                    setConfirmSaveJobName(null);
                    void mutate(
                      `save-${job.name}`,
                      `/api/cron-jobs/${job.name}`,
                      {
                        method: 'POST',
                        body: JSON.stringify({
                          enabled: draft.enabled,
                          cron: draft.cron,
                          modelAlias: draft.modelAlias,
                          approvalRequired: draft.approvalRequired,
                        }),
                      },
                      `${job.label} schedule saved.`,
                    );
                  }}
                >
                  {busyKey === `save-${job.name}` ? 'Saving…' : 'Confirm save'}
                </button>
                {/* autoFocus moves keyboard focus to this panel when it mounts */}
                <button type="button" autoFocus onClick={() => setConfirmSaveJobName(null)}>
                  Cancel
                </button>
              </div>
            </div>
          );
        })() : null}

        <div className="panel-actions wrap">
          <button
            className="primary"
            disabled={jobDrafts[job.name] === undefined || confirmSaveJobName === job.name}
            onClick={() => setConfirmSaveJobName(job.name)}
          >
            Save schedule
          </button>
          <button
            disabled={busyKey === `run-${job.name}` || job.running || !job.workerEnabled}
            onClick={() =>
              void triggerRun(
                `run-${job.name}`,
                `/api/cron-jobs/${job.name}/run`,
                `${job.label} started.`,
              )
            }
          >
            {job.running ? 'Running...' : 'Run now'}
          </button>
          {jobDrafts[job.name] !== undefined ? (
            <button
              type="button"
              onClick={() => {
                setConfirmSaveJobName(null);
                setJobDrafts((current) => {
                  const next = { ...current };
                  delete next[job.name];
                  return next;
                });
              }}
            >
              Discard changes
            </button>
          ) : null}
        </div>

        {renderJobDetail(job, runs)}
      </div>
    );
  }

  function renderJobConfiguration(job: SchedulerJobState) {
    const draft = jobDrafts[job.name] ?? {
      enabled: job.enabled,
      cron: job.cron,
      modelAlias: job.modelAlias,
      approvalRequired: job.approvalRequired,
      prompt: job.prompt,
      params: buildJobParamsDraft(job),
    };
    const promptEditorOpen = openPromptEditors[job.name] ?? false;

    function applyPreset(preset: JobPreset) {
      setJobDrafts((current) => ({
        ...current,
        [job.name]: {
          ...draft,
          cron: preset.cron ?? draft.cron,
          params: { ...(draft.params ?? {}), ...(preset.params ?? {}) },
        },
      }));
    }

    return (
      <div className="detail-body">
        {job.presets.length > 0 ? (
          <div className="panel-actions wrap" style={{ marginBottom: '0.75rem' }}>
            <span className="footnote" style={{ marginRight: '0.25rem' }}>Recipes:</span>
            {job.presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                title={preset.description}
                onClick={() => applyPreset(preset)}
              >
                {preset.label}
              </button>
            ))}
            <span className="footnote" style={{ flexBasis: '100%', marginTop: '0.25rem' }}>
              Click a recipe to fill the form. Nothing saves until you press Save below.
            </span>
          </div>
        ) : null}

        <div className="job-grid config-field-grid">
          <label className="field">
            <span>Model override</span>
            <select
              value={draft.modelAlias}
              onChange={(event) =>
                setJobDrafts((current) => ({
                  ...current,
                  [job.name]: { ...draft, modelAlias: event.target.value },
                }))
              }
            >
              <option value="">Use default model</option>
              {dashboard.models.map((model) => (
                <option key={model.alias} value={model.alias}>
                  {model.label}
                </option>
              ))}
            </select>
            <small>Pick a model just for this job. Leave blank to follow the platform default.</small>
          </label>
          {job.dashboardFields.map((field) => renderJobParamField(job, draft, field))}
        </div>

        {job.promptEditable ? (
          <section className="advanced-settings">
            <button
              type="button"
              className="advanced-settings-toggle"
              aria-expanded={promptEditorOpen}
              onClick={() =>
                setOpenPromptEditors((current) => ({
                  ...current,
                  [job.name]: !promptEditorOpen,
                }))
              }
            >
              <span>
                <strong>Advanced writing instructions</strong>
                <small>Keep this closed to use the saved prompt.</small>
              </span>
              <span aria-hidden="true">{promptEditorOpen ? 'Hide' : 'Edit'}</span>
            </button>
            {promptEditorOpen ? (
              <label className="field prompt-field advanced-prompt-field">
                <span>Writing instructions</span>
                <textarea
                  value={draft.prompt}
                  onChange={(event) =>
                    setJobDrafts((current) => ({
                      ...current,
                      [job.name]: { ...draft, prompt: event.target.value },
                    }))
                  }
                  rows={13}
                />
                {job.promptHelpText ? <small>{job.promptHelpText}</small> : null}
                {job.promptExamples && job.promptExamples.length > 0 ? (
                  <div className="prompt-examples">
                    <small>Start from an example:</small>
                    <div className="prompt-example-chips">
                      {job.promptExamples.map((ex) => (
                        <button
                          key={ex.label}
                          type="button"
                          className="chip"
                          title={ex.description}
                          onClick={() =>
                            setJobDrafts((current) => ({
                              ...current,
                              [job.name]: { ...draft, prompt: ex.value },
                            }))
                          }
                        >
                          {ex.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <button
                  type="button"
                  className="secondary-inline"
                  onClick={() =>
                    setJobDrafts((current) => ({
                      ...current,
                      [job.name]: { ...draft, prompt: job.prompt },
                    }))
                  }
                >
                  Restore saved instructions
                </button>
              </label>
            ) : null}
          </section>
        ) : null}

        <div className="panel-actions wrap">
          <button
            className="primary"
            disabled={busyKey === `config-${job.name}`}
            onClick={() =>
              void mutate(
                `config-${job.name}`,
                `/api/cron-jobs/${job.name}`,
                {
                  method: 'POST',
                  body: JSON.stringify({
                    modelAlias: draft.modelAlias,
                    prompt: draft.prompt,
                    params: serializeJobParams(job, draft),
                  }),
                },
                `${job.label} configuration saved.`,
              )
            }
          >
            Save configuration
          </button>
          {jobDrafts[job.name] !== undefined ? (
            <button
              type="button"
              onClick={() =>
                setJobDrafts((current) => {
                  const next = { ...current };
                  delete next[job.name];
                  return next;
                })
              }
            >
              Discard changes
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  function renderChannelsTab() {
    const channelWorkers = dashboard!.workers.filter((w) => w.kind === 'channel');

    if (channelWorkers.length === 0) {
      return (
        <section className="panel tab-page">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">Communication channels</p>
              <h2>Channels <HelpTip>Channels are how BFrost delivers your content and receives your commands. Telegram lets you get a daily news digest as a message; Discord does the same. The dashboard chat is always available as a built-in channel. Enable a channel worker from the Workers tab, then connect it here.</HelpTip></h2>
            </div>
          </div>
          <p className="empty-state">
            No channel workers are installed. Enable a channel worker (Telegram, Discord, …) from the Workers tab to connect it here.
          </p>
        </section>
      );
    }

    return (
      <section className="panel tab-page">
        <div className="panel-head">
          <div>
            <p className="panel-kicker">Communication channels</p>
            <h2>Channels <HelpTip>Channels are how BFrost delivers your content and receives your commands. Telegram lets you get a daily news digest as a message; Discord does the same. The dashboard chat is always available as a built-in channel. Enable a channel worker from the Workers tab, then connect it here.</HelpTip></h2>
          </div>
          <StatusPill tone="muted">
            {`${channelWorkers.filter((w) => w.healthState === 'healthy').length}/${channelWorkers.length} connected`}
          </StatusPill>
        </div>

        <div className="stack-list channel-list">
          {channelWorkers.map((worker) => {
            const isConnected = worker.healthState === 'healthy';
            const isOpen = expandedChannelId === worker.id;
            const connectView = dashboardViews.find(
              (v) => v.workerId === worker.id && v.kind === 'channel-connect',
            );

            return (
              <div key={worker.id} className={`channel-card${isOpen ? ' open' : ''}`}>
                <button
                  type="button"
                  className="channel-card-head run-button"
                  aria-expanded={isOpen}
                  onClick={() => setExpandedChannelId(isOpen ? null : worker.id)}
                >
                  <div className="channel-card-meta">
                    <strong>{worker.displayName ?? worker.name}</strong>
                    <span>{worker.tagline ?? worker.description}</span>
                  </div>
                  <div className="channel-card-actions">
                    <StatusPill tone={isConnected ? 'good' : 'warning'}>
                      {isConnected ? 'Connected' : 'Setup needed'}
                    </StatusPill>
                    <span className="channel-card-caret" aria-hidden="true">{isOpen ? '▲' : '▼'}</span>
                  </div>
                </button>

                {isOpen ? (
                  <div className="channel-card-body">
                    {connectView ? (
                      connectView.render({ onSaved: () => void fetchDashboard(true) })
                    ) : (
                      <p className="empty-state">
                        This channel worker has no guided setup panel. Configure it from the Config tab.
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  function renderWorkerGroups(workers: WorkerSummary[]) {
    const groups: Array<{ kind: WorkerKind; label: string; description: string }> = [
      { kind: 'provider', label: 'LLM Platforms', description: 'Model runtimes. One local platform is active at a time; cloud platforms coexist.' },
      { kind: 'channel', label: 'Channels', description: 'Communication adapters. Any can run; one is designated as the primary recipient for operator notifications.' },
      { kind: 'feature', label: 'Features', description: 'Job and tool workers (news, publishers, research, …).' },
    ];

    return (
      <div className="stack-list">
        {groups.map((group) => {
          const groupWorkers = workers.filter((worker) => worker.kind === group.kind);
          if (groupWorkers.length === 0) return null;
          return (
            <div className="stack-list" key={group.kind}>
              <div className="panel-head section-break">
                <div>
                  <p className="panel-kicker">{group.label}</p>
                  <span className="footnote">{group.description}</span>
                </div>
                <StatusPill tone="muted">{groupWorkers.length}</StatusPill>
              </div>
              {groupWorkers.map((worker) => renderWorkerRow(worker))}
            </div>
          );
        })}
      </div>
    );
  }

  function renderWorkerRow(worker: WorkerSummary) {
    return (
      <div className="summary-row" key={worker.id}>
        <div>
          <strong>{worker.displayName ?? worker.name}</strong>
          <span>{worker.tagline ?? worker.description}</span>
          <span>
            {worker.id} · v{worker.version} · {worker.builtIn ? 'built-in' : 'local'} ·{' '}
            {worker.enabledJobCount}/{worker.jobCount} jobs enabled
          </span>
          {worker.sourcePath ? <span>{worker.sourcePath}</span> : null}
        </div>
        <div className="panel-actions">
          <StatusPill tone={workerHealthTone(worker.healthState)}>
            {worker.runningJobCount > 0 ? 'running' : workerHealthLabel(worker.healthState)}
          </StatusPill>
          {storeUpdates.has(worker.id) ? (
            <StatusPill tone="info">v{storeUpdates.get(worker.id)} available</StatusPill>
          ) : null}
          <button
            type="button"
            disabled={busyKey === `worker-${worker.id}` || (worker.missing && !worker.enabled)}
            onClick={() =>
              void mutate(
                `worker-${worker.id}`,
                `/api/workers/${encodeURIComponent(worker.id)}`,
                { method: 'POST', body: JSON.stringify({ enabled: !worker.enabled }) },
                `${worker.name} worker ${worker.enabled ? 'disabled' : 'enabled'}.`,
              )
            }
          >
            {worker.enabled ? 'Disable' : 'Enable'}
          </button>
          <button
            type="button"
            disabled={busyKey === `worker-delete-${worker.id}` || (worker.builtIn && !worker.deletable) || worker.enabled}
            onClick={() => void deleteWorker(worker)}
          >
            Delete
          </button>
        </div>
      </div>
    );
  }

  function renderPlatformRoutingConfiguration() {
    const providers = dashboard.availableLocalProviders;
    const channels = dashboard.availableChannels;
    const activeProviderValue = activeLocalProviderDraft || dashboard.platform.activeLocalProviderId;
    const primaryChannelValue = primaryChannelDraft || dashboard.platform.primaryChannelId;
    const dirty =
      (activeLocalProviderDraft && activeLocalProviderDraft !== dashboard.platform.activeLocalProviderId) ||
      (primaryChannelDraft && primaryChannelDraft !== dashboard.platform.primaryChannelId);

    return (
      <div className="detail-body">
        <p className="footnote">
          Pick which installed component drives each platform role. Switching does not enable or disable workers —
          enable/disable lives in the Workers tab.
        </p>

        <div className="form-grid">
          <label className="field">
            <span>Active local LLM platform</span>
            <select
              value={activeProviderValue}
              onChange={(event) => setActiveLocalProviderDraft(event.target.value)}
            >
              {providers.length === 0 ? <option value="">(no local providers installed)</option> : null}
              {providers.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label} ({entry.id})
                </option>
              ))}
            </select>
            <span className="footnote">
              Used by cron jobs and the assistant when running local models. Cloud models keep using their per-model provider.
            </span>
          </label>

          <label className="field">
            <span>Primary channel for notifications</span>
            <select
              value={primaryChannelValue}
              onChange={(event) => setPrimaryChannelDraft(event.target.value)}
            >
              {channels.length === 0 ? <option value="">(no channels installed)</option> : null}
              {channels.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label} ({entry.id})
                </option>
              ))}
            </select>
            <span className="footnote">
              Outbound operator notifications (cron-run outcomes, errors) go here. Inbound user messages still flow through every enabled channel.
            </span>
          </label>
        </div>

        <div className="panel-actions">
          <button
            className="primary"
            disabled={busyKey === 'save-platform-routing' || !dirty}
            onClick={() => void savePlatformRouting()}
          >
            {busyKey === 'save-platform-routing' ? 'Saving...' : 'Save routing'}
          </button>
        </div>
      </div>
    );
  }

  function renderEmbeddingConfiguration() {
    const OPENAI_EMBEDDING_MODELS = [
      'text-embedding-3-large',
      'text-embedding-3-small',
      'text-embedding-ada-002',
    ];

    const current = dashboard?.platform;
    const providerValue = embeddingProviderDraft || current?.embeddingProvider || 'local';
    const modelValue = embeddingModelDraft || current?.embeddingModel || '';

    const dirty =
      (embeddingProviderDraft && embeddingProviderDraft !== current?.embeddingProvider) ||
      (embeddingModelDraft.trim() && embeddingModelDraft.trim() !== current?.embeddingModel);

    return (
      <div className="detail-body">
        <div className="stack-list compact">
          <HealthRow label="Embedding model reachable" status={dashboard?.dependencies.embeddingModelReachable ?? { ok: false, detail: 'Loading…' }} />
        </div>

        <p className="footnote">
          Choose the provider and model for long-term memory embeddings. Local models are served by your active LM Studio or Ollama instance and must support the embeddings endpoint.
        </p>

        <div className="form-grid">
          <label className="field">
            <span>Embedding provider</span>
            <select
              value={providerValue}
              onChange={(event) => {
                const p = event.target.value as 'local' | 'openai';
                setEmbeddingProviderDraft(p);
                setEmbeddingModelDraft('');
                if (p === 'local') void fetchLocalEmbeddingModels();
              }}
            >
              <option value="local">Local (LM Studio / Ollama)</option>
              <option value="openai">OpenAI</option>
            </select>
          </label>

          <label className="field">
            <span>Embedding model</span>
            {providerValue === 'openai' ? (
              <select
                value={modelValue}
                onChange={(event) => setEmbeddingModelDraft(event.target.value)}
              >
                {OPENAI_EMBEDDING_MODELS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            ) : (
              <>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <select
                    value={modelValue}
                    onChange={(event) => setEmbeddingModelDraft(event.target.value)}
                    disabled={loadingEmbeddingModels}
                    style={{ flex: 1 }}
                  >
                    {loadingEmbeddingModels ? (
                      <option value="">Loading…</option>
                    ) : localEmbeddingModels === null || localEmbeddingModels.length === 0 ? (
                      <option value={modelValue}>{modelValue || '(no embedding models found)'}</option>
                    ) : null}
                    {!loadingEmbeddingModels && localEmbeddingModels?.map((m) => (
                      <option key={m.id} value={m.id}>{m.label !== m.id ? `${m.label} (${m.id})` : m.id}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={loadingEmbeddingModels}
                    onClick={() => void fetchLocalEmbeddingModels()}
                    title="Refresh model list from local provider"
                  >
                    {loadingEmbeddingModels ? '…' : '↻'}
                  </button>
                </div>
                <span className="footnote">
                  {localEmbeddingModels !== null && localEmbeddingModels.length > 0
                    ? `${localEmbeddingModels.length} embedding model${localEmbeddingModels.length === 1 ? '' : 's'} found. LM Studio: models with type "embedding"; Ollama: models with "embed" in the name.`
                    : localEmbeddingModels !== null && localEmbeddingModels.length === 0
                      ? 'No embedding models found. Make sure your local provider is running and has an embedding model installed, then click ↻.'
                      : 'Click ↻ to load available models from your local provider.'}
                </span>
              </>
            )}
          </label>
        </div>

        <div className="panel-actions">
          <button
            className="primary"
            disabled={busyKey === 'save-embedding-settings' || !dirty}
            onClick={() => void saveEmbeddingSettings()}
          >
            {busyKey === 'save-embedding-settings' ? 'Saving…' : 'Save embedding settings'}
          </button>
        </div>
      </div>
    );
  }

  function renderCloudApiKeysConfiguration() {
    return (
      <div className="detail-body">
        <div className="stack-list compact">
          <HealthRow label="OpenAI API" status={dashboard.integrations.openaiConfigured} />
          <HealthRow label="Anthropic API" status={dashboard.integrations.anthropicConfigured} />
        </div>

        <div className="form-grid">
          <div className="field">
            <span>OpenAI API key</span>
            <div className="secret-field-row">
              <input
                type={showOpenaiKey ? 'text' : 'password'}
                value={openaiApiKeyDraft}
                placeholder={dashboard.integrations.openaiConfigured.ok ? 'Configured (enter new key to update)' : 'Not configured'}
                autoComplete="off"
                onChange={(event) => setOpenaiApiKeyDraft(event.target.value)}
              />
              <button type="button" className="btn-icon" aria-label={showOpenaiKey ? 'Hide OpenAI key' : 'Show OpenAI key'} onClick={() => setShowOpenaiKey((v) => !v)}>
                {showOpenaiKey ? '🙈' : '👁'}
              </button>
              {openaiApiKeyDraft ? (
                <button type="button" className="btn-icon" aria-label="Copy OpenAI key" onClick={() => { void navigator.clipboard.writeText(openaiApiKeyDraft); setNotice('API key copied.'); }}>
                  📋
                </button>
              ) : null}
            </div>
          </div>
          <div className="field">
            <span>Anthropic API key</span>
            <div className="secret-field-row">
              <input
                type={showAnthropicKey ? 'text' : 'password'}
                value={anthropicApiKeyDraft}
                placeholder={dashboard.integrations.anthropicConfigured.ok ? 'Configured (enter new key to update)' : 'Not configured'}
                autoComplete="off"
                onChange={(event) => setAnthropicApiKeyDraft(event.target.value)}
              />
              <button type="button" className="btn-icon" aria-label={showAnthropicKey ? 'Hide Anthropic key' : 'Show Anthropic key'} onClick={() => setShowAnthropicKey((v) => !v)}>
                {showAnthropicKey ? '🙈' : '👁'}
              </button>
              {anthropicApiKeyDraft ? (
                <button type="button" className="btn-icon" aria-label="Copy Anthropic key" onClick={() => { void navigator.clipboard.writeText(anthropicApiKeyDraft); setNotice('API key copied.'); }}>
                  📋
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="panel-actions">
          <button
            className="primary"
            disabled={busyKey === 'save-cloud-api-keys' || (!openaiApiKeyDraft.trim() && !anthropicApiKeyDraft.trim())}
            onClick={() => void saveCloudApiKeys()}
          >
            {busyKey === 'save-cloud-api-keys' ? 'Saving...' : 'Save API keys'}
          </button>
        </div>
      </div>
    );
  }

  function renderWorkerConfigurationSurface({
    worker,
    surface,
  }: {
    worker: WorkerSummary;
    surface: WorkerDashboardSurface;
  }) {
    // Channel workers register a 'channel-connect' view that covers their credential
    // surface(s). Render it generically — no worker ids hard-coded here.
    const connectView = dashboardViews.find(
      (v) => v.workerId === worker.id && v.kind === 'channel-connect' && v.surfaceIds.includes(surface.id),
    );
    if (connectView) {
      return <>{connectView.render({ onSaved: () => void fetchDashboard(true) })}</>;
    }

    const key = configSurfaceKey(worker.id, surface.id);
    const fields = surface.fields ?? [];
    const draft = surfaceDrafts[key] ?? buildSurfaceDraft(surface, dashboard.workerData);
    const canPersist = Boolean(surface.path && !surface.path.includes('#'));
    const canSubmit = canPersist && surfaceDraftHasValue(fields, draft);

    if (fields.length === 0) {
      return (
        <div className="detail-body">
          <p className="empty-state">
            {worker.name} declares {surface.label}, but it does not expose manifest fields yet.
          </p>
        </div>
      );
    }

    return (
      <div className="detail-body">
        <div className="job-grid config-field-grid">
          {fields.map((field) =>
            renderDashboardField(
              field,
              draft[field.key] ?? fieldDefaultDraftValue(field, dashboard.workerData),
              (nextValue) => updateSurfaceDraftParam(key, field.key, nextValue),
              { draftKey: `${key}.${field.key}` },
            ),
          )}
        </div>

        <div className="panel-actions wrap">
          <button
            className="primary"
            disabled={busyKey === `config-surface-${key}` || !canSubmit}
            onClick={() => void saveWorkerConfigurationSurface(worker, surface)}
          >
            {busyKey === `config-surface-${key}` ? 'Saving...' : 'Save configuration'}
          </button>
          {surfaceDrafts[key] !== undefined ? (
            <button
              type="button"
              onClick={() =>
                setSurfaceDrafts((current) => {
                  const next = { ...current };
                  delete next[key];
                  return next;
                })
              }
            >
              Discard changes
            </button>
          ) : null}
          {!canPersist ? <span className="footnote">This manifest declares defaults, but no save endpoint.</span> : null}
        </div>
      </div>
    );
  }

  function renderJobDetail(job: SchedulerJobState, runs: SchedulerRunRecord[]) {
    const latestFinished = runs.find((run) => run.finishedAt);

    return (
      <div className="detail-body">
        <div className="detail-grid">
          <Detail label="Worker" value={`${job.workerName} (${job.workerId})`} />
          <Detail label="Worker type" value={job.workerBuiltIn ? 'built-in' : 'local'} />
          <Detail label="Enabled" value={job.enabled ? 'yes' : 'no'} />
          <Detail label="Cron" value={job.cron} />
          <Detail label="Effective model" value={job.effectiveModelAlias} />
          <Detail label="Last trigger" value={job.lastTrigger ?? 'n/a'} />
          <Detail label="Last started" value={formatDate(job.lastStartedAt)} />
          <Detail label="Last finished" value={formatDate(job.lastFinishedAt)} />
          <Detail label="Last duration" value={runDuration(latestFinished) ?? 'n/a'} />
          <Detail label="Stored runs" value={String(runs.length)} />
        </div>

        <DetailBlock label="Last summary" value={job.lastSummary ?? undefined} />
        <DetailBlock label="Last error" value={job.lastError ?? undefined} tone="error" />

        <div className="timeline">
          {runs.map((run) => (
            <div className={`timeline-event ${runSeverity(run)}`} key={run.id}>
              <div>
                <strong>{run.summary ?? runStatusSummary(run)}</strong>
                <span>{run.status} · {formatDate(run.startedAt)}</span>
                <span>{run.trigger} · {run.modelAlias}{typeof run.itemCount === 'number' ? ` · ${run.itemCount} items` : ''}{runDuration(run) ? ` · ${runDuration(run)}` : ''}</span>
                {run.error ? <RunError message={run.error} /> : null}
              </div>
              <StatusPill tone={runStatusTone(run.status)}>{run.status}</StatusPill>
            </div>
          ))}
          {runs.length === 0 ? (
            <div className="empty-state">
              <p>This job has not run yet.</p>
              <p className="footnote">
                Click <strong>Run now</strong> in the job row above to trigger it once, or wait for
                its next scheduled time. Runs appear here as soon as the job finishes.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  // ── Stuck detector banner ─────────────────────────────────────────────────

  function renderStuckDetectorBanner() {
    const STUCK_THRESHOLD = 3;
    const stuckJobs = dashboard.cron.jobs.filter(
      (j) => j.enabled && j.workerEnabled && (j.consecutiveErrors ?? 0) >= STUCK_THRESHOLD,
    );
    if (stuckJobs.length === 0) return null;

    return (
      <div className="stuck-detector-banner" role="alert">
        <strong>
          {stuckJobs.length === 1
            ? `"${stuckJobs[0].label}" has failed ${stuckJobs[0].consecutiveErrors} times in a row.`
            : `${stuckJobs.length} jobs are failing repeatedly.`}
        </strong>
        {' '}
        <span>Check credentials and model settings, then re-enable.</span>
        <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
          {stuckJobs.map((j) => (
            <button
              key={j.name}
              type="button"
              onClick={() => {
                setSelectedJobName(j.name);
                setActiveTab('jobs');
              }}
            >
              Fix "{j.label}"
            </button>
          ))}
        </div>
      </div>
    );
  }

  // ── Actions tab ───────────────────────────────────────────────────────────

  function renderSparkline(statuses: Array<'success' | 'error' | 'skipped'>) {
    if (statuses.length === 0) {
      return (
        <svg className="sparkline sparkline-empty" viewBox="0 0 100 16" aria-hidden="true">
          <line x1="0" y1="8" x2="100" y2="8" stroke="var(--border)" strokeWidth="1" strokeDasharray="3 3" />
        </svg>
      );
    }

    const count = statuses.length;
    const dotR = 3;
    const gap = 2;
    const dotStep = dotR * 2 + gap;
    const totalWidth = count * dotStep - gap;
    const viewW = Math.max(totalWidth, 100);

    const dots = statuses.map((s, i) => {
      const cx = i * dotStep + dotR;
      const cy = 8;
      const fill = s === 'success' ? 'var(--health-ok, #22c55e)'
        : s === 'error' ? 'var(--health-err, #ef4444)'
          : 'var(--health-skip, #a1a1aa)';
      return <circle key={i} cx={cx} cy={cy} r={dotR} fill={fill} />;
    });

    return (
      <svg
        className="sparkline"
        viewBox={`0 0 ${viewW} 16`}
        aria-label={`${statuses.filter((s) => s === 'success').length} of ${count} recent runs succeeded`}
        role="img"
      >
        {dots}
      </svg>
    );
  }

  function renderSuccessBar(rate: number | null, total: number) {
    if (rate === null || total === 0) {
      return <span className="success-rate-na footnote">—</span>;
    }
    const pct = Math.round(rate * 100);
    const color = pct >= 90 ? 'var(--health-ok, #22c55e)' : pct >= 70 ? 'var(--health-warn, #f59e0b)' : 'var(--health-err, #ef4444)';
    return (
      <span className="success-rate-pill" style={{ '--rate-color': color } as React.CSSProperties}>
        <span className="success-rate-bar" style={{ width: `${pct}%`, background: color }} />
        <span className="success-rate-label">{pct}%</span>
      </span>
    );
  }

  function renderDurationChip(label: string, ms: number | null) {
    if (ms === null) return null;
    const display = ms >= 60000
      ? `${(ms / 60000).toFixed(1)}m`
      : ms >= 1000
        ? `${(ms / 1000).toFixed(1)}s`
        : `${ms}ms`;
    return <span className="duration-chip footnote">{label} {display}</span>;
  }

  function renderHealthTab() {
    const isLoading = jobMetricsLoading && jobMetrics === null;
    const metrics = jobMetrics;

    // Summary aggregates
    const totalWorkers = metrics?.workers.length ?? 0;
    const overallSuccessRate = (() => {
      if (!metrics || metrics.windowRuns === 0) return null;
      const totalSuccess = metrics.workers.reduce(
        (s, w) => s + w.jobs.reduce((js, j) => js + j.successCount, 0), 0,
      );
      const totalCompleted = metrics.workers.reduce(
        (s, w) => s + w.jobs.reduce((js, j) => js + j.successCount + j.errorCount, 0), 0,
      );
      return totalCompleted > 0 ? totalSuccess / totalCompleted : null;
    })();
    const totalErrors = metrics?.workers.reduce(
      (s, w) => s + w.jobs.reduce((js, j) => js + j.errorCount, 0), 0,
    ) ?? 0;

    return (
      <div className="tab-content health-tab">
        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Observability</p>
              <h2>
                Health
                <HelpTip>
                  Computed from the last {metrics?.windowRuns ?? 200} scheduler run records.
                  Durations exclude skipped runs; percentile statistics require at least 5 completed runs.
                </HelpTip>
              </h2>
            </div>
            <button
              className="btn btn-sm"
              onClick={() => void fetchJobMetrics(true)}
              disabled={jobMetricsLoading}
              aria-label="Refresh health metrics"
            >
              {jobMetricsLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {/* Summary cards */}
          <div className="health-summary-row">
            <div className="health-summary-card">
              <span className="health-summary-value">{totalWorkers}</span>
              <span className="health-summary-label footnote">Workers with runs</span>
            </div>
            <div className="health-summary-card">
              <span className="health-summary-value">{metrics?.windowRuns ?? '—'}</span>
              <span className="health-summary-label footnote">Runs in window</span>
            </div>
            <div className="health-summary-card">
              <span
                className="health-summary-value"
                style={{
                  color: overallSuccessRate === null ? undefined
                    : overallSuccessRate >= 0.9 ? 'var(--health-ok, #22c55e)'
                      : overallSuccessRate >= 0.7 ? 'var(--health-warn, #f59e0b)'
                        : 'var(--health-err, #ef4444)',
                }}
              >
                {overallSuccessRate !== null ? `${Math.round(overallSuccessRate * 100)}%` : '—'}
              </span>
              <span className="health-summary-label footnote">Overall success rate</span>
            </div>
            <div className="health-summary-card">
              <span
                className="health-summary-value"
                style={{ color: totalErrors > 0 ? 'var(--health-err, #ef4444)' : undefined }}
              >
                {metrics ? totalErrors : '—'}
              </span>
              <span className="health-summary-label footnote">Total errors</span>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="health-loading" aria-busy="true" aria-live="polite">
            <span>Loading metrics…</span>
          </div>
        ) : jobMetricsError ? (
          <div className="health-empty">
            <div className="health-empty-icon" aria-hidden="true">⚠️</div>
            <h3>Could not load metrics</h3>
            <p className="footnote">{jobMetricsError}</p>
            <button className="btn btn-sm" onClick={() => void fetchJobMetrics(true)}>Retry</button>
          </div>
        ) : metrics && metrics.workers.length === 0 ? (
          <div className="health-empty">
            <div className="health-empty-icon" aria-hidden="true">📊</div>
            <h3>No run history yet</h3>
            <p className="footnote">
              Once your jobs start running, per-worker metrics will appear here.
              Enable a job in the <button className="link-btn" onClick={() => setActiveTab('jobs')}>Jobs tab</button> to get started.
            </p>
          </div>
        ) : metrics ? (
          <div className="health-workers">
            {metrics.workers.map((worker) => {
              const isExpanded = expandedWorkerIds.has(worker.workerId);
              const toggleExpanded = () => {
                setExpandedWorkerIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(worker.workerId)) next.delete(worker.workerId);
                  else next.add(worker.workerId);
                  return next;
                });
              };

              const successPct = worker.successRate !== null ? Math.round(worker.successRate * 100) : null;
              const rateColor = successPct === null ? undefined
                : successPct >= 90 ? 'var(--health-ok, #22c55e)'
                  : successPct >= 70 ? 'var(--health-warn, #f59e0b)'
                    : 'var(--health-err, #ef4444)';

              return (
                <div key={worker.workerId} className="health-worker-card">
                  <button
                    className="health-worker-header"
                    onClick={toggleExpanded}
                    aria-expanded={isExpanded}
                    aria-controls={`health-worker-jobs-${worker.workerId}`}
                  >
                    <div className="health-worker-title">
                      <span className="health-worker-name">{worker.workerName}</span>
                      <span className="health-worker-id footnote">{worker.workerId}</span>
                    </div>
                    <div className="health-worker-stats">
                      {successPct !== null && (
                        <span className="health-rate-badge" style={{ color: rateColor }}>
                          {successPct}%
                        </span>
                      )}
                      <span className="footnote health-run-count">{worker.totalRuns} runs</span>
                      {renderDurationChip('p50', worker.p50Ms)}
                      {renderDurationChip('p95', worker.p95Ms)}
                      <span className="health-expand-icon" aria-hidden="true">{isExpanded ? '▲' : '▼'}</span>
                    </div>
                  </button>

                  {/* Per-job rows */}
                  <div
                    id={`health-worker-jobs-${worker.workerId}`}
                    className={`health-worker-jobs${isExpanded ? ' is-expanded' : ''}`}
                    hidden={!isExpanded}
                  >
                    {worker.jobs.map((job) => (
                      <div key={job.jobName} className="health-job-row">
                        <div className="health-job-sparkline">
                          {renderSparkline(job.recentStatuses)}
                        </div>
                        <div className="health-job-info">
                          <span className="health-job-label">{job.jobLabel}</span>
                          <span className="health-job-counts footnote">
                            {job.successCount}✓ {job.errorCount > 0 ? `${job.errorCount}✗ ` : ''}{job.skippedCount > 0 ? `${job.skippedCount}↷` : ''}
                          </span>
                        </div>
                        <div className="health-job-rate">
                          {renderSuccessBar(job.successRate, job.totalRuns)}
                        </div>
                        <div className="health-job-duration">
                          {renderDurationChip('p50', job.p50Ms)}
                          {renderDurationChip('p95', job.p95Ms)}
                        </div>
                        {job.lastFailureReason && (
                          <div className="health-job-failure footnote" title={job.lastFailureReason}>
                            ⚠ {job.lastFailureReason.length > 80
                              ? `${job.lastFailureReason.slice(0, 80)}…`
                              : job.lastFailureReason}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        {metrics && (
          <p className="health-computed-at footnote" aria-live="polite">
            Computed at {new Date(metrics.computedAt).toLocaleTimeString()}
          </p>
        )}
      </div>
    );
  }

  function renderActionsTab() {
    const selectedAction = pendingActions.find((a) => a.id === selectedActionId) ?? null;

    return (
      <div className="tab-content actions-tab">
        <div className="panel">
          <div className="panel-header">
            <h2>
              Pending Actions
              <HelpTip>
                Workers that need to perform write operations (e.g. creating or modifying files) must
                request your approval first. Review the diff preview and approve or reject each request.
                Approved actions run immediately; rejected ones are cancelled.
              </HelpTip>
            </h2>
          </div>

          {actionsLoading && pendingActions.length === 0 ? (
            <div className="empty-state"><p>Loading…</p></div>
          ) : pendingActions.length === 0 ? (
            <div className="empty-state">
              <p>No pending actions.</p>
              <p className="footnote">
                When a worker requests a file write or another approved-write operation, it will appear
                here for your review.
              </p>
            </div>
          ) : (
            <div className="actions-list">
              {pendingActions.map((action) => (
                <div
                  key={action.id}
                  className={`actions-item${selectedActionId === action.id ? ' selected' : ''}`}
                >
                  {/* Selectable region — opens diff preview below */}
                  <button
                    type="button"
                    className="actions-item-body"
                    aria-expanded={selectedActionId === action.id}
                    aria-label={`${action.label} from ${action.workerId} — ${selectedActionId === action.id ? 'collapse' : 'expand'} diff preview`}
                    onClick={() => setSelectedActionId(selectedActionId === action.id ? null : action.id)}
                  >
                    <div className="actions-item-header">
                      <span className="actions-item-label">{action.label}</span>
                      <span className="actions-item-worker footnote">{action.workerId}</span>
                      <StatusPill tone="warning">pending</StatusPill>
                    </div>
                    <div className="actions-item-rationale footnote">{action.rationale}</div>
                  </button>
                  <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busyKey === `action-${action.id}`}
                      onClick={() => void decideAction(action.id, true)}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      disabled={busyKey === `action-${action.id}`}
                      onClick={() => void decideAction(action.id, false)}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {selectedAction?.preview ? (
          <div className="panel">
            <div className="panel-header">
              <h2>Diff preview — {selectedAction.label}</h2>
            </div>
            <pre className="actions-diff">{selectedAction.preview}</pre>
          </div>
        ) : null}

        {/* ── Action history ─────────────────────────────────────────── */}
        {actionHistory.length > 0 ? (
          <div className="panel">
            <div className="panel-header">
              <h2>
                Action History
                <HelpTip>
                  The last 50 action requests across all workers, newest first.
                  Includes auto-approved reads, approved/rejected writes, and blocked requests.
                </HelpTip>
              </h2>
            </div>
            <table className="schedule-preview-table">
              <thead>
                <tr>
                  <th>Worker</th>
                  <th>Action</th>
                  <th>Class</th>
                  <th>State</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {actionHistory.map((action) => {
                  const stateTone: Record<ActionState, 'good' | 'warning' | 'info' | 'muted'> = {
                    approved: 'good',
                    executed: 'good',
                    pending: 'warning',
                    rejected: 'muted',
                    failed: 'warning',
                  };
                  return (
                    <tr key={action.id}>
                      <td className="footnote">{action.workerId}</td>
                      <td>{action.label}</td>
                      <td><code className="footnote">{action.actionClass}</code></td>
                      <td><StatusPill tone={stateTone[action.state]}>{action.state}</StatusPill></td>
                      <td className="footnote">{new Date(action.createdAt).toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    );
  }

  // ── Store tab ─────────────────────────────────────────────────────────────

  function renderStoreTab() {
    const STORE_URL = 'https://bfrost.net/store';
    const installedIds = new Set(dashboard.workers.map((w) => w.id));
    const categoryOptions = storeWorkers
      ? Array.from(
        storeWorkers.reduce((categories, worker) => {
          const key = storeCategoryKey(worker.category);
          if (!categories.has(key)) categories.set(key, storeCategoryLabel(worker.category));
          return categories;
        }, new Map<string, string>()),
      )
        .map(([key, label]) => ({ key, label }))
        .sort((a, b) => a.label.localeCompare(b.label))
      : [];
    const activeCategoryFilter = categoryOptions.some((category) => category.key === storeCategoryFilter)
      ? storeCategoryFilter
      : 'all';
    const filteredStoreWorkers = storeWorkers
      ? storeWorkers.filter(
        (worker) => activeCategoryFilter === 'all' || storeCategoryKey(worker.category) === activeCategoryFilter,
      )
      : [];
    const activeCategoryLabel = activeCategoryFilter === 'all'
      ? 'all categories'
      : categoryOptions.find((category) => category.key === activeCategoryFilter)?.label ?? 'this category';
    const selectedListing = storeSelectedId && storeWorkers
      ? storeWorkers.find((worker) => worker.id === storeSelectedId) ?? null
      : null;
    const selectedWorker = storeDetail ?? selectedListing;

    const openStoreWorker = (workerId: string) => {
      setStoreSelectedId(workerId);
      void fetchStoreDetail(workerId);
    };

    return (
      <section className="panel tab-page store-tab">
        {/* Header */}
        <div className="panel-head">
          <div>
            <p className="panel-kicker">Community</p>
            <h2>Worker Store <HelpTip>Browse community-built workers from bfrost.net. Search by name or category, click a card to read the details and declared permissions, then click Install to add it — no terminal needed. Installed workers appear in the Workers tab immediately.</HelpTip></h2>
          </div>
          <a href={STORE_URL} target="_blank" rel="noopener noreferrer" className="store-external-link">
            bfrost.net/store
          </a>
        </div>

        {/* Search */}
        <div className="store-catalog-tools">
          <div className="store-search-row">
            <input
              type="search"
              className="store-search-input"
              placeholder="Search workers..."
              value={storeQueryInput}
              onChange={(e) => setStoreQueryInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setStoreQuery(storeQueryInput);
              }}
              autoComplete="off"
            />
            <button type="button" className="store-search-button" onClick={() => setStoreQuery(storeQueryInput)} disabled={storeLoading}>
              {storeLoading ? 'Searching...' : 'Search'}
            </button>
            {storeQuery ? (
              <button type="button" className="store-clear-button" onClick={() => { setStoreQuery(''); setStoreQueryInput(''); }}>
                Clear
              </button>
            ) : null}
          </div>

          {categoryOptions.length > 0 ? (
            <div className="store-filter-row" aria-label="Worker categories">
              <button
                type="button"
                className={`store-filter-chip${activeCategoryFilter === 'all' ? ' active' : ''}`}
                aria-pressed={activeCategoryFilter === 'all'}
                onClick={() => setStoreCategoryFilter('all')}
              >
                All
              </button>
              {categoryOptions.map((category) => (
                <button
                  key={category.key}
                  type="button"
                  className={`store-filter-chip${activeCategoryFilter === category.key ? ' active' : ''}`}
                  aria-pressed={activeCategoryFilter === category.key}
                  onClick={() => setStoreCategoryFilter(category.key)}
                >
                  {category.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* Sideload from .zip */}
        <details className="store-sideload-section">
          <summary>Sideload a worker archive (.zip / .tar.gz)</summary>
          <div className="store-sideload-row">
            <p className="footnote">
              Install a worker someone shared with you as an archive file, without going through the
              store. The archive must contain a valid <code>worker.json</code>.
            </p>
            <input
              type="file"
              accept=".zip,.tar.gz,.tgz"
              onChange={(e) => setSideloadFile(e.target.files?.[0] ?? null)}
            />
            {sideloadFile ? (
              <div className="panel-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={busyKey === 'sideload-upload'}
                  onClick={() => void sideloadWorkerZip()}
                >
                  {busyKey === 'sideload-upload' ? 'Installing…' : `Install "${sideloadFile.name}"`}
                </button>
                <button type="button" onClick={() => setSideloadFile(null)}>Cancel</button>
              </div>
            ) : null}
          </div>
        </details>

        {/* Detail panel */}
        {storeSelectedId ? (
          <div className="store-detail-panel">
            <div className="store-detail-toolbar">
              <button type="button" className="store-back-button" onClick={() => { setStoreSelectedId(null); setStoreDetail(null); }}>
                Back to catalog
              </button>
              <a
                href={`https://bfrost.net/store/${storeSelectedId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="store-external-link"
              >
                View on bfrost.net
              </a>
            </div>

            {selectedWorker ? (
              <div className={`store-detail-hero store-palette-${storePaletteIndex(selectedWorker.category)}`}>
                <StoreWorkerLogo worker={selectedWorker} size="large" installed={installedIds.has(selectedWorker.id)} />
                <div className="store-detail-title">
                  <span className="store-category-chip">{storeCategoryLabel(selectedWorker.category)}</span>
                  <h2>{selectedWorker.name}</h2>
                  <p>{selectedWorker.tagline}</p>
                </div>
                <StoreTrustBadge trust={selectedWorker.trust} />
              </div>
            ) : null}

            {storeDetailLoading ? (
              <div className="store-detail-loading" aria-live="polite">
                <span className="store-skeleton-line wide" />
                <span className="store-skeleton-line" />
                <span className="store-skeleton-line short" />
              </div>
            ) : storeDetail ? (
              <>
                <div className="store-detail-meta">
                  <span>{storeAuthorHandle(storeDetail.author)}</span>
                  <span>v{storeDetail.latestVersion}</span>
                  {storeDetail.license ? <span>{storeDetail.license}</span> : null}
                  {storeDetail.downloadCount > 0 ? (
                    <span>{storeDetail.downloadCount.toLocaleString()} installs</span>
                  ) : null}
                </div>

                <div className="store-detail-content">
                  <section className="store-detail-section store-detail-description">
                    <h3>Description</h3>
                    <p>{storeDetail.description || storeDetail.tagline}</p>
                  </section>

                  <div className="store-detail-grid">
                    <section className="store-detail-section">
                      <h3>Permissions</h3>
                      {storeDetail.permissions.length > 0 ? (
                        <ul className="store-permission-list">
                          {storeDetail.permissions.map((permission) => <li key={permission}><code>{permission}</code></li>)}
                        </ul>
                      ) : (
                        <p className="footnote">No special permissions declared.</p>
                      )}
                    </section>

                    <section className="store-detail-section">
                      <h3>Capabilities</h3>
                      <div className="store-capabilities">
                        {storeDetail.capabilities.jobs.length > 0 ? (
                          <span>Jobs: {storeDetail.capabilities.jobs.join(', ')}</span>
                        ) : null}
                        {storeDetail.capabilities.tools.length > 0 ? (
                          <span>Tools: {storeDetail.capabilities.tools.join(', ')}</span>
                        ) : null}
                        {storeDetail.capabilities.channels.length > 0 ? (
                          <span>Channels: {storeDetail.capabilities.channels.join(', ')}</span>
                        ) : null}
                        {storeDetail.capabilities.providers.length > 0 ? (
                          <span>Providers: {storeDetail.capabilities.providers.join(', ')}</span>
                        ) : null}
                        {storeDetail.capabilities.jobs.length === 0
                          && storeDetail.capabilities.tools.length === 0
                          && storeDetail.capabilities.channels.length === 0
                          && storeDetail.capabilities.providers.length === 0 ? (
                            <span>No runtime capabilities declared.</span>
                          ) : null}
                      </div>
                    </section>
                  </div>

                  {storeDetail.versions.length > 0 ? (
                    <section className="store-detail-section">
                      <h3>Version history</h3>
                      <ol className="store-version-list">
                        {storeDetail.versions.slice(0, 5).map((version) => (
                          <li key={version.version} className={version.yanked ? 'is-yanked' : ''}>
                            <div className="store-version-head">
                              <strong>v{version.version}</strong>
                              <span>{formatDate(version.publishedAt)}</span>
                              {version.yanked ? <StatusPill tone="warning">yanked</StatusPill> : null}
                            </div>
                            {version.changelog ? <p>{version.changelog}</p> : null}
                            <span className="store-version-meta">
                              Engine {version.bfrostEngine}
                              {version.bundleSizeBytes ? ` · ${formatBytes(version.bundleSizeBytes)}` : ''}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </section>
                  ) : null}

                  <div className="store-detail-actions">
                    {installedIds.has(storeDetail.id) ? (() => {
                      const installedWorker = dashboard.workers.find((w) => w.id === storeDetail.id);
                      // Infrastructure built-ins (builtIn=true, not deletable) are always
                      // present; just show a badge. Deletable plugin workers show Enable/Disable.
                      if (storeDetail.builtIn && installedWorker && !installedWorker.deletable) {
                        return <span className="store-installed-callout">✓ Always included</span>;
                      }
                      const isEnabled = installedWorker?.enabled ?? false;
                      return (
                        <>
                          <span className="store-installed-callout">✓ Included</span>
                          <button
                            type="button"
                            className={isEnabled ? '' : 'primary'}
                            disabled={busyKey === `worker-${storeDetail.id}`}
                            onClick={() =>
                              void mutate(
                                `worker-${storeDetail.id}`,
                                `/api/workers/${encodeURIComponent(storeDetail.id)}`,
                                { method: 'POST', body: JSON.stringify({ enabled: !isEnabled }) },
                                `${storeDetail.name} ${isEnabled ? 'disabled' : 'enabled'}.`,
                              )
                            }
                          >
                            {busyKey === `worker-${storeDetail.id}`
                              ? (isEnabled ? 'Disabling…' : 'Enabling…')
                              : (isEnabled ? 'Disable' : 'Enable')}
                          </button>
                        </>
                      );
                    })() : storeDetail.builtIn && !storeDetail.versions?.find((v) => !v.yanked && v.bundleUrl && v.bundleSha256) ? (
                      // Infrastructure built-in with no installable bundle — should never be
                      // missing but show a safe fallback.
                      <span className="store-installed-callout">✓ Always included</span>
                    ) : (
                      <button
                        type="button"
                        className="primary store-install-button"
                        disabled={busyKey === `store-install-${storeDetail.id}`}
                        onClick={() => {
                          const version = storeDetail.versions?.find((v) => !v.yanked && v.bundleUrl && v.bundleSha256);
                          if (!version) {
                            window.open(`https://bfrost.net/store/${storeDetail.id}`, '_blank');
                            return;
                          }
                          void installFromStore(storeDetail);
                        }}
                      >
                        {busyKey === `store-install-${storeDetail.id}`
                          ? (storeDetail.builtIn ? 'Restoring…' : 'Installing…')
                          : (storeDetail.builtIn ? 'Restore worker' : 'Install worker')}
                      </button>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="empty-state store-empty-state">
                <div className="store-empty-icon" aria-hidden="true">📦</div>
                <p>Could not load worker details.</p>
                <p className="footnote">Try returning to the catalog and opening the listing again.</p>
              </div>
            )}
          </div>
        ) : null}

        {/* Catalog */}
        {!storeSelectedId ? (
          <>
            {storeError ? (
              <div className="empty-state">
                <p>Could not reach the store.</p>
                <p className="footnote">{storeError}</p>
                <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
                  <button type="button" onClick={() => void fetchStoreCatalog(storeQuery)}>Retry</button>
                  <a href={`https://bfrost.net/store`} target="_blank" rel="noopener noreferrer">
                    Open in browser ↗
                  </a>
                </div>
              </div>
            ) : storeLoading && !storeWorkers ? (
              <div className="store-catalog-grid store-skeleton-grid" aria-label="Loading catalog">
                {[0, 1, 2].map((item) => (
                  <div key={item} className="store-card store-card-skeleton">
                    <div className="store-card-top">
                      <span className="store-logo-skeleton" />
                      <span className="store-skeleton-pill" />
                    </div>
                    <span className="store-skeleton-line wide" />
                    <span className="store-skeleton-line" />
                    <span className="store-skeleton-line short" />
                  </div>
                ))}
              </div>
            ) : storeWorkers && filteredStoreWorkers.length === 0 ? (
              <div className="empty-state store-empty-state">
                <div className="store-empty-icon" aria-hidden="true">🔍</div>
                <p>No workers found{storeQuery ? ` for "${storeQuery}"` : activeCategoryFilter !== 'all' ? ` in ${activeCategoryLabel}` : ''}.</p>
                <p className="footnote">Try a different search or another category.</p>
              </div>
            ) : storeWorkers ? (
              <div className="store-catalog-grid">
                {filteredStoreWorkers.map((worker) => (
                  <button
                    type="button"
                    key={worker.id}
                    className={`store-card store-palette-${storePaletteIndex(worker.category)}`}
                    aria-label={`View details for ${worker.name}`}
                    onClick={() => openStoreWorker(worker.id)}
                  >
                    <div className="store-card-top">
                      <StoreWorkerLogo worker={worker} installed={installedIds.has(worker.id)} />
                      <StoreTrustBadge trust={worker.trust} />
                    </div>
                    <div className="store-card-title-row">
                      <h3>{worker.name}</h3>
                      <span className="store-category-chip">{storeCategoryLabel(worker.category)}</span>
                    </div>
                    <p className="store-card-tagline">{worker.tagline}</p>
                    <div className="store-card-meta">
                      <span className="store-author-handle">{storeAuthorHandle(worker.author)}</span>
                      <span>v{worker.latestVersion}</span>
                      {worker.downloadCount > 0 ? (
                        <span>{worker.downloadCount.toLocaleString()} installs</span>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
            ) : null}

            <div className="store-footer">
              <p className="footnote">
                Want to publish your own worker?{' '}
                <a href="https://bfrost.net/publish" target="_blank" rel="noopener noreferrer">
                  Submit to the store ↗
                </a>
              </p>
            </div>
          </>
        ) : null}
      </section>
    );
  }

  function renderQueueMetrics(interactive: boolean) {
    return (
      <div className="metric-row">
        <Metric label="Total" value={String(dashboard.queue.total)} active={queueFilter === 'all'} onClick={interactive ? () => setQueueFilter('all') : undefined} />
        <Metric label="Queued" value={String(dashboard.queue.queued)} active={queueFilter === 'queued'} onClick={interactive ? () => setQueueFilter('queued') : undefined} />
        <Metric label="Approved" value={String(dashboard.queue.approved)} active={queueFilter === 'approved'} onClick={interactive ? () => setQueueFilter('approved') : undefined} />
        <Metric label="Posted" value={String(dashboard.queue.posted)} active={queueFilter === 'posted'} onClick={interactive ? () => setQueueFilter('posted') : undefined} />
        <Metric label="Rejected" value={String(dashboard.queue.rejected)} active={queueFilter === 'rejected'} onClick={interactive ? () => setQueueFilter('rejected') : undefined} />
        <Metric label="Failed" value={String(dashboard.queue.failed)} active={queueFilter === 'failed'} onClick={interactive ? () => setQueueFilter('failed') : undefined} />
        <Metric label="Seen" value={String(dashboard.queue.seen)} active={queueFilter === 'seen'} onClick={interactive ? () => setQueueFilter('seen') : undefined} />
        <Metric label="Retrying" value={String(dashboard.queue.retrying)} active={queueFilter === 'retrying'} onClick={interactive ? () => setQueueFilter('retrying') : undefined} />
      </div>
    );
  }
}

function sectionEndpoint(name: DashboardSectionName): string {
  switch (name) {
    case 'queue': return '/api/dashboard/queue';
    case 'cronRuns': return '/api/dashboard/cron-runs';
    case 'events': return '/api/dashboard/events';
    case 'backups': return '/api/dashboard/backups';
    case 'workerData': return '/api/dashboard/worker-data';
    case 'lmStudioModels': return '/api/dashboard/lmstudio-models';
  }
}

function mergeSection(
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
function sectionsForTab(tab: DashboardTab): DashboardSectionName[] {
  if (tab === 'overview') return ['queue', 'events', 'lmStudioModels'];
  if (tab === 'channels') return ['workerData'];
  if (tab === 'jobs') return ['cronRuns', 'queue'];
  if (tab === 'system') return ['events', 'backups'];
  if (tab === 'chat') return [];
  if (tab === 'config') return ['queue', 'workerData'];
  if (tab === 'workers') return [];
  // Worker-provided tabs may render queue items, events, or worker dashboard slices.
  return ['queue', 'events', 'workerData'];
}

function buildWorkerTabDefinitions(
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

function workerDeclaresView(worker: WorkerSummary, definition: WorkerDashboardViewDefinition): boolean {
  const surfaceIds = new Set([
    ...worker.dashboard.routes.map((surface) => surface.id),
    ...worker.dashboard.settings.map((surface) => surface.id),
  ]);
  return definition.surfaceIds.some((surfaceId) => surfaceIds.has(surfaceId));
}

function workerTabId(workerId: string): `worker:${string}` {
  return `worker:${workerId}`;
}

function configSurfaceKey(workerId: string, surfaceId: string): string {
  return `${workerId}:${surfaceId}`;
}

function jobConfigSummary(job: SchedulerJobState): string {
  const parts = ['model'];
  if (job.dashboardFields.length > 0) {
    parts.push(`${job.dashboardFields.length} field${job.dashboardFields.length === 1 ? '' : 's'}`);
  }
  if (job.promptEditable) {
    parts.push('prompt');
  }
  return parts.join(' · ');
}

function coreMenuCount(
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

function Metric({
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

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DetailBlock({
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

function stringListDraftRows(value: JobParamDraftValue): string[] {
  const rows = String(value).split('\n');
  return rows.length > 0 ? rows : [''];
}

function stringListDraftItems(value: JobParamDraftValue): string[] {
  return stringListDraftRows(value)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeStringListItem(value: string): string {
  return value.trim().toLowerCase();
}

function stringListDraftIncludes(value: JobParamDraftValue, item: string): boolean {
  const normalized = normalizeStringListItem(item);
  return stringListDraftItems(value).some((current) => normalizeStringListItem(current) === normalized);
}

function addStringListDraftValue(value: JobParamDraftValue, item: string): string {
  const trimmed = item.trim();
  if (!trimmed) return String(value);
  const items = stringListDraftItems(value);
  if (items.some((current) => normalizeStringListItem(current) === normalizeStringListItem(trimmed))) {
    return items.join('\n');
  }
  return [...items, trimmed].join('\n');
}

function toggleStringListDraftValue(value: JobParamDraftValue, item: string): string {
  const normalized = normalizeStringListItem(item);
  const items = stringListDraftItems(value);
  if (items.some((current) => normalizeStringListItem(current) === normalized)) {
    return items.filter((current) => normalizeStringListItem(current) !== normalized).join('\n');
  }
  return addStringListDraftValue(value, item);
}

function fieldListPlaceholder(field: JobStringListField): string {
  if (field.placeholder) return field.placeholder;
  const key = field.key.toLowerCase();
  if (key.includes('host')) return 'example.com';
  if (key.includes('quer')) return 'Add an interest';
  return 'Add an item';
}

function buildJobParamsDraft(job: SchedulerJobState): Record<string, JobParamDraftValue> {
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

function buildSurfaceDraft(
  surface: WorkerDashboardSurface,
  workerData?: Record<string, unknown>,
): Record<string, JobParamDraftValue> {
  return Object.fromEntries(
    (surface.fields ?? []).map((field) => [field.key, fieldDefaultDraftValue(field, workerData)]),
  );
}

function fieldDefaultDraftValue(
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

function resolveSeedPath(root: Record<string, unknown>, path: string): unknown {
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

function serializeDashboardFields(
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

function serializeJobParams(job: SchedulerJobState, draft: JobDraft): Record<string, unknown> {
  return serializeDashboardFields(job.dashboardFields, draft.params);
}

function surfaceDraftHasValue(fields: JobDashboardField[], draft: Record<string, JobParamDraftValue>): boolean {
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
function HelpTip({ children }: { children: ReactNode }) {
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

function HealthRow({ label, status }: { label: string; status: HealthStatus }) {
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

type StoreVisualWorker = Pick<StoreWorkerListing, 'id' | 'category' | 'tags'>;

const STORE_VISUAL_RULES: Array<{ icon: string; keywords: string[] }> = [
  { icon: '📡', keywords: ['rss', 'feed', 'feeds', 'atom', 'reader'] },
  { icon: '🐘', keywords: ['fediverse', 'mastodon', 'activitypub', 'social'] },
  { icon: '📝', keywords: ['wordpress', 'publishing', 'publish', 'blog', 'cms', 'writer', 'write', 'post'] },
  { icon: '🤖', keywords: ['ai', 'llm', 'agent', 'assistant', 'model', 'automation'] },
  { icon: '🔔', keywords: ['notify', 'notification', 'alert', 'webhook', 'mail', 'message'] },
  { icon: '🔍', keywords: ['search', 'lookup', 'crawl', 'discover', 'index', 'knowledge'] },
];

const STORE_PALETTE_COUNT = 8;

function StoreWorkerLogo({
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

function StoreTrustBadge({ trust }: { trust: string }) {
  const label = trust.trim() || 'Community';
  return <span className={`store-trust-badge ${storeTrustTone(label)}`}>{label}</span>;
}

function storeWorkerIcon(worker: StoreVisualWorker): string {
  const signal = [worker.category, worker.id, ...worker.tags].join(' ').toLowerCase();
  return STORE_VISUAL_RULES.find((rule) => rule.keywords.some((keyword) => signal.includes(keyword)))?.icon ?? '📦';
}

function storePaletteIndex(category: string): number {
  const label = storeCategoryLabel(category).toLowerCase();
  let hash = 0;
  for (const char of label) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % STORE_PALETTE_COUNT;
}

function storeCategoryKey(category: string): string {
  return storeCategoryLabel(category).toLowerCase();
}

function storeCategoryLabel(category: string): string {
  const label = category.trim();
  return label || 'General';
}

function storeTrustTone(trust: string): 'review' | 'community' | 'verified' | 'trusted' | 'core' {
  const normalized = trust.trim().toLowerCase();
  if (normalized === 'review') return 'review';
  if (normalized === 'verified') return 'verified';
  if (normalized === 'trusted') return 'trusted';
  if (normalized === 'core') return 'core';
  return 'community';
}

function storeAuthorHandle(author: string): string {
  const trimmed = author.trim();
  if (!trimmed) return 'Unknown author';
  if (trimmed.startsWith('@') || trimmed.includes(' ')) return trimmed;
  return `@${trimmed}`;
}

function StatusPill({
  children,
  tone,
}: {
  children: string;
  tone: 'good' | 'warning' | 'info' | 'muted';
}) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
}

const RUN_ERROR_PREVIEW_CHARS = 180;

function RunError({ message }: { message: string }) {
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

function statusTone(status: RunStatus): 'good' | 'warning' | 'info' | 'muted' {
  if (status === 'success') return 'good';
  if (status === 'error') return 'warning';
  if (status === 'skipped') return 'info';
  return 'muted';
}

function workerHealthTone(state: WorkerHealthState): 'good' | 'warning' | 'info' | 'muted' {
  if (state === 'healthy') return 'good';
  if (state === 'missing_credentials' || state === 'missing_dependency') return 'warning';
  if (state === 'degraded') return 'info';
  return 'muted';
}

function workerHealthLabel(state: WorkerHealthState): string {
  if (state === 'missing_credentials') return 'missing credentials';
  if (state === 'missing_dependency') return 'missing dependency';
  return state;
}

function workerOwnsEvent(worker: WorkerSummary, event: EventLogRecord): boolean {
  if (event.metadata.workerId === worker.id) return true;

  const workerIds = event.metadata.workerIds;
  if (Array.isArray(workerIds) && workerIds.includes(worker.id)) return true;

  const eventJob = event.metadata.job;
  return typeof eventJob === 'string' && worker.jobs.some((job) => job.id === eventJob);
}

function resolveDashboardTab(value: string | undefined): DashboardTab | null {
  if (value === 'overview' ||
    value === 'workers' ||
    value === 'jobs' ||
    value === 'config' ||
    value === 'chat' ||
    value === 'system') {
    return value;
  }
  if (value === 'settings' || value === 'configuration') return 'config';
  if (value === 'events' || value === 'health') return 'system';
  return null;
}

function eventSeverityTone(severity: EventLogRecord['severity']): 'good' | 'warning' | 'info' | 'muted' {
  if (severity === 'error') return 'warning';
  if (severity === 'warning') return 'info';
  return 'muted';
}

function runDuration(run: SchedulerRunRecord | undefined): string | null {
  if (!run?.finishedAt) return null;

  const startedMs = Date.parse(run.startedAt);
  const finishedMs = Date.parse(run.finishedAt);
  if (Number.isNaN(startedMs) || Number.isNaN(finishedMs) || finishedMs < startedMs) {
    return null;
  }

  return formatDuration(finishedMs - startedMs);
}

function runSeverity(run: SchedulerRunRecord): EventLogRecord['severity'] {
  if (run.status === 'error') return 'error';
  if (run.status === 'skipped') return 'warning';
  return 'info';
}

function runStatusTone(status: SchedulerRunRecord['status']): 'good' | 'warning' | 'info' | 'muted' {
  if (status === 'success') return 'good';
  if (status === 'error') return 'warning';
  if (status === 'skipped' || status === 'running') return 'info';
  return 'muted';
}

function runStatusSummary(run: SchedulerRunRecord): string {
  if (run.status === 'running') return `${run.label} is running.`;
  if (run.status === 'skipped') return `${run.label} was skipped.`;
  if (run.status === 'error') return `${run.label} failed.`;
  return `${run.label} completed successfully.`;
}

function queueItemTone(
  state: QueueItem['state'],
): 'good' | 'warning' | 'info' | 'muted' {
  if (state === 'posted') return 'good';
  if (state === 'failed' || state === 'rejected') return 'warning';
  if (state === 'queued' || state === 'approved') return 'info';
  return 'muted';
}

function queueItemReason(item: QueueItem): string | null {
  return item.stateReason ?? item.selectionReason ?? item.rejectionReason ?? item.lastError ?? null;
}

function providerLabel(provider: string, workers: WorkerSummary[]): string {
  const match = workers.find(
    (w) => w.kind === 'provider' && w.id.endsWith(`.${provider}`)
  );
  return match?.displayName ?? match?.name ?? provider;
}

function hostsToDraft(values: string[]): string {
  return values.join('\n');
}

function draftToHosts(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function safeHost(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function formatBytes(bytes: number): string {
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

function formatDate(value: string | null): string {
  if (!value) return 'n/a';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}
