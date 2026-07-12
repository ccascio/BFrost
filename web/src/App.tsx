import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Sidebar, type SidebarEntry } from './Sidebar';
import { TopBar } from './TopBar';
import { Markdown } from './Markdown';
import type { WorkerDashboardViewDefinition } from './workers/types';
import { Wizard } from './Wizard';
import { AlertDialog, Button, CopyButton, Dialog, ManagementBar, PreviewLinkCard, Sheet } from './ui';
import { AuthCheckingScreen, DashboardSplash, LoginScreen } from './app-shell/AuthScreens';
import { DashboardRoutes } from './app-shell/DashboardRoutes';
import { SettingsModal } from './app-shell/SettingsModal';
import { QueueDetail, QueueMetrics, StuckDetectorBanner } from './app-shell/QueueViews';
import { SpecialModeBanners } from './app-shell/SpecialModeBanners';
import { useChatController } from './app-shell/useChatController';
import { useDashboardData } from './app-shell/useDashboardData';
import { useDashboardOperations } from './app-shell/useDashboardOperations';
import { useOverviewController } from './app-shell/useOverviewController';
import { useStoreController } from './app-shell/useStoreController';
import {
  pathForDashboardTab,
  pathForSettingsTab,
  pushDashboardPath,
  readDashboardRoute,
} from './app-shell/routing';
import { workerDashboardUi } from './workers/ui-contract';
import {
  ActionClass, ActionRequest, ActionState, AppBackupRecord, AppError, AuthSession, AutoBackupSettings, CORE_CHAT_PROMPTS, CORE_MENU_ENTRIES, ChatProject, ChatPromptButton, ChatPromptExample, ChatThread, ChatTurn, CoreConfigKey, CoreDashboardTab, DASHBOARD_REFRESH_INTERVAL_MS, DashboardSectionName, DashboardState, DashboardTab, EventLogRecord, HealthStatus, JOBS_REFRESH_INTERVAL_MS, JobBaseField, JobBooleanField, JobDashboardField, JobDraft, JobMetricsResponse, JobNumberField, JobParamDraftValue, JobPreset, JobRunMetrics, JobSecretReferenceField, JobSelectField, JobStringListField, JobTextField, JobTextareaField, ModelOption, PERMISSION_INFO, PlatformSettings, QueueFilter, QueueItem, RecipeInputStorage, RegisteredPlatformEntry, RunStatus, SchedulerJobState, SchedulerRunRecord, SettingsTab, SourceQualityRules, StoreWorkerDetail, StoreWorkerListing, StoreWorkerVersion, WhatsNewEntry, WorkerDashboardManifest, WorkerDashboardSurface, WorkerHealthRequirementStatus, WorkerHealthState, WorkerJobSummary, WorkerKind, WorkerLoadIssue, WorkerOnboardingAction, WorkerOwnedSetting, WorkerRecipe, WorkerRecipeInput, WorkerRecipeStep, WorkerRunMetrics, WorkerSummary, WorkerTabDefinition, toAppError,
} from './app-types';
import {
  ChatSuggestions, ChatWelcome, Detail, HealthRow, HelpTip, PipelineNode, PipelineTopology, RUN_ERROR_PREVIEW_CHARS, RunError, STORE_PALETTE_COUNT, STORE_VISUAL_RULES, StatusPill, StoreTrustBadge, StoreVisualWorker, StoreWorkerLogo, buildChatPromptButtons, buildJobParamsDraft, buildPipelineTopology, buildSurfaceDraft, buildWorkerTabDefinitions, configSurfaceKey, coreMenuCount, draftToHosts, eventSeverityTone, formatBytes, formatDate, formatDuration, formatRelativeTime, formatTime, hostsToDraft, jobConfigSummary, jobScheduleChanges, mergeSection, normalizeStringListItem, queueItemReason, queueItemTone, renderPipelineTab, renderWorkerDashboardView, resolveDashboardTab, resolveSeedPath, runDuration, runSeverity, runStatusSummary, runStatusTone, safeWorkerViewCount, sectionEndpoint, sectionsForTab, serializeDashboardFields, serializeJobParams, statusTone, storeAuthorHandle, storeCategoryKey, storeCategoryLabel, storePaletteIndex, storeTrustTone, storeWorkerIcon, workerDeclaresView, workerOwnsEvent, workerTabId,
} from './app-helpers';

