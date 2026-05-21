import { useEffect, useRef, useState } from 'react';
import { Sidebar, type SidebarEntry } from './Sidebar';
import { TopBar } from './TopBar';
import { Markdown } from './Markdown';
import { loadRuntimeWorkerBundle, workerQueueItemDetails, useWorkerDashboardViews } from './workers/registry';
import type { WorkerDashboardViewDefinition } from './workers/types';

type RunStatus = 'idle' | 'success' | 'error' | 'skipped';
type CoreDashboardTab = 'overview' | 'workers' | 'jobs' | 'config' | 'chat' | 'system';
type DashboardTab = CoreDashboardTab | `worker:${string}`;
type QueueFilter = 'all' | QueueItem['state'] | 'retrying';
type CoreConfigKey = 'cloud-api-keys' | 'platform-routing' | 'embedding-model';

const DASHBOARD_REFRESH_INTERVAL_MS = 30000;
const JOBS_REFRESH_INTERVAL_MS = 5000;

interface MemoryCleanupStatus {
  platform: 'darwin' | 'linux' | 'win32' | 'unsupported';
  supported: boolean;
  configured: boolean;
  command: string | null;
  sudoersLine: string | null;
  sudoersDropInPath: string;
}

function MemoryCleanupPanel() {
  const [status, setStatus] = useState<MemoryCleanupStatus | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function refresh() {
    try {
      const res = await fetch('/api/workers/lmstudio/memory-cleanup', { credentials: 'include' });
      if (!res.ok) return;
      setStatus(await res.json());
    } catch {
      // best-effort; panel hides on failure
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/workers/lmstudio/memory-cleanup/test', {
        method: 'POST',
        credentials: 'include',
      });
      const payload = await res.json();
      setTestResult(
        payload.ok
          ? `Memory cleanup ran in ${payload.durationMs} ms.`
          : `Cleanup did not complete${payload.errorMessage ? `: ${payload.errorMessage}` : '.'} Add the sudoers line below and try again.`,
      );
      await refresh();
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  }

  async function copySudoersLine() {
    if (!status?.sudoersLine) return;
    try {
      await navigator.clipboard.writeText(status.sudoersLine);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard denial — surface nothing, user can select manually
    }
  }

  if (!status) return null;

  if (!status.supported) {
    return (
      <p className="footnote" style={{ marginTop: '0.5rem' }}>
        Memory cleanup after model unload is not supported on this platform ({status.platform}); the
        OS reclaims memory on its own.
      </p>
    );
  }

  const toneClass = status.configured ? 'good' : 'warning';
  const statusLabel = status.configured ? 'Configured' : 'Not configured';

  return (
    <div style={{ marginTop: '0.75rem', borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit' }}
      >
        <span className={`status-pill ${toneClass}`} style={{ marginRight: '0.5rem' }}>
          {statusLabel}
        </span>
        Memory cleanup after unload {expanded ? '▾' : '▸'}
      </button>

      {expanded ? (
        <div style={{ marginTop: '0.5rem' }}>
          <p className="footnote">
            BFrost runs <code>{status.command}</code> after a model unload to help the OS reclaim
            inactive memory. The command needs <strong>passwordless sudo</strong> so it can run
            unattended (including from cron jobs).
          </p>
          {status.configured ? (
            <p className="footnote" style={{ color: 'var(--good)' }}>
              Passwordless sudo is configured — no action needed.
            </p>
          ) : (
            <>
              <p className="footnote">
                Add the line below to a sudoers drop-in file. Open a terminal and run:
              </p>
              <pre className="codeblock" style={{ userSelect: 'all' }}>
                {`sudo visudo -f ${status.sudoersDropInPath}`}
              </pre>
              <p className="footnote">Then paste this line and save:</p>
              <pre className="codeblock" style={{ userSelect: 'all' }}>
                {status.sudoersLine}
              </pre>
              <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
                <button type="button" onClick={() => void copySudoersLine()}>
                  {copied ? 'Copied!' : 'Copy line'}
                </button>
                <button type="button" disabled={testing} onClick={() => void runTest()}>
                  {testing ? 'Testing...' : 'Test memory cleanup'}
                </button>
              </div>
              <p className="footnote" style={{ marginTop: '0.5rem' }}>
                To remove this access later, delete <code>{status.sudoersDropInPath}</code>.
              </p>
            </>
          )}
          {status.configured ? (
            <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
              <button type="button" disabled={testing} onClick={() => void runTest()}>
                {testing ? 'Testing...' : 'Test memory cleanup'}
              </button>
            </div>
          ) : null}
          {testResult ? <p className="footnote" style={{ marginTop: '0.5rem' }}>{testResult}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

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
    <ul className="footnote" style={{ marginTop: '0.25rem', paddingLeft: '1.2rem' }}>
      <li>"Run a news digest now."</li>
      <li>"What are the latest news items I have queued?"</li>
      <li>"Did the research job run today?"</li>
      <li>"What models are loaded?"</li>
    </ul>
  </div>
);

const CORE_MENU_ENTRIES: Array<Omit<SidebarEntry<DashboardTab>, 'count'>> = [
  { id: 'overview', label: 'Overview', icon: 'overview', group: 'Workspace', order: 10 },
  { id: 'jobs', label: 'Jobs', icon: 'jobs', group: 'Workspace', order: 20 },
  { id: 'workers', label: 'Workers', icon: 'workers', group: 'Workspace', order: 30 },
  { id: 'config', label: 'Config', icon: 'config', group: 'Workspace', order: 40 },
  { id: 'chat', label: 'Chat', icon: 'chat', group: 'System', order: 10 },
  { id: 'system', label: 'System', icon: 'system', group: 'System', order: 20 },
];

interface ModelOption {
  alias: string;
  id: string;
  label: string;
  provider: string;
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
}

interface JobTextareaField extends JobBaseField {
  type: 'textarea';
  defaultValue: string;
  rows?: number;
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
  version: string;
  description: string;
  builtIn: boolean;
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
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>('Loading dashboard...');
  const [password, setPassword] = useState('');
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview');
  const [selectedJobName, setSelectedJobName] = useState<string | null>(null);
  const [selectedCoreConfigKey, setSelectedCoreConfigKey] = useState<CoreConfigKey | null>(null);
  const [selectedConfigJobName, setSelectedConfigJobName] = useState<string | null>(null);
  const [selectedConfigSurfaceKey, setSelectedConfigSurfaceKey] = useState<string | null>(null);
  const [surfaceDrafts, setSurfaceDrafts] = useState<Record<string, Record<string, JobParamDraftValue>>>({});
  const [openPromptEditors, setOpenPromptEditors] = useState<Record<string, boolean>>({});
  const [customListItemDrafts, setCustomListItemDrafts] = useState<Record<string, string>>({});
  const [queueFilter, setQueueFilter] = useState<QueueFilter>('all');
  const [selectedQueueItemId, setSelectedQueueItemId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [chatDraft, setChatDraft] = useState('');
  const [chatTurns, setChatTurns] = useState<ChatTurn[]>([]);
  const chatLogRef = useRef<HTMLDivElement | null>(null);
  const [workerUploadFile, setWorkerUploadFile] = useState<File | null>(null);
  const [openaiApiKeyDraft, setOpenaiApiKeyDraft] = useState('');
  const [anthropicApiKeyDraft, setAnthropicApiKeyDraft] = useState('');
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

  async function refreshActiveTabSections(): Promise<void> {
    const sections = sectionsForTab(activeTabRef.current);
    await Promise.all(sections.map((section) => fetchSection(section, { force: true })));
  }

  async function initialize() {
    const nextSession = await refreshSession(true);
    if (nextSession?.authenticated || nextSession?.authEnabled === false) {
      await fetchDashboard(false);
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
        setError(err instanceof Error ? err.message : String(err));
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
      setError(err instanceof Error ? err.message : String(err));
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
        setError(err instanceof Error ? err.message : String(err));
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
      setError(err instanceof Error ? err.message : String(err));
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
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey(null);
    }
  }

  async function uploadWorkerZip() {
    if (!workerUploadFile) {
      setError('Choose a worker zip before uploading.');
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
      setError(err instanceof Error ? err.message : String(err));
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
      setError(err instanceof Error ? err.message : String(err));
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
      setError(err instanceof Error ? err.message : String(err));
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
      setError(err instanceof Error ? err.message : String(err));
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

          {error ? <p className="error-box">{error}</p> : null}
        </section>
      </main>
    );
  }

  if (!dashboard) {
    return (
      <div className="bfrost-splash">
        <img src="/bfrost-logo.jpeg" alt="BFrost" />
        <span>Loading BFrost…</span>
        {error ? (
          <p className="error-text" style={{ marginTop: '0.5rem' }}>{error}</p>
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
    .map((worker) => ({
      worker,
      surfaces: worker.dashboard.settings.filter((surface) => surface.tab === 'config'),
      jobs: dashboard.cron.jobs.filter((job) =>
        job.workerId === worker.id && (job.dashboardFields.length > 0 || job.promptEditable),
      ),
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
        jobs: dashboard.cron.jobs.length,
        config: configJobCount + configSurfaceCount + configCoreCount,
        chat: chatTurns.length,
        system: dashboard.events.length,
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
        <div className="field list-field" key={field.key}>
          <span>{field.label}</span>
          {field.helpText ? <small>{field.helpText}</small> : null}

          {suggestions.length > 0 ? (
            <div className="suggestion-picker">
              <span>Choose interests</span>
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

          <div className="list-editor">
            {suggestions.length > 0 ? <span className="list-editor-label">Selected interests</span> : null}
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
                Add interest
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

          {suggestions.length === 0 ? null : (
            <small>{stringListDraftItems(value).length} selected</small>
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
          placeholder={field.type === 'secret-reference' ? field.placeholder : undefined}
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
          <section className="grid top-grid">
            {renderModelPanel()}
            {renderRuntimePanel()}
          </section>

          <section className="grid overview-grid">
            <article className="panel">
              <div className="panel-head">
                <div>
                  <p className="panel-kicker">Capabilities</p>
                  <h2>Installed worker status</h2>
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
                  <h2>Recent events</h2>
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
              <h2>Dashboard chat</h2>
            </div>
            <StatusPill tone={dashboard.lmStudio.running ? 'good' : 'warning'}>
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

      {activeTab === 'jobs' ? (
        <section className="panel tab-page">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">Cron jobs</p>
              <h2>Schedules and run status</h2>
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
              <h2>Manifest settings</h2>
            </div>
            <StatusPill tone="muted">{configJobCount + configSurfaceCount + configCoreCount} configurable</StatusPill>
          </div>

          <div className="jobs-workspace">
            <div className="jobs">
              <section className="job-worker-group">
                <div className="job-worker-head">
                  <div>
                    <p className="panel-kicker">Platform</p>
                    <h3>Model providers</h3>
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
                          <span>
                            {job.dashboardFields.length} fields{job.promptEditable ? ' · prompt' : ''}
                          </span>
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
              <h2>Installed capabilities</h2>
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

      {activeTab === 'system' ? (
        <section className="panel tab-page">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">System</p>
              <h2>Runtime readiness</h2>
            </div>
          </div>

          <div className="panel-head section-break">
            <div>
              <p className="panel-kicker">Dependencies</p>
              <h2>Local runtime readiness</h2>
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
              <h2>SQLite state</h2>
            </div>
            <StatusPill tone={dashboard.backups.length > 0 ? 'good' : 'warning'}>
              {dashboard.backups.length} backups
            </StatusPill>
          </div>

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
                  <strong>{backup.file}</strong>
                  <span>{formatBytes(backup.sizeBytes)} · {formatDate(backup.createdAt)}</span>
                  <span>{backup.path}</span>
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
              <p className="panel-kicker">Event history</p>
              <h2>Recent operations</h2>
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
      </main>
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
                  {providerLabel(provider)}
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

  function renderRuntimePanel() {
    return (
      <article className="panel">
        <div className="panel-head">
          <div>
            <p className="panel-kicker">Runtime services</p>
            <h2>LM Studio</h2>
          </div>
          <StatusPill tone={dashboard.lmStudio.running ? 'good' : 'warning'}>
            {dashboard.lmStudio.running ? 'Running' : 'Stopped'}
          </StatusPill>
        </div>

        <div className="metric-row">
          <Metric label="Loaded models" value={String(dashboard.lmStudio.loadedCount)} />
          <Metric label="Default model" value={`${dashboard.defaultModel.alias} / ${providerLabel(dashboard.defaultModel.provider)}`} />
        </div>

        <p className="mini-list">
          {dashboard.lmStudio.loadedModels.length > 0
            ? dashboard.lmStudio.loadedModels.join(', ')
            : 'No models are currently loaded.'}
        </p>

        <div className="panel-actions wrap">
          <button
            className="primary"
            disabled={busyKey === 'lm-start'}
            onClick={() =>
              void mutate(
                'lm-start',
                '/api/lmstudio',
                { method: 'POST', body: JSON.stringify({ action: 'start' }) },
                'LM Studio server started.',
              )
            }
          >
            Start server
          </button>
          <button
            disabled={busyKey === 'lm-stop'}
            onClick={() =>
              void mutate(
                'lm-stop',
                '/api/lmstudio',
                { method: 'POST', body: JSON.stringify({ action: 'stop' }) },
                'LM Studio server stopped.',
              )
            }
          >
            Stop server
          </button>
          <button
            disabled={
              busyKey === 'lm-load' ||
              dashboard.defaultModel.provider !== dashboard.platform.activeLocalProviderId
            }
            onClick={() =>
              void mutate(
                'lm-load',
                '/api/lmstudio',
                { method: 'POST', body: JSON.stringify({ action: 'load-default' }) },
                'Default model loaded in LM Studio.',
              )
            }
          >
            Load default model
          </button>
          <button
            disabled={
              busyKey === 'lm-unload' ||
              dashboard.defaultModel.provider !== dashboard.platform.activeLocalProviderId
            }
            onClick={() =>
              void mutate(
                'lm-unload',
                '/api/lmstudio',
                { method: 'POST', body: JSON.stringify({ action: 'unload-default' }) },
                'Default model unloaded.',
              )
            }
          >
            Unload default model
          </button>
          <button
            disabled={busyKey === 'lm-unload-all'}
            onClick={() =>
              void mutate(
                'lm-unload-all',
                '/api/lmstudio',
                { method: 'POST', body: JSON.stringify({ action: 'unload-all' }) },
                'All LM Studio models unloaded.',
              )
            }
          >
            Free LM Studio memory
          </button>
        </div>
        <MemoryCleanupPanel />
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

        <div className="panel-actions wrap">
          <button
            className="primary"
            disabled={busyKey === `save-${job.name}`}
            onClick={() =>
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
              )
            }
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

        {job.dashboardFields.length > 0 ? (
          <div className="job-grid config-field-grid">
            {job.dashboardFields.map((field) => renderJobParamField(job, draft, field))}
          </div>
        ) : null}

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
        </div>
      </div>
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
            disabled={busyKey === `worker-delete-${worker.id}` || worker.builtIn}
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
          <label className="field">
            <span>OpenAI API key</span>
            <input
              type="password"
              value={openaiApiKeyDraft}
              placeholder={dashboard.integrations.openaiConfigured.ok ? 'Configured' : 'Not configured'}
              autoComplete="off"
              onChange={(event) => setOpenaiApiKeyDraft(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Anthropic API key</span>
            <input
              type="password"
              value={anthropicApiKeyDraft}
              placeholder={dashboard.integrations.anthropicConfigured.ok ? 'Configured' : 'Not configured'}
              autoComplete="off"
              onChange={(event) => setAnthropicApiKeyDraft(event.target.value)}
            />
          </label>
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
                {run.error ? (
                  <p className="error-text">{run.error}</p>
                ) : null}
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

function coreMenuCount(
  id: DashboardTab,
  counts: { workers: number; jobs: number; config: number; chat: number; system: number },
): number | undefined {
  switch (id) {
    case 'workers':
      return counts.workers;
    case 'jobs':
      return counts.jobs;
    case 'config':
      return counts.config;
    case 'chat':
      return counts.chat;
    case 'system':
      return counts.system;
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
  for (const segment of path.split('.')) {
    if (cursor === null || cursor === undefined || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
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

function StatusPill({
  children,
  tone,
}: {
  children: string;
  tone: 'good' | 'warning' | 'info' | 'muted';
}) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
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

function providerLabel(provider: ModelOption['provider']): string {
  if (provider === 'lmstudio') return 'LM Studio';
  if (provider === 'openai') return 'OpenAI';
  if (provider === 'anthropic') return 'Anthropic';
  return provider;
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
