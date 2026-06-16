import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Sidebar, type SidebarEntry } from './Sidebar';
import { TopBar } from './TopBar';
import { Markdown } from './Markdown';
import { loadRuntimeWorkerBundle, workerQueueItemDetails, useWorkerDashboardViews } from './workers/registry';
import type { WorkerDashboardViewDefinition } from './workers/types';
import { Wizard } from './Wizard';
import { AlertDialog, Button, CopyButton, CronBuilder, Dialog, ManagementBar, PreviewLinkCard, Progress, Sheet } from './ui';
import { workerDashboardUi } from './workers/ui-contract';
import {
  ActionClass, ActionRequest, ActionState, AppBackupRecord, AppError, AuthSession, AutoBackupSettings, CORE_CHAT_PROMPTS, CORE_MENU_ENTRIES, ChatProject, ChatPromptButton, ChatPromptExample, ChatThread, ChatTurn, CoreConfigKey, CoreDashboardTab, DASHBOARD_REFRESH_INTERVAL_MS, DashboardSectionName, DashboardState, DashboardTab, EventLogRecord, HealthStatus, JOBS_REFRESH_INTERVAL_MS, JobBaseField, JobBooleanField, JobDashboardField, JobDraft, JobMetricsResponse, JobNumberField, JobParamDraftValue, JobPreset, JobRunMetrics, JobSecretReferenceField, JobSelectField, JobStringListField, JobTextField, JobTextareaField, ModelOption, PERMISSION_INFO, PlatformSettings, QueueFilter, QueueItem, RecipeInputStorage, RegisteredPlatformEntry, RunStatus, SchedulerJobState, SchedulerRunRecord, SourceQualityRules, StoreWorkerDetail, StoreWorkerListing, StoreWorkerVersion, WhatsNewEntry, WorkerDashboardManifest, WorkerDashboardSurface, WorkerHealthRequirementStatus, WorkerHealthState, WorkerJobSummary, WorkerKind, WorkerLoadIssue, WorkerOnboardingAction, WorkerOwnedSetting, WorkerRecipe, WorkerRecipeInput, WorkerRecipeStep, WorkerRunMetrics, WorkerSummary, WorkerTabDefinition, toAppError,
} from './app-types';
import {
  ChatSuggestions, ChatWelcome, Detail, DetailBlock, HealthRow, HelpTip, Metric, PipelineNode, PipelineTopology, RUN_ERROR_PREVIEW_CHARS, RunError, STORE_PALETTE_COUNT, STORE_VISUAL_RULES, StatusPill, StoreTrustBadge, StoreVisualWorker, StoreWorkerLogo, addStringListDraftValue, buildChatPromptButtons, buildJobParamsDraft, buildPipelineTopology, buildSurfaceDraft, buildWorkerTabDefinitions, configSurfaceKey, coreMenuCount, draftToHosts, eventSeverityTone, fieldDefaultDraftValue, fieldListPlaceholder, formatBytes, formatDate, formatDuration, formatRelativeTime, formatTime, hostsToDraft, jobConfigSummary, jobScheduleChanges, mergeSection, normalizeStringListItem, providerLabel, queueItemReason, queueItemTone, renderPipelineTab, renderWorkerDashboardView, resolveDashboardTab, resolveSeedPath, runDuration, runSeverity, runStatusSummary, runStatusTone, safeHost, safeWorkerViewCount, sectionEndpoint, sectionsForTab, serializeDashboardFields, serializeJobParams, statusTone, storeAuthorHandle, storeCategoryKey, storeCategoryLabel, storePaletteIndex, storeTrustTone, storeWorkerIcon, stringListDraftIncludes, stringListDraftItems, stringListDraftRows, surfaceDraftHasValue, toggleStringListDraftValue, workerDeclaresView, workerHealthLabel, workerHealthTone, workerOwnsEvent, workerTabId,
} from './app-helpers';
import { ActionsTab } from './tabs/ActionsTab';
import { HealthTab } from './tabs/HealthTab';
import { StoreTab } from './tabs/StoreTab';
import { ChannelsTab } from './tabs/ChannelsTab';

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

  // LM Studio psychic adoption — shown once per session when LM Studio is detected running.
  const [lmAdoptDismissed, setLmAdoptDismissed] = useState(false);
  const [lmAdopting, setLmAdopting] = useState(false);

  // Cloud provider quick-connect widget state.
  const [cloudConnectProvider, setCloudConnectProvider] = useState<'openai' | 'anthropic'>('openai');
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
        <section className="tab-page">
          {renderStuckDetectorBanner()}
          {(() => {
            // Generic first-run CTA: surface whatever onboarding actions the worker registry
            // exposes until the user has run something. Names no worker — removing the worker
            // that contributes the action removes this card.
            const hasRun = dashboard.cron.jobs.some((j) => j.lastStartedAt !== null && j.lastStartedAt !== undefined);
            if (hasRun || onboardingRan) return null;
            const actions = dashboard.workers
              .filter((w) => w.onboarding && w.enabled)
              .map((w) => ({ ...(w.onboarding as WorkerOnboardingAction), workerId: w.id }))
              .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
            if (actions.length === 0) return null;
            const runAction = runDemoAction;
            const deletableDemoWorkers = actions
              .map((a) => dashboard.workers.find((w) => w.id === a.workerId))
              .filter((w): w is NonNullable<typeof w> => Boolean(w?.deletable));

            const dismissDemo = async () => {
              if (!window.confirm('Delete the demo worker? You can restore it from the Worker store later.')) return;
              setBusyKey('onboarding:dismiss');
              try {
                for (const w of deletableDemoWorkers) {
                  await fetch(`/api/workers/${encodeURIComponent(w.id)}`, {
                    method: 'DELETE',
                    credentials: 'include',
                  });
                }
                await fetchDashboard(true);
              } catch (err) {
                setError(toAppError(err));
              } finally {
                setBusyKey(null);
              }
            };

            return (
              <section className="panel onboarding-hero">
                <div className="panel-head">
                  <div>
                    <p className="panel-kicker">Get started</p>
                    <h2>See BFrost work — no setup needed</h2>
                  </div>
                </div>
                <p className="footnote">{actions[0].description}</p>
                <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
                  {actions.map((action) => (
                    <button
                      key={`${action.workerId}:${action.id}`}
                      type="button"
                      className="primary"
                      disabled={(!action.endpoint && !action.runJob) || busyKey === `onboarding:${action.id}` || busyKey === 'onboarding:dismiss'}
                      onClick={() => void runAction(action)}
                    >
                      {busyKey === `onboarding:${action.id}` ? 'Running…' : action.title}
                    </button>
                  ))}
                  {deletableDemoWorkers.length > 0 ? (
                    <button
                      type="button"
                      disabled={busyKey === 'onboarding:dismiss'}
                      onClick={() => void dismissDemo()}
                    >
                      {busyKey === 'onboarding:dismiss' ? 'Deleting…' : 'Not interested — delete demo'}
                    </button>
                  ) : null}
                </div>
              </section>
            );
          })()}
          {firstResultJob ? (
            <section className="panel first-result-banner" aria-label="First result delivered" aria-live="polite">
              <div className="panel-head" style={{ alignItems: 'flex-start' }}>
                <div>
                  <p className="panel-kicker" style={{ color: 'var(--good, #1f7a57)' }}>Result ready</p>
                  <h2>{firstResultJob.label}</h2>
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Dismiss"
                  onClick={() => {
                    localStorage.setItem(firstResultShownKey, '1');
                    setFirstResultJob(null);
                  }}
                >
                  ✕
                </button>
              </div>
              <p className="first-result-summary">{firstResultJob.summary}</p>
              <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    localStorage.setItem(firstResultShownKey, '1');
                    setFirstResultJob(null);
                    setActiveTab('pipeline');
                  }}
                >
                  View full result →
                </button>
                <button
                  type="button"
                  onClick={() => {
                    localStorage.setItem(firstResultShownKey, '1');
                    setFirstResultJob(null);
                  }}
                >
                  Dismiss
                </button>
              </div>
            </section>
          ) : null}
          {(() => {
            const lmRunning = dashboard.lmStudio.running && dashboard.lmStudio.loadedCount > 0;
            const alreadyAdopted = dashboard.platform.activeLocalProviderId === 'lmstudio' && dashboard.lmStudio.running;
            if (!lmRunning || alreadyAdopted || lmAdoptDismissed) return null;
            const count = dashboard.lmStudio.loadedCount;
            return (
              <section className="panel lm-adoption-banner" aria-label="LM Studio detected">
                <div className="panel-head" style={{ alignItems: 'flex-start' }}>
                  <div>
                    <p className="panel-kicker" style={{ color: 'var(--good, #1f7a57)' }}>Detected</p>
                    <h2>Found LM Studio with {count} model{count !== 1 ? 's' : ''} loaded</h2>
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Dismiss"
                    onClick={() => setLmAdoptDismissed(true)}
                  >
                    ✕
                  </button>
                </div>
                <p className="footnote">Your jobs can run entirely on your machine — no API key needed.</p>
                <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
                  <button
                    type="button"
                    className="primary"
                    disabled={lmAdopting}
                    onClick={async () => {
                      setLmAdopting(true);
                      try {
                        await fetch('/api/workers/core.providers.lmstudio', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          credentials: 'include',
                          body: JSON.stringify({ enabled: true }),
                        });
                        await fetch('/api/platform-settings', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          credentials: 'include',
                          body: JSON.stringify({ activeLocalProviderId: 'lmstudio' }),
                        });
                        await fetchDashboard(true);
                        setLmAdoptDismissed(true);
                      } catch (err) {
                        setError(toAppError(err));
                      } finally {
                        setLmAdopting(false);
                      }
                    }}
                  >
                    {lmAdopting ? 'Connecting…' : 'Use LM Studio →'}
                  </button>
                  <button type="button" onClick={() => setLmAdoptDismissed(true)}>Later</button>
                </div>
              </section>
            );
          })()}

          {demoNarration ? (
            <section className="panel demo-narration-panel" aria-live="polite" aria-label="Pipeline run progress">
              <div className="panel-head">
                <div>
                  <p className="panel-kicker">Running</p>
                  <h2>{demoNarration.done ? 'Pipeline ran' : 'Running pipeline…'}</h2>
                </div>
              </div>
              <div className="demo-narration-stages">
                {demoNarration.stages.map((stage, i) => {
                  const completed = demoNarration.done || i < demoNarration.currentIndex;
                  const active = !demoNarration.done && i === demoNarration.currentIndex;
                  return (
                    <div
                      key={stage.label}
                      className={`demo-narration-stage${completed ? ' completed' : ''}${active ? ' active' : ''}`}
                    >
                      <span className="stage-icon" aria-hidden>{completed ? '✓' : active ? '◷' : '○'}</span>
                      <div>
                        <strong>{stage.label}</strong>
                        {(completed || active) ? <span>{stage.detail}</span> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          {demoRecap ? (
            <section className="panel demo-recap-panel">
              <div className="panel-head">
                <div>
                  <p className="panel-kicker">What just happened</p>
                  <h2>{demoRecap.headline}</h2>
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Dismiss recap"
                  onClick={() => setDemoRecap(null)}
                >
                  ✕
                </button>
              </div>
              <p className="footnote">{demoRecap.body}</p>
              <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
                {demoRecap.ctaAction === 'wizard' ? (
                  <button
                    type="button"
                    className="primary"
                    onClick={() => { setDemoRecap(null); setWizardOpen(true); }}
                  >
                    {demoRecap.ctaText ?? 'Open setup wizard →'}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => { setDemoRecap(null); setActiveTab('pipeline'); }}
                >
                  View Pipeline →
                </button>
              </div>
            </section>
          ) : null}

          {starAsk ? (
            <section className="panel star-ask-banner" aria-label="Enjoying BFrost?">
              <p>
                Enjoying BFrost?{' '}
                <a
                  href="https://github.com/ccascio/BFrost"
                  target="_blank"
                  rel="noreferrer"
                  onClick={dismissStarAsk}
                >
                  Star it on GitHub ⭐
                </a>{' '}
                — it&rsquo;s how other people find it.
              </p>
              <button type="button" className="icon-btn" aria-label="Dismiss" onClick={dismissStarAsk}>
                ✕
              </button>
            </section>
          ) : null}

          {!wizardCompleted ? (
            <section className="panel onboarding-hero">
              <div className="panel-head">
                <div>
                  <p className="panel-kicker">Setup</p>
                  <h2>Configure BFrost with the setup wizard</h2>
                </div>
              </div>
              <p className="footnote">Connect a model provider, a notification channel, and enable your first worker — guided step by step.</p>
              <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
                <button type="button" className="primary" onClick={() => setWizardOpen(true)}>
                  Open setup wizard →
                </button>
              </div>
            </section>
          ) : null}

          {(() => {
            // Show cloud quick-connect when no real model is configured and LM Studio isn't detected.
            const hasRealModel = dashboard.models.some((m) => m.provider !== 'demo');
            const lmRunning = dashboard.lmStudio.running;
            if (hasRealModel || lmRunning) return null;
            if (cloudTestReply) {
              return (
                <section className="panel cloud-connect-panel cloud-connect-success">
                  <div className="panel-head">
                    <div>
                      <p className="panel-kicker" style={{ color: 'var(--good, #1f7a57)' }}>Connected</p>
                      <h2>Provider ready</h2>
                    </div>
                    <button className="icon-btn" type="button" onClick={() => setCloudTestReply(null)}>✕</button>
                  </div>
                  <p className="footnote" style={{ fontStyle: 'italic', margin: '0.25rem 0 0.5rem' }}>
                    &ldquo;{cloudTestReply}&rdquo;
                  </p>
                  <p className="footnote">Your model is responding. Run a recipe below to get your first real result.</p>
                </section>
              );
            }
            return (
              <section className="panel cloud-connect-panel">
                <div className="panel-head">
                  <div>
                    <p className="panel-kicker">Model provider</p>
                    <h2>Paste an API key to get started</h2>
                  </div>
                </div>
                <p className="footnote" style={{ marginBottom: '0.75rem' }}>
                  No local model detected. Paste a cloud key to run real jobs in seconds.
                </p>
                <div className="cloud-connect-form">
                  <div className="panel-actions" style={{ marginBottom: '0.5rem' }}>
                    <button
                      type="button"
                      className={cloudConnectProvider === 'openai' ? 'primary' : ''}
                      onClick={() => setCloudConnectProvider('openai')}
                    >
                      OpenAI
                    </button>
                    <button
                      type="button"
                      className={cloudConnectProvider === 'anthropic' ? 'primary' : ''}
                      onClick={() => setCloudConnectProvider('anthropic')}
                    >
                      Anthropic
                    </button>
                  </div>
                  <label className="field" style={{ maxWidth: '380px' }}>
                    <span>
                      {cloudConnectProvider === 'openai' ? 'OpenAI API key' : 'Anthropic API key'}
                    </span>
                    <input
                      type="password"
                      value={cloudConnectKey}
                      placeholder={cloudConnectProvider === 'openai' ? 'sk-…' : 'sk-ant-…'}
                      onChange={(e) => setCloudConnectKey(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && cloudConnectKey.trim()) void connectCloud(); }}
                    />
                  </label>
                  <div className="panel-actions" style={{ marginTop: '0.35rem' }}>
                    <button
                      type="button"
                      className="primary"
                      disabled={!cloudConnectKey.trim() || cloudConnecting}
                      onClick={() => void connectCloud()}
                    >
                      {cloudConnecting ? 'Connecting…' : 'Connect →'}
                    </button>
                  </div>
                </div>
              </section>
            );
            async function connectCloud() {
              setCloudConnecting(true);
              try {
                const credPath = cloudConnectProvider === 'openai'
                  ? '/api/workers/providers-openai/credentials'
                  : '/api/workers/providers-anthropic/credentials';
                await fetch(credPath, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  credentials: 'include',
                  body: JSON.stringify({ apiKey: cloudConnectKey.trim() }),
                });
                await fetchDashboard(true);
                const pingRes = await fetch('/api/provider-ping', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  credentials: 'include',
                  body: '{}',
                });
                const pingData = (await pingRes.json()) as { ok?: boolean; response?: string; error?: string };
                setCloudTestReply(pingData.response ?? 'Provider connected successfully.');
                setCloudConnectKey('');
              } catch (err) {
                setError(toAppError(err));
              } finally {
                setCloudConnecting(false);
              }
            }
          })()}

          {(() => {
            const recipes = dashboard?.recipes ?? [];
            if (recipes.length === 0) return null;
            return (
              <section className="panel recipes-panel" aria-label="One-click recipes">
                <div className="panel-head">
                  <div>
                    <p className="panel-kicker">Recipes</p>
                    <h2>One-click outcomes</h2>
                  </div>
                </div>
                <p className="footnote" style={{ marginBottom: '1rem' }}>
                  Pick a recipe to wire up a real workflow. You only fill in what's missing.
                </p>
                <div className="recipes-grid">
                  {recipes.map((recipe) => {
                    const isActive = recipe.steps.every((s) =>
                      dashboard?.workers.find((w) => w.id === s.workerId)?.enabled,
                    ) || recipeApplied.has(recipe.id);
                    const isExpanded = recipeExpanded === recipe.id;
                    const hasInputs = (recipe.requiredInputs?.length ?? 0) > 0;
                    return (
                      <div
                        key={recipe.id}
                        className={`recipe-card${isActive ? ' recipe-active' : ''}${isExpanded ? ' recipe-expanded' : ''}`}
                      >
                        <div className="recipe-card-header">
                          <div className="recipe-card-title">
                            <strong>{recipe.label}</strong>
                            {isActive ? (
                              <span className="recipe-badge recipe-badge-active">Active</span>
                            ) : (
                              <span className="recipe-badge">{recipe.steps.length} worker{recipe.steps.length !== 1 ? 's' : ''}</span>
                            )}
                          </div>
                          <p className="recipe-card-desc">{recipe.description}</p>
                        </div>
                        {!isActive && (
                          <div className="recipe-card-actions">
                            {!isExpanded ? (
                              <button
                                type="button"
                                className="primary"
                                onClick={() => {
                                  setRecipeExpanded(recipe.id);
                                  setRecipeInputValues({});
                                }}
                              >
                                {hasInputs ? 'Set up →' : 'Enable →'}
                              </button>
                            ) : (
                              <div className="recipe-form">
                                {recipe.requiredInputs?.map((input) => (
                                  <label key={input.key} className="field recipe-field">
                                    <span>{input.label}</span>
                                    <input
                                      type={input.inputType === 'password' ? 'password' : 'text'}
                                      value={recipeInputValues[input.key] ?? ''}
                                      placeholder={input.helpText ?? ''}
                                      onChange={(e) =>
                                        setRecipeInputValues((prev) => ({ ...prev, [input.key]: e.target.value }))
                                      }
                                    />
                                    {input.helpText ? (
                                      <small className="footnote">{input.helpText}</small>
                                    ) : null}
                                  </label>
                                ))}
                                <div className="panel-actions">
                                  <button
                                    type="button"
                                    className="primary"
                                    disabled={recipeApplying}
                                    onClick={async () => {
                                      setRecipeApplying(true);
                                      try {
                                        const res = await fetch('/api/recipes/apply', {
                                          method: 'POST',
                                          headers: { 'Content-Type': 'application/json' },
                                          credentials: 'include',
                                          body: JSON.stringify({ recipeId: recipe.id, inputs: recipeInputValues }),
                                        });
                                        const data = (await res.json()) as {
                                          ok?: boolean;
                                          applied?: boolean;
                                          missing?: string[];
                                          dashboard?: DashboardState;
                                        };
                                        if (data.dashboard) {
                                          setDashboard(data.dashboard);
                                        }
                                        if (data.applied) {
                                          setRecipeApplied((prev) => new Set([...prev, recipe.id]));
                                          setRecipeExpanded(null);
                                        }
                                      } catch (err) {
                                        setError(toAppError(err));
                                      } finally {
                                        setRecipeApplying(false);
                                      }
                                    }}
                                  >
                                    {recipeApplying ? 'Applying…' : 'Apply recipe'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setRecipeExpanded(null)}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })()}

          <section className="overview-chat-panel" aria-label="Dashboard chat quick entry">
            <p className="panel-kicker">Assistant</p>
            <label className="overview-chat-launcher">
              <span>Ask BFrost</span>
              <input
                type="text"
                readOnly
                value=""
                placeholder="Ask about workers, schedules, queue items, or models"
                onFocus={openChatFromOverview}
                onClick={openChatFromOverview}
              />
            </label>
          </section>
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
                  <h2>Active workers <HelpTip>Workers that are healthy and ready to run. Workers missing credentials won't appear here — configure them in the Workers tab, then they'll show up once healthy.</HelpTip></h2>
                </div>
                <StatusPill tone={dashboard.workers.some((w) => w.healthState === 'healthy') ? 'good' : 'muted'}>
                  {dashboard.workers.filter((w) => w.healthState === 'healthy').length} healthy
                </StatusPill>
              </div>
              <div className="stack-list compact">
                {dashboard.workers
                  .filter((w) => w.enabled && (w.healthState === 'healthy' || w.runningJobCount > 0))
                  .map((worker) => (
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
                {dashboard.workers.filter((w) => w.enabled && (w.healthState === 'healthy' || w.runningJobCount > 0)).length === 0 ? (
                  <div className="empty-state">
                    <p>No workers are active yet.</p>
                    <p className="footnote">
                      Run the demo above to see the pipeline in action, or open Workers to enable and configure your first worker.
                    </p>
                    <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
                      <button type="button" onClick={() => setActiveTab('workers')}>
                        Open Workers
                      </button>
                    </div>
                  </div>
                ) : null}
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
        <section className={`panel tab-page chat-page${chatArrivingFromOverview ? ' chat-page-arriving' : ''}`}>
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

          <div className="chat-workspace">
            <aside className="chat-history">
              <p className="sidebar-section-label">Projects</p>
              <div className="chat-history-project" ref={projectComboRef}>
                {(() => {
                  const q = projectComboQuery.toLowerCase();
                  const filteredProjects = chatProjects.filter((p) =>
                    p.name.toLowerCase().includes(q),
                  );
                  const selectedName = activeProjectId
                    ? (chatProjects.find((p) => p.projectId === activeProjectId)?.name ?? '')
                    : 'All chats';
                  return (
                    <div className="project-combobox">
                      <input
                        className="project-combobox-input"
                        type="text"
                        placeholder="Search projects…"
                        title="Scope chats and document search to a project"
                        value={projectComboOpen ? projectComboQuery : selectedName}
                        onFocus={() => {
                          setProjectComboOpen(true);
                          setProjectComboQuery('');
                        }}
                        onChange={(e) => {
                          setProjectComboQuery(e.target.value);
                          setProjectComboOpen(true);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            setProjectComboOpen(false);
                            setProjectComboQuery('');
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                      />
                      {projectComboOpen && (
                        <ul className="project-combobox-dropdown">
                          {'all chats'.includes(q) && (
                            <li
                              className={`project-combobox-option${activeProjectId === null ? ' active' : ''}`}
                              onMouseDown={() => {
                                setActiveProjectId(null);
                                setProjectComboOpen(false);
                                setProjectComboQuery('');
                              }}
                            >
                              All chats
                            </li>
                          )}
                          {filteredProjects.map((p) => (
                            <li
                              key={p.projectId}
                              className={`project-combobox-option${activeProjectId === p.projectId ? ' active' : ''}`}
                              onMouseDown={() => {
                                setActiveProjectId(p.projectId);
                                setProjectComboOpen(false);
                                setProjectComboQuery('');
                              }}
                            >
                              {p.name}
                            </li>
                          ))}
                          <li
                            className="project-combobox-option project-combobox-new"
                            onMouseDown={() => {
                              setProjectComboOpen(false);
                              void createChatProject();
                            }}
                          >
                            + New project…
                          </li>
                        </ul>
                      )}
                    </div>
                  );
                })()}
              </div>
              {(() => {
                const filesView = dashboardViews.find((v) => v.kind === 'project-files-sidebar');
                return activeProjectId && filesView
                  ? filesView.render?.({ activeProjectId }) ?? null
                  : null;
              })()}
              <p className="sidebar-section-label">Chats</p>
              <button type="button" className="chat-history-new" onClick={startNewChat}>
                + New chat
              </button>
              {chatThreads.length > 0 && (
                <input
                  className="chat-history-filter"
                  type="search"
                  placeholder="Filter chats…"
                  value={chatQuery}
                  onChange={(e) => setChatQuery(e.target.value)}
                />
              )}
              <div className="chat-history-list">
                {(() => {
                  const q = chatQuery.toLowerCase();
                  const visible = (activeProjectId
                    ? chatThreads.filter((thread) => thread.projectId === activeProjectId)
                    : chatThreads
                  ).filter((thread) => !q || thread.title.toLowerCase().includes(q));
                  if (visible.length === 0) {
                    return <p className="chat-history-empty">No saved chats yet.</p>;
                  }
                  return visible.map((thread) => (
                    <div
                      key={thread.conversationId}
                      className={`chat-history-item${
                        thread.conversationId === activeConversationId ? ' active' : ''
                      }`}
                    >
                      <button
                        type="button"
                        className="chat-history-open"
                        onClick={() => void openChatThread(thread)}
                        disabled={busyKey === `open-chat-${thread.conversationId}`}
                      >
                        <span className="chat-history-title">{thread.title}</span>
                        <span className="chat-history-time">{formatRelativeTime(thread.lastMessageAt)}</span>
                      </button>
                      <div className="chat-history-actions">
                        <button type="button" title="Rename" onClick={() => void renameChatThread(thread)}>
                          ✎
                        </button>
                        <button type="button" title="Delete" onClick={() => void deleteChatThread(thread)}>
                          ✕
                        </button>
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </aside>

            <div className="chat-main">
          <div className="chat-log" ref={chatLogRef}>
            {chatTurns.length === 0 ? (
              <ChatWelcome prompts={buildChatPromptButtons(dashboard)} onSelect={fillChatDraft} />
            ) : null}
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

          {chatTurns.length > 0 ? (
            <ChatSuggestions
              prompts={buildChatPromptButtons(dashboard)}
              onSelect={fillChatDraft}
            />
          ) : null}

          <form
            className={`chat-composer${chatArrivingFromOverview ? ' chat-composer-arriving' : ''}`}
            onSubmit={(event) => {
              event.preventDefault();
              if (busyKey !== 'dashboard-chat' && chatDraft.trim().length > 0) {
                void sendDashboardChat();
              }
            }}
          >
            <textarea
              ref={chatInputRef}
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
            </div>
          </div>
        </section>
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

            <aside className="queue-detail-column job-detail-column">
              <section className="detail-panel job-detail-panel">
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

        </section>
      ) : null}

      {activeTab === 'config' ? (
        <section className="panel tab-page">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">Platform</p>
              <h2>Platform settings <HelpTip>Core platform configuration — how BFrost routes model calls, which embedding model it uses for memory, and access-control settings. Worker-specific settings (API keys, job parameters, prompts) live in each worker's Config subtab in the left panel.</HelpTip></h2>
            </div>
            <StatusPill tone="muted">{configCoreCount} settings</StatusPill>
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
                  {(() => {
                    const localProviderIds = new Set(dashboard.availableLocalProviders.map((p) => p.workerId));
                    const anyCloudProviderConfigured = dashboard.workers
                      .filter((w) => w.kind === 'provider' && !localProviderIds.has(w.id))
                      .some((w) => w.healthState === 'healthy');
                    return (
                      <StatusPill tone={anyCloudProviderConfigured ? 'good' : 'warning'}>
                        {anyCloudProviderConfigured ? 'Configured' : 'Missing'}
                      </StatusPill>
                    );
                  })()}
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
                    className={`run-item run-button job-row-button${selectedCoreConfigKey === 'embedding-model' ? ' selected' : ''}`}
                    type="button"
                    aria-pressed={selectedCoreConfigKey === 'embedding-model'}
                    onClick={() => {
                      setSelectedCoreConfigKey('embedding-model');
                      setSelectedConfigSurfaceKey(null);
                      setSelectedConfigJobName(null);
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

              <section className="job-worker-group">
                <div className="job-worker-head">
                  <div>
                    <p className="panel-kicker">Platform</p>
                    <h3>Platform &amp; security <HelpTip>Controls that protect and govern the whole platform rather than any single worker — dashboard password and login session length, whether local-worker code is allowed to execute, and the per-job timeout. These are not model-provider settings.</HelpTip></h3>
                    <span>Access control and execution safety</span>
                  </div>
                  <StatusPill tone={dashboard?.platform.adminPasswordSet ? 'good' : 'warning'}>
                    {dashboard?.platform.adminPasswordSet ? 'Protected' : 'No password'}
                  </StatusPill>
                </div>

                <div className="stack-list compact">
                  <button
                    className={`run-item run-button job-row-button${selectedCoreConfigKey === 'platform-security' ? ' selected' : ''}`}
                    type="button"
                    aria-pressed={selectedCoreConfigKey === 'platform-security'}
                    onClick={() => {
                      setSelectedCoreConfigKey('platform-security');
                      setSelectedConfigSurfaceKey(null);
                      setSelectedConfigJobName(null);
                    }}
                  >
                    <div>
                      <strong>Platform &amp; security</strong>
                      <span>Dashboard password, login session length, local-worker code execution, and job timeout.</span>
                      <span>
                        Auth {dashboard?.platform.adminPasswordSet ? 'on' : 'off'} · Local code{' '}
                        {dashboard?.platform.localWorkerCodeEnabled ? 'allowed' : 'blocked'}
                      </span>
                    </div>
                    <StatusPill tone="muted">Setting</StatusPill>
                  </button>
                </div>
              </section>

            </div>

            <aside className="queue-detail-column config-detail-column">
              <section className="detail-panel config-detail-panel">
                <div className="panel-head">
                  <div>
                    <p className="panel-kicker">Configuration</p>
                    <h2>{selectedCoreConfigKey === 'platform-routing' ? 'Platform routing' : selectedCoreConfigKey === 'embedding-model' ? 'Embedding model' : selectedCoreConfigKey === 'platform-security' ? 'Platform & security' : 'Platform settings'}</h2>
                  </div>
                  {selectedCoreConfigKey ? <StatusPill tone="muted">Platform</StatusPill> : null}
                </div>

                {selectedCoreConfigKey === 'platform-routing' ? renderPlatformRoutingConfiguration() : null}
                {selectedCoreConfigKey === 'embedding-model'
                  ? (dashboardViews.find((v) => v.kind === 'embedding-config')?.render?.(workerViewContext) ?? null)
                  : null}
                {selectedCoreConfigKey === 'platform-security' ? renderPlatformSecurityConfiguration() : null}
                {!selectedCoreConfigKey ? (
                  <p className="empty-state">Select a platform setting on the left to configure it. Worker settings are in each worker's Config subtab.</p>
                ) : null}
              </section>
            </aside>
          </div>
        </section>
      ) : null}

      {activeTab === 'config' ? (() => {
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
              <div className="panel-actions" style={{ marginTop: '0.75rem' }}>
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

      {activeWorkerTab ? renderWorkerDashboardView(activeWorkerTab, workerViewContext) : null}

      {activeTab.startsWith('worker-config:') ? (() => {
        const workerId = activeTab.slice('worker-config:'.length);
        const group = configGroupsByWorker.find((g) => g.worker.id === workerId);
        if (!group) return null;
        const { worker, surfaces } = group;
        return (
          <section className="panel tab-page">
            <div className="panel-head">
              <div>
                <p className="panel-kicker">{worker.builtIn ? 'Built-in worker' : 'Local worker'}</p>
                <h2>{worker.displayName ?? worker.name} — Config</h2>
              </div>
              <StatusPill tone={workerHealthTone(worker.healthState)}>
                {workerHealthLabel(worker.healthState)}
              </StatusPill>
            </div>

            {surfaces.length === 0 ? (
              <p className="empty-state">No configurable settings declared for this worker.</p>
            ) : null}

            {surfaces.map((surface) => (
              <div key={surface.id} className="detail-panel config-detail-panel" style={{ marginTop: '1rem' }}>
                <div className="panel-head section-break">
                  <div>
                    <p className="panel-kicker">Worker setting</p>
                    <h2>{surface.label}</h2>
                    {surface.description ? <p className="footnote">{surface.description}</p> : null}
                  </div>
                </div>
                {renderWorkerConfigurationSurface({ worker, surface })}
              </div>
            ))}
          </section>
        );
      })() : null}

      {activeTab === 'workers' ? (
        <>
        <section className="panel tab-page">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">Describe a worker</p>
              <h2>Create a worker by describing it <HelpTip>Type what you want a worker to do in plain English. BFrost asks your model to design it, scaffolds the code, installs it, and enables it — no files, no restart. Needs a real model connected (LM Studio, Ollama, or a cloud key).</HelpTip></h2>
            </div>
          </div>
          <div className="stack-list">
            <textarea
              rows={3}
              placeholder='e.g. "Every morning, write me one calm haiku about the day ahead."'
              value={workerDescription}
              onChange={(event) => setWorkerDescription(event.target.value)}
              disabled={busyKey === 'worker-generate'}
            />
            <div className="panel-actions">
              <button
                type="button"
                className="primary"
                disabled={busyKey === 'worker-generate' || workerDescription.trim().length < 8}
                onClick={() => void generateWorkerFromDescription()}
              >
                {busyKey === 'worker-generate' ? 'Designing…' : 'Create worker'}
              </button>
              {(['Write me one calm haiku every morning.', 'Summarize each new news article into three bullet points.', 'Draft a daily gratitude journal prompt.'] as const).map((example) => (
                <button
                  key={example}
                  type="button"
                  className="chip"
                  disabled={busyKey === 'worker-generate'}
                  onClick={() => setWorkerDescription(example)}
                >
                  {example}
                </button>
              ))}
            </div>
            {generatedWorker ? (
              <div className="summary-row">
                <div>
                  <strong>{generatedWorker.displayName}</strong>
                  <span>{generatedWorker.id} · {generatedWorker.role}</span>
                  <span>
                    {generatedWorker.enabled
                      ? 'Created and enabled. Open the Jobs tab and click Run now to see it work.'
                      : (generatedWorker.note ?? 'Created. Enable it below.')}
                  </span>
                </div>
                <StatusPill tone={generatedWorker.enabled ? 'good' : 'warning'}>
                  {generatedWorker.enabled ? 'enabled' : 'created'}
                </StatusPill>
              </div>
            ) : (
              <p className="footnote">
                The model only fills in the worker's design — the code is generated from a fixed,
                contract-safe template, so a worker created this way always loads.
              </p>
            )}
          </div>
        </section>
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
        </>
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


      {activeTab === 'system' ? (
        <section className="panel tab-page">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">System</p>
              <h2>Runtime readiness <HelpTip>Shows whether BFrost's required services are running and configured — the AI model, any connected channels (Telegram, Discord), and the local database. A yellow "missing" pill means a credential or dependency is not yet set up; use the worker's Config subtab in the left panel to fix it.</HelpTip></h2>
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
            <div className="system-copy-row">
              <Detail label="Admin URL" value={dashboard.app.adminUrl} />
              <CopyButton value={dashboard.app.adminUrl} label="Copy URL" size="sm" />
            </div>
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

  function renderJobOperations(job: SchedulerJobState, runs: SchedulerRunRecord[]) {
    const draft = jobDrafts[job.name] ?? {
      enabled: job.enabled,
      cron: job.cron,
      modelAlias: job.modelAlias,
      approvalRequired: job.approvalRequired,
      prompt: job.prompt,
      params: buildJobParamsDraft(job),
    };
    const changes = jobScheduleChanges(job, draft);
    const runningRun = job.running
      ? runs.find((run) => run.status === 'running' || run.finishedAt === null)
      : null;

    return (
      <div className="detail-body">
        {!job.workerEnabled ? <p className="error-box">Worker disabled. Enable it from Workers to run this job.</p> : null}
        {job.running ? (
          <div className="job-running-progress">
            <Progress
              value={null}
              label={runningRun?.startedAt ? `Running since ${formatDate(runningRun.startedAt)}` : 'Job running'}
              tone="warning"
            />
          </div>
        ) : null}

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

          <div className="field cron-builder-field">
            <span>Schedule</span>
            <CronBuilder
              value={draft.cron}
              onChange={(cron) =>
                setJobDrafts((current) => ({
                  ...current,
                  [job.name]: { ...draft, cron },
                }))
              }
            />
          </div>

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

        {(job.dashboardFields.length > 0 || job.promptEditable) ? renderJobConfiguration(job) : null}

        {renderJobDetail(job, runs)}

        <AlertDialog
          open={confirmSaveJobName === job.name}
          onOpenChange={(open) => {
            if (!open) setConfirmSaveJobName(null);
          }}
          title={`Save schedule for ${job.label}?`}
          description="Review the operational changes before they affect future runs."
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmSaveJobName(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
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
                Confirm save
              </Button>
            </>
          }
        >
          {changes.length === 0 ? (
            <p className="schedule-preview-no-changes">No changes to save.</p>
          ) : (
            <table className="schedule-preview-table">
              <thead>
                <tr><th>Field</th><th>Current</th><th>New value</th></tr>
              </thead>
              <tbody>
                {changes.map((change) => (
                  <tr key={change.field}>
                    <td>{change.field}</td>
                    <td className="schedule-preview-old">{change.from}</td>
                    <td className="schedule-preview-new">{change.to}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </AlertDialog>
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
            {job.presets.map((preset) => {
              const presetApplied =
                (preset.cron === undefined || preset.cron === draft.cron) &&
                Object.entries(preset.params ?? {}).every(([key, value]) => draft.params[key] === value);
              return (
                <button
                  key={preset.id}
                  type="button"
                  className={`preset-chip${presetApplied ? ' active' : ''}`}
                  aria-pressed={presetApplied}
                  title={preset.description}
                  onClick={() => applyPreset(preset)}
                >
                  {preset.label}
                </button>
              );
            })}
            <span className="footnote" style={{ flexBasis: '100%', marginTop: '0.25rem' }}>
              Click a recipe to fill the form. Nothing saves until you press Save below.
            </span>
          </div>
        ) : null}

        <div className="job-grid config-field-grid">
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

  function renderPlatformSecurityConfiguration() {
    const platform = dashboard.platform;
    const saving = busyKey === 'save-core-settings';
    const ttlValue = sessionTtlDraft ?? String(platform.adminSessionTtlHours);
    const timeoutValue = jobTimeoutDraft ?? String(platform.jobLlmTimeoutMs);
    const ttlNum = Number(ttlValue);
    const timeoutNum = Number(timeoutValue);
    const ttlDirty = Number.isFinite(ttlNum) && ttlNum > 0 && ttlNum !== platform.adminSessionTtlHours;
    const timeoutDirty = Number.isFinite(timeoutNum) && timeoutNum > 0 && timeoutNum !== platform.jobLlmTimeoutMs;

    return (
      <div className="detail-body">
        <p className="footnote">
          Core platform and security settings. Changes are written to your <code>.env</code> and applied
          immediately (no restart) unless noted. The admin password itself is never displayed here.
        </p>

        <div className="form-grid">
          <label className="field">
            <span>Admin password {platform.adminPasswordSet ? '(currently set)' : '(not set — dashboard is open)'}</span>
            <input
              type="password"
              value={adminPasswordDraft}
              placeholder={platform.adminPasswordSet ? 'Enter a new password to change it' : 'Set a password to require login'}
              onChange={(event) => setAdminPasswordDraft(event.target.value)}
            />
            <span className="footnote">
              Setting or changing the password logs out every session (including this one) — you will be
              asked to log in again. Minimum 4 characters. Leave the dashboard unprotected only on a
              machine you fully trust.
            </span>
            <div className="panel-actions">
              <button
                className="primary"
                disabled={saving || adminPasswordDraft.trim().length < 4}
                onClick={() => void saveCoreSettings({ adminPassword: adminPasswordDraft })}
              >
                {saving ? 'Saving...' : platform.adminPasswordSet ? 'Change password' : 'Set password'}
              </button>
              {platform.adminPasswordSet ? (
                <button
                  className="ghost"
                  disabled={saving}
                  onClick={() => {
                    if (window.confirm('Remove the admin password and disable login? Anyone who can reach the dashboard will have full control.')) {
                      void saveCoreSettings({ adminPassword: '' });
                    }
                  }}
                >
                  Disable login
                </button>
              ) : null}
            </div>
          </label>

          <label className="field checkbox">
            <span>Allow local worker code execution ({platform.localWorkerCodeEnabled ? 'allowed' : 'blocked — recommended'})</span>
            <input
              type="checkbox"
              checked={platform.localWorkerCodeEnabled}
              disabled={saving}
              onChange={(event) => void saveCoreSettings({ localWorkerCodeEnabled: event.target.checked })}
            />
            <span className="footnote">
              When off, local workers that ship executable code are not compiled or run — only built-in
              workers and manifest-only local workers load. Turn this on solely for worker code you have
              reviewed and trust. After enabling, re-enable affected workers from the Workers tab (or
              restart) so they load.
            </span>
          </label>

          <label className="field">
            <span>Login session length (hours)</span>
            <input
              type="number"
              min={1}
              value={ttlValue}
              onChange={(event) => setSessionTtlDraft(event.target.value)}
            />
            <span className="footnote">How long a login stays valid before re-authentication is required.</span>
            <div className="panel-actions">
              <button
                className="primary"
                disabled={saving || !ttlDirty}
                onClick={() => void saveCoreSettings({ adminSessionTtlHours: ttlNum })}
              >
                {saving ? 'Saving...' : 'Save session length'}
              </button>
            </div>
          </label>

          <label className="field">
            <span>Job model timeout (ms)</span>
            <input
              type="number"
              min={1}
              value={timeoutValue}
              onChange={(event) => setJobTimeoutDraft(event.target.value)}
            />
            <span className="footnote">Maximum time a scheduled job's model call may run before it is aborted.</span>
            <div className="panel-actions">
              <button
                className="primary"
                disabled={saving || !timeoutDirty}
                onClick={() => void saveCoreSettings({ jobLlmTimeoutMs: timeoutNum })}
              >
                {saving ? 'Saving...' : 'Save timeout'}
              </button>
            </div>
          </label>

          <label className="field">
            <span>Dashboard bind address</span>
            <input type="text" value={`${platform.adminHost}:${platform.adminPort}`} readOnly disabled />
            <span className="footnote">
              Read-only. Changing the host or port requires editing <code>ADMIN_HOST</code> / <code>ADMIN_PORT</code>{' '}
              in <code>.env</code> and restarting. Keep it on <code>127.0.0.1</code> unless you understand the
              exposure — a non-loopback bind makes the dashboard reachable from your network.
            </span>
          </label>
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



  // ── Store tab ─────────────────────────────────────────────────────────────


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