export default function App() {
  const [activeTabState, setActiveTabRaw] = useState<DashboardTab>(() => readDashboardRoute().activeTab);
  const [settingsOpen, setSettingsOpen] = useState(() => readDashboardRoute().settingsOpen);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>(() => readDashboardRoute().settingsTab);

  const SETTINGS_TABS = new Set<string>(['channels', 'config', 'system', 'actions']);
  function setActiveTab(tab: DashboardTab) {
    if (SETTINGS_TABS.has(tab) || (tab as string).startsWith('worker-settings:')) {
      openSettingsTab(tab as SettingsTab);
      return;
    }
    setSettingsOpen(false);
    // pipeline is now embedded in Overview
    const nextTab = tab === 'pipeline' ? 'overview' : tab;
    setActiveTabRaw(nextTab);
    pushDashboardPath(pathForDashboardTab(nextTab));
  }

  function openSettingsTab(tab: SettingsTab) {
    setSettingsTab(tab);
    setSettingsOpen(true);
    pushDashboardPath(pathForSettingsTab(tab));
  }

  function closeSettings() {
    setSettingsOpen(false);
    pushDashboardPath(pathForDashboardTab(activeTabState));
  }
  const activeTab = activeTabState;
  const [selectedJobName, setSelectedJobName] = useState<string | null>(null);
  const [selectedCoreConfigKey, setSelectedCoreConfigKey] = useState<CoreConfigKey | null>(null);
  const [surfaceDrafts, setSurfaceDrafts] = useState<Record<string, Record<string, JobParamDraftValue>>>({});
  const [openPromptEditors, setOpenPromptEditors] = useState<Record<string, boolean>>({});
  const [expandedChannelId, setExpandedChannelId] = useState<string | null>(null);
  const [customListItemDrafts, setCustomListItemDrafts] = useState<Record<string, string>>({});
  const [queueFilter, setQueueFilter] = useState<QueueFilter>('all');
  const [selectedQueueItemId, setSelectedQueueItemId] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  // First-run wizard state
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardCompleted, setWizardCompleted] = useState(true); // default true avoids flash before data loads

  // Preview-before-save for schedule edits: holds job.name when awaiting confirmation
  const [confirmSaveJobName, setConfirmSaveJobName] = useState<string | null>(null);

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
  const [introPhase, setIntroPhase] = useState<'loading' | 'splash-exit' | 'enter' | 'done'>('loading');
  const introFiredRef = useRef(false);
  const data = useDashboardData({ activeTab, setWizardCompleted, setWizardOpen });
  const {
    dashboard,
    setDashboard,
    session,
    setSession,
    selectedModelAlias,
    setSelectedModelAlias,
    jobDrafts,
    setJobDrafts,
    busyKey,
    setBusyKey,
    error,
    setError,
    notice,
    setNotice,
    password,
    setPassword,
    dashboardViews,
    eventStreamStatus,
    lastStreamEvent,
    fetchDashboard,
    fetchSection,
    mutate,
    triggerRun,
    login,
    logout,
    saveDefaultModel,
    refreshSession,
  } = data;
  const overview = useOverviewController({
    dashboard,
    setActiveTab,
    setBusyKey,
    setError,
    setNotice,
    fetchDashboard,
  });
  const store = useStoreController({
    dashboard,
    setBusyKey,
    setError,
    setNotice,
    fetchDashboard,
    mutate,
  });
  const chat = useChatController({
    activeTab,
    setActiveTab,
    busyKey,
    setBusyKey,
    setError,
    setNotice,
    fetchDashboard,
  });
  const operations = useDashboardOperations({
    activeTab,
    eventStreamStatus,
    lastStreamEvent,
    setActiveTab,
    setBusyKey,
    setError,
    setNotice,
    setDashboard,
    fetchDashboard,
    fetchSection,
    mutate,
  });

  useEffect(() => {
    window.localStorage.setItem('bfrost.sidebarCollapsed', String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    function handlePopState() {
      const route = readDashboardRoute();
      setActiveTabRaw(route.activeTab === 'pipeline' ? 'overview' : route.activeTab);
      setSettingsOpen(route.settingsOpen);
      setSettingsTab(route.settingsTab);
    }

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (!dashboard || introFiredRef.current) return;
    introFiredRef.current = true;
    setIntroPhase('splash-exit');
    // No cleanup: timers must survive dashboard reference updates (polling refresh)
    // and React StrictMode's double-invoke. App is the root and never unmounts normally.
    window.setTimeout(() => setIntroPhase('enter'), 300);
    window.setTimeout(() => setIntroPhase('done'), 1500);
  }, [dashboard]);

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

  // Load store catalog when the Store tab is opened. Re-fetches when the search query changes.
  useEffect(() => {
    if (activeTab !== 'store') return;
    void store.fetchStoreCatalog(store.storeQuery);
  }, [activeTab, store.storeQuery]);

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
    const key = configSurfaceKey(worker.id, surface.id);
    const fields = surface.fields ?? [];
    const draft = surfaceDrafts[key] ?? buildSurfaceDraft(surface, dashboard?.workerData, dashboard?.cron.jobs ?? []);
    const surfacePayload = serializeDashboardFields(fields, draft);

    if (surface.path && !surface.path.includes('#') && Object.keys(surfacePayload).length > 0) {
      await mutate(
        `config-surface-${key}`,
        surface.path,
        {
          method: 'POST',
          body: JSON.stringify(surfacePayload),
        },
        `${surface.label} saved.`,
      );
    }

    for (const field of fields) {
      if (field.type !== 'model-alias') continue;
      await mutate(
        `config-surface-${key}`,
        `/api/cron-jobs/${encodeURIComponent(field.targetJob)}`,
        {
          method: 'POST',
          body: JSON.stringify({ modelAlias: String(draft[field.key] ?? '') }),
        },
        `${field.label} saved.`,
      );
    }
  }

  if (!session) {
    return <AuthCheckingScreen error={error} />;
  }

  if (session.authEnabled && !session.authenticated) {
    return (
      <LoginScreen
        password={password}
        busy={busyKey === 'login'}
        error={error}
        onPasswordChange={setPassword}
        onLogin={() => void login()}
      />
    );
  }

  if (introPhase === 'loading' || introPhase === 'splash-exit' || !dashboard) {
    return <DashboardSplash error={error} exiting={introPhase === 'splash-exit'} />;
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
    .filter((worker) => worker.kind !== 'channel' && (worker.enabled || worker.kind === 'provider'))
    .map((worker) => ({
      worker,
      surfaces: worker.dashboard.settings.filter((surface) => (surface.tab ?? 'config') === 'config'),
    }))
    .filter((group) => group.surfaces.length > 0);
  const configJobCount = 0;
  const configSurfaceCount = configGroupsByWorker.filter(
    ({ worker }) => worker.settingsOnly && worker.kind !== 'provider',
  ).length;
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
    renderQueueMetrics: (interactive: boolean) => (
      <QueueMetrics
        dashboard={dashboard}
        queueFilter={queueFilter}
        setQueueFilter={setQueueFilter}
        interactive={interactive}
      />
    ),
    renderQueueDetail: (item: QueueItem) => (
      <QueueDetail item={item} busyKey={busyKey} onUpdateQueueItem={(id, action) => void updateQueueItem(id, action)} />
    ),
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
        chat: chat.chatTurns.length,
        system: dashboard.events.length,
        store: store.storeUpdates.size,
        pendingActions: operations.actions.pendingActions.length,
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
    // Providers and settingsOnly workers live in the Settings modal Config tab instead.
    // Workers WITHOUT a dashboard tab (and not settingsOnly) → standalone entry with the worker's name.
    ...configGroupsByWorker.flatMap(({ worker }) => {
      if (worker.settingsOnly || worker.kind === 'provider') return [];
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
    <div className={`dashboard-layout${sidebarCollapsed ? ' sidebar-collapsed' : ''}${sidebarMobileOpen ? ' sidebar-mobile-open' : ''}${introPhase === 'enter' ? ' is-intro' : ''}`}>
      <TopBar
        notice={notice}
        error={error}
        environment={
          dashboard.platform.activeLocalProviderId
            ? dashboard.localRuntime.running ? 'Local runtime online' : 'Local runtime offline'
            : ''
        }
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
          !!dashboard.localRuntime.pinnedModelId &&
          dashboard.models.find((m) => m.alias === selectedModelAlias)?.id ===
            dashboard.localRuntime.pinnedModelId
        }
        pinBusy={busyKey === 'toggle-pin'}
        authEnabled={session.authEnabled}
        logoutBusy={busyKey === 'logout'}
        onOpenNavigation={() => setSidebarMobileOpen(true)}
        onModelChange={(event) => {
          const alias = event.target.value;
          setSelectedModelAlias(alias);
          saveDefaultModel(alias);
        }}
        onTogglePin={() => {
          const isPinned =
            !!dashboard.localRuntime.pinnedModelId &&
            dashboard.models.find((m) => m.alias === selectedModelAlias)?.id ===
              dashboard.localRuntime.pinnedModelId;
          void mutate(
            'toggle-pin',
            '/api/local-runtime',
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
        onOpenSettings={() => openSettingsTab(settingsTab)}
      />
      <button
        className="sidebar-mobile-backdrop"
        type="button"
        aria-label="Close navigation"
        onClick={() => setSidebarMobileOpen(false)}
      />
      <main className="shell dashboard-main">

      <SpecialModeBanners
        dashboard={dashboard}
        busyKey={busyKey}
        setBusyKey={setBusyKey}
        setError={setError}
        setActiveTab={setActiveTab}
        fetchDashboard={fetchDashboard}
      />

      <DashboardRoutes
        settingsOpen={settingsOpen}
        setSettingsOpen={(open: boolean) => {
          if (open) openSettingsTab(settingsTab);
          else closeSettings();
        }}
        settingsTab={settingsTab}
        setSettingsTab={openSettingsTab}
        activeTab={activeTab}
        activeWorkerTab={activeWorkerTab}
        dashboard={dashboard}
        busyKey={busyKey}
        setBusyKey={setBusyKey}
        setError={setError}
        setDashboard={setDashboard}
        setActiveTab={setActiveTab}
        overview={overview}
        fetchDashboard={fetchDashboard}
        setWizardOpen={setWizardOpen}
        wizardCompleted={wizardCompleted}
        chat={chat}
        renderStuckDetectorBanner={() => (
          <StuckDetectorBanner dashboard={dashboard} setSelectedJobName={setSelectedJobName} setActiveTab={setActiveTab} />
        )}
        dashboardViews={dashboardViews}
        workerViewContext={workerViewContext}
        selectedModelAlias={selectedModelAlias}
        setSelectedModelAlias={setSelectedModelAlias}
        saveDefaultModel={saveDefaultModel}
        setNotice={setNotice}
        expandedChannelId={expandedChannelId}
        setExpandedChannelId={setExpandedChannelId}
        jobsByWorker={jobsByWorker}
        selectedJob={selectedJob}
        selectedJobRuns={selectedJobRuns}
        setSelectedJobName={setSelectedJobName}
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
        configCoreCount={configCoreCount + configSurfaceCount}
        selectedCoreConfigKey={selectedCoreConfigKey}
        setSelectedCoreConfigKey={setSelectedCoreConfigKey}
        activeLocalProviderDraft={activeLocalProviderDraft}
        setActiveLocalProviderDraft={setActiveLocalProviderDraft}
        primaryChannelDraft={primaryChannelDraft}
        setPrimaryChannelDraft={setPrimaryChannelDraft}
        savePlatformRouting={savePlatformRouting}
        adminPasswordDraft={adminPasswordDraft}
        setAdminPasswordDraft={setAdminPasswordDraft}
        sessionTtlDraft={sessionTtlDraft}
        setSessionTtlDraft={setSessionTtlDraft}
        jobTimeoutDraft={jobTimeoutDraft}
        setJobTimeoutDraft={setJobTimeoutDraft}
        saveCoreSettings={saveCoreSettings}
        configGroupsByWorker={configGroupsByWorker}
        surfaceDrafts={surfaceDrafts}
        setSurfaceDrafts={setSurfaceDrafts}
        saveWorkerConfigurationSurface={saveWorkerConfigurationSurface}
        extraSettingsTabs={configGroupsByWorker
          .filter(({ worker }) => worker.settingsOnly && !workerTabDefinitions.some((t) => t.worker.id === worker.id))
          .map(({ worker }) => ({
            id: `worker-settings:${worker.id}` as import('./app-types').SettingsTab,
            label: worker.displayName ?? worker.name,
            icon: worker.section === 'system' ? 'system' : 'config',
            order: worker.kind === 'provider' ? 20 : worker.section === 'system' ? 60 : 70,
          }))}
        operations={operations}
        store={store}
      />
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
            void overview.runDemoAction(action as WorkerOnboardingAction & { workerId: string });
          }}
        />
      ) : null}

      {/* Install permission consent dialog */}
      <Dialog
        open={!!store.consentTarget}
        onOpenChange={(open) => {
          if (!open) store.setConsentTarget(null);
        }}
        title={store.consentTarget ? `Install "${store.consentTarget.name}"?` : 'Install worker?'}
        description="Review the permissions this worker requires before proceeding."
        footer={store.consentTarget ? (
          <>
            <Button variant="ghost" onClick={() => store.setConsentTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={busyKey === `store-install-${store.consentTarget.id}`}
              onClick={() => {
                const target = store.consentTarget;
                if (!target) return;
                store.setConsentTarget(null);
                void store.installFromStore(target);
              }}
            >
              Approve and install
            </Button>
          </>
        ) : null}
      >
        {store.consentTarget ? (
          <div className="consent-body">
            {store.consentTarget.permissions.length === 0 ? (
              <p className="consent-no-perms">This worker declares no special permissions.</p>
            ) : (
              <ul className="consent-perm-list">
                {store.consentTarget.permissions.map((perm) => {
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
              Trust level: <strong>{store.consentTarget.trust}</strong>
            </p>
          </div>
        ) : null}
      </Dialog>
    </div>
  );

}
