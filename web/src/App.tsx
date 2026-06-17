import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Sidebar, type SidebarEntry } from './Sidebar';
import { TopBar } from './TopBar';
import { Markdown } from './Markdown';
import { loadRuntimeWorkerBundle, workerQueueItemDetails, useWorkerDashboardViews } from './workers/registry';
import type { WorkerDashboardViewDefinition } from './workers/types';
import { Wizard } from './Wizard';
import { AlertDialog, Button, CopyButton, Dialog, ManagementBar, PreviewLinkCard, Sheet } from './ui';
import { workerDashboardUi } from './workers/ui-contract';
import {
  ActionClass, ActionRequest, ActionState, AppBackupRecord, AppError, AuthSession, AutoBackupSettings, CORE_CHAT_PROMPTS, CORE_MENU_ENTRIES, ChatProject, ChatPromptButton, ChatPromptExample, ChatThread, ChatTurn, CoreConfigKey, CoreDashboardTab, DASHBOARD_REFRESH_INTERVAL_MS, DashboardSectionName, DashboardState, DashboardTab, EventLogRecord, HealthStatus, JOBS_REFRESH_INTERVAL_MS, JobBaseField, JobBooleanField, JobDashboardField, JobDraft, JobMetricsResponse, JobNumberField, JobParamDraftValue, JobPreset, JobRunMetrics, JobSecretReferenceField, JobSelectField, JobStringListField, JobTextField, JobTextareaField, ModelOption, PERMISSION_INFO, PlatformSettings, QueueFilter, QueueItem, RecipeInputStorage, RegisteredPlatformEntry, RunStatus, SchedulerJobState, SchedulerRunRecord, SourceQualityRules, StoreWorkerDetail, StoreWorkerListing, StoreWorkerVersion, WhatsNewEntry, WorkerDashboardManifest, WorkerDashboardSurface, WorkerHealthRequirementStatus, WorkerHealthState, WorkerJobSummary, WorkerKind, WorkerLoadIssue, WorkerOnboardingAction, WorkerOwnedSetting, WorkerRecipe, WorkerRecipeInput, WorkerRecipeStep, WorkerRunMetrics, WorkerSummary, WorkerTabDefinition, toAppError,
} from './app-types';
import {
  ChatSuggestions, ChatWelcome, Detail, DetailBlock, HealthRow, HelpTip, Metric, PipelineNode, PipelineTopology, RUN_ERROR_PREVIEW_CHARS, RunError, STORE_PALETTE_COUNT, STORE_VISUAL_RULES, StatusPill, StoreTrustBadge, StoreVisualWorker, StoreWorkerLogo, buildChatPromptButtons, buildJobParamsDraft, buildPipelineTopology, buildSurfaceDraft, buildWorkerTabDefinitions, configSurfaceKey, coreMenuCount, draftToHosts, eventSeverityTone, formatBytes, formatDate, formatDuration, formatRelativeTime, formatTime, hostsToDraft, jobConfigSummary, jobScheduleChanges, mergeSection, normalizeStringListItem, queueItemReason, queueItemTone, renderPipelineTab, renderWorkerDashboardView, resolveDashboardTab, resolveSeedPath, runDuration, runSeverity, runStatusSummary, runStatusTone, safeHost, safeWorkerViewCount, sectionEndpoint, sectionsForTab, serializeDashboardFields, serializeJobParams, statusTone, storeAuthorHandle, storeCategoryKey, storeCategoryLabel, storePaletteIndex, storeTrustTone, storeWorkerIcon, workerDeclaresView, workerOwnsEvent, workerTabId,
} from './app-helpers';
import { ActionsTab } from './tabs/ActionsTab';
import { HealthTab } from './tabs/HealthTab';
import { StoreTab } from './tabs/StoreTab';
import { ChannelsTab } from './tabs/ChannelsTab';
import { ChatTab } from './tabs/ChatTab';
import { WorkersTab } from './tabs/WorkersTab';
import { SystemTab } from './tabs/SystemTab';
import { OverviewTab } from './tabs/OverviewTab';
import { JobsTab } from './tabs/JobsTab';
import { ConfigTab } from './tabs/ConfigTab';
import { JobOperationsPanel } from './tabs/JobOperationsPanel';
import { PlatformRoutingPanel, PlatformSecurityPanel } from './tabs/PlatformConfigPanels';
import { WorkerConfigPage } from './tabs/WorkerConfigPage';

export default function App() {
  const [dashboard, setDashboard] = useState<DashboardState | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [selectedModelAlias, setSelectedModelAlias] = useState('');
  const [jobDrafts, setJobDrafts] = useState<Record<string, JobDraft>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [notice, setNotice] = useState<string>('Loading dashboard...');
  // Dismiss the first-run onboarding hero once the user has activated it (endpoint actions
  // don't create a scheduler run, so `hasRun` alone wouldn't hide the card).
  const [onboardingRan, setOnboardingRan] = useState(false);
  const [password, setPassword] = useState('');
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview');
  const [selectedJobName, setSelectedJobName] = useState<string | null>(null);
  const [selectedCoreConfigKey, setSelectedCoreConfigKey] = useState<CoreConfigKey | null>(null);
  const [surfaceDrafts, setSurfaceDrafts] = useState<Record<string, Record<string, JobParamDraftValue>>>({});
  const [openPromptEditors, setOpenPromptEditors] = useState<Record<string, boolean>>({});
  const [expandedChannelId, setExpandedChannelId] = useState<string | null>(null);
  const [customListItemDrafts, setCustomListItemDrafts] = useState<Record<string, string>>({});
  const [queueFilter, setQueueFilter] = useState<QueueFilter>('all');
  const [selectedQueueItemId, setSelectedQueueItemId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [chatDraft, setChatDraft] = useState('');
  const [chatTurns, setChatTurns] = useState<ChatTurn[]>([]);
  const [chatThreads, setChatThreads] = useState<ChatThread[]>([]);
  const [chatProjects, setChatProjects] = useState<ChatProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [chatArrivingFromOverview, setChatArrivingFromOverview] = useState(false);
  const [chatQuery, setChatQuery] = useState('');
  const [projectComboOpen, setProjectComboOpen] = useState(false);
  const [projectComboQuery, setProjectComboQuery] = useState('');
  const projectComboRef = useRef<HTMLDivElement | null>(null);
  const chatLogRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [workerUploadFile, setWorkerUploadFile] = useState<File | null>(null);

  // Describe-a-worker state
  const [workerDescription, setWorkerDescription] = useState<string>('');
  const [generatedWorker, setGeneratedWorker] = useState<
    { id: string; displayName: string; role: string; enabled: boolean; note?: string } | null
  >(null);

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
  // Install consent dialog: holds the worker pending user approval
  const [consentTarget, setConsentTarget] = useState<StoreWorkerDetail | null>(null);
  // Factory reset state
  const [resetChecks, setResetChecks] = useState({ wipeWorkerState: false, wipeCredentials: false, wipeBackups: false });
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  // In-product changelog
  const [whatsNew, setWhatsNew] = useState<WhatsNewEntry[] | null>(null);

  // Demo narration: stages that play out after the onboarding demo endpoint returns.
  const [demoNarration, setDemoNarration] = useState<{
    stages: Array<{ label: string; detail: string }>;
    currentIndex: number;
    done: boolean;
  } | null>(null);
  // Recap card shown after the narration finishes.
  const [demoRecap, setDemoRecap] = useState<{
    headline: string;
    body: string;
    ctaText?: string;
    ctaAction?: string;
  } | null>(null);

  // Recipe card state: which recipe is expanded, its current input values, and applied set.
  const [recipeExpanded, setRecipeExpanded] = useState<string | null>(null);
  const [recipeInputValues, setRecipeInputValues] = useState<Record<string, string>>({});
  const [recipeApplied, setRecipeApplied] = useState<Set<string>>(new Set());
  const [recipeApplying, setRecipeApplying] = useState(false);

  // Local runtime adoption — shown once per session when a local provider is detected running.
  const [lmAdoptDismissed, setLmAdoptDismissed] = useState(false);
  const [lmAdopting, setLmAdopting] = useState(false);

  // Cloud provider quick-connect widget state.
  const [cloudConnectProvider, setCloudConnectProvider] = useState('');
  const [cloudConnectKey, setCloudConnectKey] = useState('');
  const [cloudConnecting, setCloudConnecting] = useState(false);
  const [cloudTestReply, setCloudTestReply] = useState<string | null>(null);

  // First real result notification — shown once when the first non-demo job succeeds.
  const [firstResultJob, setFirstResultJob] = useState<{ label: string; summary: string; jobName: string } | null>(null);
  const firstResultShownKey = 'bfrost:first-result-shown';

  // One-time star ask, surfaced at the first moment of delight (demo recap or
  // first real result). Dismissing or clicking it means it never shows again.
  const starAskKey = 'bfrost:star-ask-shown';
  const [starAsk, setStarAsk] = useState(false);
  useEffect(() => {
    if (!demoRecap && !firstResultJob) return;
    if (localStorage.getItem(starAskKey)) return;
    setStarAsk(true);
  }, [demoRecap, firstResultJob]);
  const dismissStarAsk = () => {
    localStorage.setItem(starAskKey, '1');
    setStarAsk(false);
  };

  // Stable handler for the demo action — shared between the Overview hero and the wizard CTA
  // so both paths produce the same narration + recap experience.
  const runDemoAction = async (action: WorkerOnboardingAction & { workerId: string }) => {
    setDemoNarration(null);
    setDemoRecap(null);
    setActiveTab('overview');
    setBusyKey(`onboarding:${action.id}`);
    try {
      if (action.endpoint) {
        const res = await fetch(action.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: '{}',
        });
        if (!res.ok) throw new Error((await res.text()) || 'Request failed');
        const body = (await res.json().catch(() => ({}))) as {
          summary?: string;
          stages?: Array<{ label: string; detail: string }>;
          recap?: { headline: string; body: string; ctaText?: string; ctaAction?: string };
        };
        setOnboardingRan(true);
        if (body.stages && body.stages.length > 0) {
          setDemoNarration({ stages: body.stages, currentIndex: 0, done: false });
          for (let i = 0; i < body.stages.length; i++) {
            setDemoNarration((prev) => prev ? { ...prev, currentIndex: i } : prev);
            await new Promise((r) => setTimeout(r, 900));
          }
          setDemoNarration((prev) => prev ? { ...prev, done: true } : prev);
        }
        await fetchDashboard(true);
        if (body.recap) {
          setDemoRecap(body.recap);
        } else {
          setNotice(body.summary ?? 'Done — open Pipeline to see the items in the bus.');
        }
      } else if (action.runJob) {
        const res = await fetch(`/api/cron-jobs/${encodeURIComponent(action.runJob)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'run' }),
        });
        if (!res.ok) throw new Error(await res.text());
        setNotice('Running… results will appear in the Pipeline and Jobs tabs in a moment.');
        await new Promise((r) => setTimeout(r, 1500));
        await fetchDashboard(true);
        setNotice('Done — open Pipeline to see the items in the bus.');
      }
    } catch (err) {
      setError(toAppError(err));
    } finally {
      setBusyKey(null);
    }
  };

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
  const [wizardCompleted, setWizardCompleted] = useState(true); // default true avoids flash before data loads

  // Preview-before-save for schedule edits: holds job.name when awaiting confirmation
  const [confirmSaveJobName, setConfirmSaveJobName] = useState<string | null>(null);

  // Auto-backup settings state (system tab)
  const [autoBackupSettings, setAutoBackupSettings] = useState<AutoBackupSettings | null>(null);
  const [activeLocalProviderDraft, setActiveLocalProviderDraft] = useState('');
  const [primaryChannelDraft, setPrimaryChannelDraft] = useState('');
  // Platform & Security panel drafts. Password is write-only: we never receive the current value,
  // only `platform.adminPasswordSet`. Numeric fields seed from the live dashboard on first edit.
  const [adminPasswordDraft, setAdminPasswordDraft] = useState('');
  const [sessionTtlDraft, setSessionTtlDraft] = useState<string | null>(null);
  const [jobTimeoutDraft, setJobTimeoutDraft] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('bfrost.sidebarCollapsed') === 'true';
  });
  const [sidebarMobileOpen, setSidebarMobileOpen] = useState(false);

  useEffect(() => {
    window.localStorage.setItem('bfrost.sidebarCollapsed', String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!sidebarMobileOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setSidebarMobileOpen(false);
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [sidebarMobileOpen]);

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

  // Load the chat history list and projects whenever the Chat tab is opened.
  useEffect(() => {
    if (activeTab !== 'chat') return;
    void loadChatThreads();
    void loadChatProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'chat' || !chatArrivingFromOverview) return;
    const focusTimer = window.setTimeout(() => chatInputRef.current?.focus(), 120);
    const animationTimer = window.setTimeout(() => setChatArrivingFromOverview(false), 720);
    return () => {
      window.clearTimeout(focusTimer);
      window.clearTimeout(animationTimer);
    };
  }, [activeTab, chatArrivingFromOverview]);

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

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (projectComboRef.current && !projectComboRef.current.contains(e.target as Node)) {
        setProjectComboOpen(false);
        setProjectComboQuery('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Detect the first successful non-demo job run and surface it inline.
  useEffect(() => {
    if (localStorage.getItem(firstResultShownKey)) return;
    const jobs = dashboard?.cron?.jobs ?? [];
    const hit = jobs.find(
      (j) => j.workerId !== 'core.demo' && j.lastStatus === 'success' && j.lastSummary && j.lastFinishedAt,
    );
    if (hit) setFirstResultJob({ label: hit.label, summary: hit.lastSummary!, jobName: hit.name });
  }, [dashboard?.cron?.jobs]);

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
          setWizardCompleted(wizState.completed);
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
      recipes: shell.recipes ?? [],
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
        throw new Error('error' in payload ? String(payload.error) : 'Failed to load dashboard');
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

  async function generateWorkerFromDescription() {
    const description = workerDescription.trim();
    if (description.length < 8) {
      setError({ friendly: 'Describe the worker you want in a sentence or two first.' });
      return;
    }
    setBusyKey('worker-generate');
    setError(null);
    try {
      const response = await fetch('/api/workers/generate', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      });
      const payload = (await response.json()) as {
        error?: string;
        worker?: { id: string; displayName: string; role: string };
        enabled?: boolean;
        note?: string;
        dashboard?: DashboardState;
      };
      if (!response.ok || 'error' in payload) {
        if (response.status === 401) setSession({ authenticated: false, authEnabled: true });
        throw new Error(payload.error ?? 'Worker generation failed');
      }
      if (payload.dashboard) setDashboard(payload.dashboard);
      if (payload.worker) {
        setGeneratedWorker({
          id: payload.worker.id,
          displayName: payload.worker.displayName,
          role: payload.worker.role,
          enabled: Boolean(payload.enabled),
          note: payload.note,
        });
        setWorkerDescription('');
        setNotice(
          payload.enabled
            ? `Created and enabled "${payload.worker.displayName}". Open the Jobs tab and Run now to see it work.`
            : `Created "${payload.worker.displayName}". ${payload.note ?? ''}`,
        );
      }
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

  async function saveCoreSettings(patch: {
    adminPassword?: string;
    localWorkerCodeEnabled?: boolean;
    adminSessionTtlHours?: number;
    jobLlmTimeoutMs?: number;
  }) {
    const body: Record<string, unknown> = {};
    if (patch.adminPassword !== undefined) body.adminPassword = patch.adminPassword;
    if (patch.localWorkerCodeEnabled !== undefined) body.localWorkerCodeEnabled = patch.localWorkerCodeEnabled;
    if (patch.adminSessionTtlHours !== undefined) body.adminSessionTtlHours = patch.adminSessionTtlHours;
    if (patch.jobLlmTimeoutMs !== undefined) body.jobLlmTimeoutMs = patch.jobLlmTimeoutMs;
    if (Object.keys(body).length === 0) return;

    await mutate(
      'save-core-settings',
      '/api/core-settings',
      { method: 'POST', body: JSON.stringify(body) },
      'Platform & security settings updated.',
    );
    setAdminPasswordDraft('');
    setSessionTtlDraft(null);
    setJobTimeoutDraft(null);
    // Changing the password clears all sessions server-side; re-check so the login screen
    // appears immediately if we just enabled (or rotated) auth.
    if (patch.adminPassword !== undefined) {
      void refreshSession(false);
    }
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

  function mintConversationId(): string {
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `dashboard-${id}`;
  }

  async function loadChatThreads() {
    try {
      const response = await fetch('/api/chats', { credentials: 'include' });
      if (!response.ok) return;
      const payload = (await response.json()) as { threads: ChatThread[] };
      setChatThreads(payload.threads ?? []);
    } catch {
      /* non-fatal — history list is best-effort */
    }
  }

  async function loadChatProjects() {
    try {
      const response = await fetch('/api/projects', { credentials: 'include' });
      if (!response.ok) return;
      const payload = (await response.json()) as { projects: ChatProject[] };
      setChatProjects(payload.projects ?? []);
    } catch {
      /* non-fatal — projects are best-effort */
    }
  }

  async function createChatProject() {
    const name = window.prompt('New project name')?.trim();
    if (!name) return;
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) throw new Error('Failed to create project');
      const { project } = (await response.json()) as { project: ChatProject };
      await loadChatProjects();
      setActiveProjectId(project.projectId);
      startNewChat();
    } catch (err) {
      setError(toAppError(err));
    }
  }

  function startNewChat() {
    setActiveConversationId(mintConversationId());
    setChatTurns([]);
    setError(null);
    window.requestAnimationFrame(() => chatInputRef.current?.focus());
  }

  async function openChatThread(thread: ChatThread) {
    setBusyKey(`open-chat-${thread.conversationId}`);
    setError(null);
    try {
      const response = await fetch(`/api/chats/${encodeURIComponent(thread.conversationId)}`, {
        credentials: 'include',
      });
      const payload = (await response.json()) as
        | { thread: ChatThread; turns: { role: 'user' | 'assistant'; text: string }[] }
        | { error: string };
      if (!response.ok || 'error' in payload) {
        throw new Error('error' in payload ? payload.error : 'Failed to open chat');
      }
      setActiveConversationId(thread.conversationId);
      setActiveProjectId(thread.projectId ?? null);
      setChatTurns(
        payload.turns.map((turn) => ({ ...turn, createdAt: thread.lastMessageAt })),
      );
    } catch (err) {
      setError(toAppError(err));
    } finally {
      setBusyKey(null);
    }
  }

  async function renameChatThread(thread: ChatThread) {
    const title = window.prompt('Rename chat', thread.title)?.trim();
    if (!title || title === thread.title) return;
    try {
      const response = await fetch(`/api/chats/${encodeURIComponent(thread.conversationId)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (!response.ok) throw new Error('Rename failed');
      await loadChatThreads();
    } catch (err) {
      setError(toAppError(err));
    }
  }

  async function deleteChatThread(thread: ChatThread) {
    if (!window.confirm(`Delete chat "${thread.title}"? This cannot be undone.`)) return;
    try {
      const response = await fetch(`/api/chats/${encodeURIComponent(thread.conversationId)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Delete failed');
      if (activeConversationId === thread.conversationId) {
        setActiveConversationId(null);
        setChatTurns([]);
      }
      await loadChatThreads();
    } catch (err) {
      setError(toAppError(err));
    }
  }

  async function sendDashboardChat() {
    const message = chatDraft.trim();
    if (!message) return;

    const conversationId = activeConversationId ?? mintConversationId();
    if (!activeConversationId) setActiveConversationId(conversationId);

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
        body: JSON.stringify({ message, conversationId, projectId: activeProjectId ?? undefined }),
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
      await loadChatThreads();
      setNotice('Dashboard chat answered.');
    } catch (err) {
      setError(toAppError(err));
    } finally {
      setBusyKey(null);
    }
  }

  function fillChatDraft(prompt: string) {
    setChatDraft(prompt);
    window.requestAnimationFrame(() => chatInputRef.current?.focus());
  }

  function openChatFromOverview() {
    setChatArrivingFromOverview(true);
    setActiveTab('chat');
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
          {error ? <p className="error-text">{error.friendly}</p> : null}
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
    .filter((worker) => worker.enabled)
    .map((worker) => ({
      worker,
      jobs: dashboard.cron.jobs.filter((job) => job.workerId === worker.id),
    }))
    .filter((group) => group.jobs.length > 0);
  const configGroupsByWorker = dashboard.workers
    .filter((worker) => worker.enabled && worker.kind !== 'channel')
    .map((worker) => ({
      worker,
      surfaces: worker.dashboard.settings.filter((surface) => surface.tab === 'config'),
    }))
    .filter((group) => group.surfaces.length > 0);
  const configJobCount = 0;
  const configSurfaceCount = 0; // worker surfaces now live in per-worker Config tabs
  const configCoreCount = 3; // platform routing + embedding + security
  const workerTabDefinitions = buildWorkerTabDefinitions(dashboard.workers, dashboardViews);
  const activeWorkerTab = workerTabDefinitions.find((tab) => tab.id === activeTab) ?? null;
  const workerViewContext = {
    ui: workerDashboardUi,
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
      group: tab.definition.menu?.group ?? (tab.worker.section === 'system' ? 'System' : 'Workers'),
      order: tab.definition.menu?.order ?? 1000,
      count: safeWorkerViewCount(tab.definition, workerViewContext),
    })),
    // Per-worker Config entries.
    // Workers WITH a dashboard tab → "Config" child under the parent.
    // Workers WITHOUT a dashboard tab → standalone entry with the worker's name (no orphan "Config").
    ...configGroupsByWorker.flatMap(({ worker }) => {
      const workerTab = workerTabDefinitions.find((t) => t.worker.id === worker.id);
      const baseOrder = workerTab ? (workerTab.definition.menu?.order ?? 1000) : 900;
      const workerSection = worker.section === 'system' ? 'System' : 'Workers';
      const group = workerTab ? (workerTab.definition.menu?.group ?? workerSection) : workerSection;
      if (workerTab) {
        return [{
          id: `worker-config:${worker.id}` as DashboardTab,
          label: 'Config',
          icon: 'config',
          group,
          order: baseOrder + 0.5,
          parentId: workerTab.id as DashboardTab,
        }];
      }
      // No dashboard tab: use the worker's display name, no parent indentation.
      return [{
        id: `worker-config:${worker.id}` as DashboardTab,
        label: worker.displayName ?? worker.name,
        icon: 'config',
        group,
        order: baseOrder,
      }];
    }),
  ];

  return (
    <div className={`dashboard-layout${sidebarCollapsed ? ' sidebar-collapsed' : ''}${sidebarMobileOpen ? ' sidebar-mobile-open' : ''}`}>
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
        onOpenNavigation={() => setSidebarMobileOpen(true)}
        onModelChange={(event) => setSelectedModelAlias(event.target.value)}
        onSaveModel={() => saveDefaultModel(selectedModelAlias)}
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
        onSelect={(tab) => {
          setActiveTab(tab);
          setSidebarMobileOpen(false);
        }}
        onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
      />
      <button
        className="sidebar-mobile-backdrop"
        type="button"
        aria-label="Close navigation"
        onClick={() => setSidebarMobileOpen(false)}
      />
      <main className="shell dashboard-main">

      {/* Generic "special mode" banner: shown on every tab while any enabled worker exposes a
          demoNotice. Names no worker — deleting/disabling the worker removes its banner. */}
      {dashboard.workers
        .filter((w) => w.enabled && w.demoNotice)
        .map((w) => (
          <div key={`demo-notice-${w.id}`} className="demo-notice-banner" role="status">
            <span aria-hidden="true">🧪</span>
            <span>{w.demoNotice}</span>
            {w.deletable ? (
              <button
                type="button"
                disabled={busyKey === `banner-delete-${w.id}`}
                onClick={() => {
                  if (!window.confirm(`Delete ${w.name}? You can restore it from the Worker store later.`)) return;
                  setBusyKey(`banner-delete-${w.id}`);
                  fetch(`/api/workers/${encodeURIComponent(w.id)}`, { method: 'DELETE', credentials: 'include' })
                    .then(() => fetchDashboard(true))
                    .catch((err: unknown) => setError(toAppError(err)))
                    .finally(() => setBusyKey(null));
                }}
              >
                {busyKey === `banner-delete-${w.id}` ? 'Deleting…' : 'Delete'}
              </button>
            ) : (
              <button type="button" onClick={() => setActiveTab('workers')}>
                Open Workers
              </button>
            )}
          </div>
        ))}

      {activeTab === 'overview' ? (
        <OverviewTab
          dashboard={dashboard}
          busyKey={busyKey}
          setBusyKey={setBusyKey}
          setError={setError}
          setDashboard={setDashboard}
          setActiveTab={setActiveTab}
          onboardingRan={onboardingRan}
          runDemoAction={runDemoAction}
          fetchDashboard={fetchDashboard}
          firstResultJob={firstResultJob}
          firstResultShownKey={firstResultShownKey}
          setFirstResultJob={setFirstResultJob}
          lmAdoptDismissed={lmAdoptDismissed}
          setLmAdoptDismissed={setLmAdoptDismissed}
          lmAdopting={lmAdopting}
          setLmAdopting={setLmAdopting}
          demoNarration={demoNarration}
          demoRecap={demoRecap}
          setDemoRecap={setDemoRecap}
          setWizardOpen={setWizardOpen}
          starAsk={starAsk}
          dismissStarAsk={dismissStarAsk}
          wizardCompleted={wizardCompleted}
          cloudTestReply={cloudTestReply}
          setCloudTestReply={setCloudTestReply}
          cloudConnectProvider={cloudConnectProvider}
          setCloudConnectProvider={setCloudConnectProvider}
          cloudConnectKey={cloudConnectKey}
          setCloudConnectKey={setCloudConnectKey}
          cloudConnecting={cloudConnecting}
          setCloudConnecting={setCloudConnecting}
          recipeApplied={recipeApplied}
          setRecipeApplied={setRecipeApplied}
          recipeExpanded={recipeExpanded}
          setRecipeExpanded={setRecipeExpanded}
          recipeInputValues={recipeInputValues}
          setRecipeInputValues={setRecipeInputValues}
          recipeApplying={recipeApplying}
          setRecipeApplying={setRecipeApplying}
          openChatFromOverview={openChatFromOverview}
          renderStuckDetectorBanner={renderStuckDetectorBanner}
          dashboardViews={dashboardViews}
          workerViewContext={workerViewContext}
          selectedModelAlias={selectedModelAlias}
          setSelectedModelAlias={setSelectedModelAlias}
          saveDefaultModel={saveDefaultModel}
          setNotice={setNotice}
        />
      ) : null}


      {activeTab === 'chat' ? (
        <ChatTab
          dashboard={dashboard}
          dashboardViews={dashboardViews}
          busyKey={busyKey}
          chatDraft={chatDraft}
          setChatDraft={setChatDraft}
          chatTurns={chatTurns}
          chatThreads={chatThreads}
          chatProjects={chatProjects}
          activeProjectId={activeProjectId}
          setActiveProjectId={setActiveProjectId}
          activeConversationId={activeConversationId}
          chatArrivingFromOverview={chatArrivingFromOverview}
          chatQuery={chatQuery}
          setChatQuery={setChatQuery}
          projectComboOpen={projectComboOpen}
          setProjectComboOpen={setProjectComboOpen}
          projectComboQuery={projectComboQuery}
          setProjectComboQuery={setProjectComboQuery}
          projectComboRef={projectComboRef}
          chatLogRef={chatLogRef}
          chatInputRef={chatInputRef}
          createChatProject={createChatProject}
          startNewChat={startNewChat}
          openChatThread={openChatThread}
          renameChatThread={renameChatThread}
          deleteChatThread={deleteChatThread}
          sendDashboardChat={sendDashboardChat}
          fillChatDraft={fillChatDraft}
        />
      ) : null}

      {activeTab === 'channels' ? (
        <ChannelsTab
          dashboard={dashboard}
          expandedChannelId={expandedChannelId}
          setExpandedChannelId={setExpandedChannelId}
          dashboardViews={dashboardViews}
          fetchDashboard={fetchDashboard}
        />
      ) : null}

      {activeTab === 'jobs' ? (
        <JobsTab
          dashboard={dashboard}
          jobsByWorker={jobsByWorker}
          selectedJob={selectedJob}
          selectedJobRuns={selectedJobRuns}
          setSelectedJobName={setSelectedJobName}
          renderJobOperations={(job, runs) => (
            <JobOperationsPanel
              dashboard={dashboard}
              job={job}
              runs={runs}
              busyKey={busyKey}
              jobDrafts={jobDrafts}
              setJobDrafts={setJobDrafts}
              confirmSaveJobName={confirmSaveJobName}
              setConfirmSaveJobName={setConfirmSaveJobName}
              openPromptEditors={openPromptEditors}
              setOpenPromptEditors={setOpenPromptEditors}
              customListItemDrafts={customListItemDrafts}
              setCustomListItemDrafts={setCustomListItemDrafts}
              mutate={mutate}
              triggerRun={triggerRun}
            />
          )}
        />
      ) : null}

      {activeTab === 'config' ? (
        <ConfigTab
          dashboard={dashboard}
          configCoreCount={configCoreCount}
          selectedCoreConfigKey={selectedCoreConfigKey}
          setSelectedCoreConfigKey={setSelectedCoreConfigKey}
          dashboardViews={dashboardViews}
          workerViewContext={workerViewContext}
          platformRoutingPanel={
            <PlatformRoutingPanel
              dashboard={dashboard}
              busyKey={busyKey}
              activeLocalProviderDraft={activeLocalProviderDraft}
              setActiveLocalProviderDraft={setActiveLocalProviderDraft}
              primaryChannelDraft={primaryChannelDraft}
              setPrimaryChannelDraft={setPrimaryChannelDraft}
              savePlatformRouting={savePlatformRouting}
            />
          }
          platformSecurityPanel={
            <PlatformSecurityPanel
              dashboard={dashboard}
              busyKey={busyKey}
              adminPasswordDraft={adminPasswordDraft}
              setAdminPasswordDraft={setAdminPasswordDraft}
              sessionTtlDraft={sessionTtlDraft}
              setSessionTtlDraft={setSessionTtlDraft}
              jobTimeoutDraft={jobTimeoutDraft}
              setJobTimeoutDraft={setJobTimeoutDraft}
              saveCoreSettings={saveCoreSettings}
            />
          }
          setActiveTab={setActiveTab}
          setWizardOpen={setWizardOpen}
        />
      ) : null}

      {activeWorkerTab ? renderWorkerDashboardView(activeWorkerTab, workerViewContext) : null}

      {activeTab.startsWith('worker-config:') ? (() => {
        const workerId = activeTab.slice('worker-config:'.length);
        const group = configGroupsByWorker.find((g) => g.worker.id === workerId);
        if (!group) return null;
        return (
          <WorkerConfigPage
            worker={group.worker}
            surfaces={group.surfaces}
            dashboard={dashboard}
            dashboardViews={dashboardViews}
            surfaceDrafts={surfaceDrafts}
            setSurfaceDrafts={setSurfaceDrafts}
            customListItemDrafts={customListItemDrafts}
            setCustomListItemDrafts={setCustomListItemDrafts}
            busyKey={busyKey}
            fetchDashboard={fetchDashboard}
            saveWorkerConfigurationSurface={saveWorkerConfigurationSurface}
          />
        );
      })() : null}


      {activeTab === 'workers' ? (
        <WorkersTab
          dashboard={dashboard}
          busyKey={busyKey}
          workerDescription={workerDescription}
          setWorkerDescription={setWorkerDescription}
          generatedWorker={generatedWorker}
          workerUploadFile={workerUploadFile}
          setWorkerUploadFile={setWorkerUploadFile}
          storeUpdates={storeUpdates}
          generateWorkerFromDescription={generateWorkerFromDescription}
          uploadWorkerZip={uploadWorkerZip}
          deleteWorker={deleteWorker}
          mutate={mutate}
        />
      ) : null}
      {activeTab === 'store' ? (
        <StoreTab
          dashboard={dashboard}
          storeWorkers={storeWorkers}
          storeLoading={storeLoading}
          storeError={storeError}
          storeQuery={storeQuery}
          setStoreQuery={setStoreQuery}
          storeQueryInput={storeQueryInput}
          setStoreQueryInput={setStoreQueryInput}
          storeCategoryFilter={storeCategoryFilter}
          setStoreCategoryFilter={setStoreCategoryFilter}
          storeSelectedId={storeSelectedId}
          setStoreSelectedId={setStoreSelectedId}
          storeDetail={storeDetail}
          setStoreDetail={setStoreDetail}
          storeDetailLoading={storeDetailLoading}
          sideloadFile={sideloadFile}
          setSideloadFile={setSideloadFile}
          setConsentTarget={setConsentTarget}
          busyKey={busyKey}
          fetchStoreCatalog={fetchStoreCatalog}
          fetchStoreDetail={fetchStoreDetail}
          installFromStore={installFromStore}
          sideloadWorkerZip={sideloadWorkerZip}
          mutate={mutate}
        />
      ) : null}

      {activeTab === 'pipeline' ? renderPipelineTab(dashboard, () => setActiveTab('overview')) : null}

      {activeTab === 'health' ? (
        <HealthTab
          jobMetrics={jobMetrics}
          jobMetricsLoading={jobMetricsLoading}
          jobMetricsError={jobMetricsError}
          fetchJobMetrics={fetchJobMetrics}
          expandedWorkerIds={expandedWorkerIds}
          setExpandedWorkerIds={setExpandedWorkerIds}
          setActiveTab={setActiveTab}
        />
      ) : null}

      {activeTab === 'actions' ? (
        <ActionsTab
          pendingActions={pendingActions}
          actionHistory={actionHistory}
          actionsLoading={actionsLoading}
          selectedActionId={selectedActionId}
          setSelectedActionId={setSelectedActionId}
          busyKey={busyKey}
          decideAction={decideAction}
          fetchPendingActions={fetchPendingActions}
        />
      ) : null}


      {activeTab === 'system' ? (
        <SystemTab
          dashboard={dashboard}
          whatsNew={whatsNew}
          autoBackupSettings={autoBackupSettings}
          setAutoBackupSettings={setAutoBackupSettings}
          saveAutoBackup={saveAutoBackup}
          busyKey={busyKey}
          mutate={mutate}
          restoreBackup={restoreBackup}
          cancelRestore={cancelRestore}
          resetChecks={resetChecks}
          setResetChecks={setResetChecks}
          resetConfirmOpen={resetConfirmOpen}
          setResetConfirmOpen={setResetConfirmOpen}
          executeFactoryReset={executeFactoryReset}
          setActiveTab={setActiveTab}
        />
      ) : null}
      </main>

      {/* First-run wizard overlay */}
      {wizardOpen && dashboard ? (
        <Wizard
          dashboard={dashboard}
          onDismiss={() => {
            setWizardOpen(false);
            setWizardCompleted(true);
            void fetch('/api/wizard/state', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ completed: true }),
            });
          }}
          onComplete={() => {
            setWizardOpen(false);
            setWizardCompleted(true);
            void fetchDashboard(true);
          }}
          onRefreshDashboard={() => fetchDashboard(true)}
          onNavigate={(tab) => {
            setWizardOpen(false);
            setActiveTab(tab as CoreDashboardTab);
          }}
          onRunDemoAction={(action) => {
            setWizardOpen(false);
            setWizardCompleted(true);
            void fetch('/api/wizard/state', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ completed: true }),
            });
            void runDemoAction(action as WorkerOnboardingAction & { workerId: string });
          }}
        />
      ) : null}

      {/* Install permission consent dialog */}
      <Dialog
        open={!!consentTarget}
        onOpenChange={(open) => {
          if (!open) setConsentTarget(null);
        }}
        title={consentTarget ? `Install "${consentTarget.name}"?` : 'Install worker?'}
        description="Review the permissions this worker requires before proceeding."
        footer={consentTarget ? (
          <>
            <Button variant="ghost" onClick={() => setConsentTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={busyKey === `store-install-${consentTarget.id}`}
              onClick={() => {
                const target = consentTarget;
                setConsentTarget(null);
                void installFromStore(target);
              }}
            >
              Approve and install
            </Button>
          </>
        ) : null}
      >
        {consentTarget ? (
          <div className="consent-body">
            {consentTarget.permissions.length === 0 ? (
              <p className="consent-no-perms">This worker declares no special permissions.</p>
            ) : (
              <ul className="consent-perm-list">
                {consentTarget.permissions.map((perm) => {
                  const info = PERMISSION_INFO[perm];
                  return (
                    <li key={perm} className="consent-perm-item">
                      <span className="consent-perm-label">{info?.label ?? perm}</span>
                      {info?.description ? (
                        <span className="consent-perm-desc">{info.description}</span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="consent-trust-line">
              Trust level: <strong>{consentTarget.trust}</strong>
            </p>
          </div>
        ) : null}
      </Dialog>
    </div>
  );

  function saveDefaultModel(alias: string) {
    void mutate(
      'save-model',
      '/api/default-model',
      {
        method: 'POST',
        body: JSON.stringify({ alias }),
      },
      'Default model updated.',
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
          {(item.state === 'queued' || item.state === 'failed' || item.state === 'rejected') ? (
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

  // ── Stuck detector banner ─────────────────────────────────────────────────

  function renderStuckDetectorBanner() {
    const currentDashboard = dashboard;
    if (!currentDashboard) return null;
    const STUCK_THRESHOLD = 3;
    const stuckJobs = currentDashboard.cron.jobs.filter(
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



  // ── Store tab ─────────────────────────────────────────────────────────────


  function renderQueueMetrics(interactive: boolean) {
    const currentDashboard = dashboard;
    if (!currentDashboard) return null;
    return (
      <div className="metric-row">
        <Metric label="Total" value={String(currentDashboard.queue.total)} active={queueFilter === 'all'} onClick={interactive ? () => setQueueFilter('all') : undefined} />
        <Metric label="Queued" value={String(currentDashboard.queue.queued)} active={queueFilter === 'queued'} onClick={interactive ? () => setQueueFilter('queued') : undefined} />
        <Metric label="Approved" value={String(currentDashboard.queue.approved)} active={queueFilter === 'approved'} onClick={interactive ? () => setQueueFilter('approved') : undefined} />
        <Metric label="Posted" value={String(currentDashboard.queue.posted)} active={queueFilter === 'posted'} onClick={interactive ? () => setQueueFilter('posted') : undefined} />
        <Metric label="Rejected" value={String(currentDashboard.queue.rejected)} active={queueFilter === 'rejected'} onClick={interactive ? () => setQueueFilter('rejected') : undefined} />
        <Metric label="Failed" value={String(currentDashboard.queue.failed)} active={queueFilter === 'failed'} onClick={interactive ? () => setQueueFilter('failed') : undefined} />
        <Metric label="Seen" value={String(currentDashboard.queue.seen)} active={queueFilter === 'seen'} onClick={interactive ? () => setQueueFilter('seen') : undefined} />
        <Metric label="Retrying" value={String(currentDashboard.queue.retrying)} active={queueFilter === 'retrying'} onClick={interactive ? () => setQueueFilter('retrying') : undefined} />
      </div>
    );
  }
}
