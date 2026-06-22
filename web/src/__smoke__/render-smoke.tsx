// Frontend render smoke: mounts components with mock props via react-dom/server
// and reports any that throw during render. This is the safety net for the App.tsx
// per-tab split (CODE_ROADMAP Phase 1.2) — vite/tsc cannot catch a mis-wired prop
// that only blows up at render time; this can. Run via `npm run smoke:web`.
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement, type ReactElement } from 'react';
import {
  Metric,
  Detail,
  DetailBlock,
  HelpTip,
  HealthRow,
  StoreTrustBadge,
  StatusPill,
  RunError,
} from '../app-helpers';
import { ActionsTab } from '../tabs/ActionsTab';
import { HealthTab } from '../tabs/HealthTab';
import { StoreTab } from '../tabs/StoreTab';
import { ChannelsTab } from '../tabs/ChannelsTab';
import { ChatTab } from '../tabs/ChatTab';
import { WorkersTab } from '../tabs/WorkersTab';
import { SystemTab } from '../tabs/SystemTab';
import { OverviewTab } from '../tabs/OverviewTab';
import { OverviewSetupPanels } from '../tabs/OverviewSetupPanels';
import { OverviewRecipesPanel } from '../tabs/OverviewRecipesPanel';
import { OverviewModelPanel } from '../tabs/OverviewModelPanel';
import { DashboardFieldEditor } from '../tabs/DashboardFieldEditor';
import { JobOperationsPanel } from '../tabs/JobOperationsPanel';
import { PlatformRoutingPanel, PlatformSecurityPanel } from '../tabs/PlatformConfigPanels';
import { WorkerConfigPage } from '../tabs/WorkerConfigPage';
import { Wizard } from '../Wizard';
import type { RefObject } from 'react';
import type {
  ActionRequest,
  DashboardState,
  SchedulerJobState,
  WorkerDashboardSurface,
  WorkerSummary,
} from '../app-types';

const nullRef = { current: null } as RefObject<never>;
const noop = () => {};
const noopAsync = async () => {};

// Minimal dashboard mock for tabs that read a few fields. Cast: a render smoke only
// needs the fields a tab actually touches, not a full valid DashboardState.
const mockDashboard = {
  workers: [],
  workerIssues: [],
  defaultModel: { alias: 'local', provider: 'local' },
} as unknown as DashboardState;

const overviewDashboard = {
  app: {
    name: 'BFrost',
    adminUrl: 'http://127.0.0.1:3030',
    timezone: 'UTC',
    now: new Date().toISOString(),
    pid: 123,
  },
  models: [{ alias: 'demo', id: 'demo-model', label: 'Demo model', provider: 'demo' }],
  defaultModel: { alias: 'demo', id: 'demo-model', label: 'Demo model', provider: 'demo' },
  localRuntime: { running: false, loadedModels: [], loadedCount: 0, pinnedModelId: null },
  cron: { timezone: 'UTC', jobs: [], runs: [] },
  workers: [
    {
      id: 'local.digest',
      name: 'Digest',
      displayName: 'Digest',
      description: 'Creates a digest',
      tagline: 'Summarize items',
      builtIn: false,
      enabled: false,
      deletable: true,
      jobCount: 0,
      runningJobCount: 0,
      healthState: 'disabled',
      health: [],
      dashboard: { views: [], settings: [] },
    },
  ],
  workerIssues: [],
  platform: {
    activeLocalProviderId: '',
    primaryChannelId: '',
    embeddingProvider: '',
    embeddingModel: '',
    adminPasswordSet: false,
    localWorkerCodeEnabled: false,
    adminSessionTtlHours: 24,
    jobLlmTimeoutMs: 120000,
    adminHost: '127.0.0.1',
    adminPort: 3030,
  },
  availableLocalProviders: [],
  availableChannels: [],
  queue: {
    total: 0,
    queued: 0,
    approved: 0,
    posted: 0,
    rejected: 0,
    failed: 0,
    seen: 0,
    retrying: 0,
    recentItems: [],
  },
  integrations: {},
  dependencies: {
    localRuntimeCli: { ok: true, detail: 'ok' },
    sqliteCli: { ok: true, detail: 'ok' },
    ffmpeg: { ok: true, detail: 'ok' },
    whisperCli: { ok: true, detail: 'ok' },
    whisperModel: { ok: true, detail: 'ok' },
    embeddingModelReachable: { ok: true, detail: 'ok' },
  },
  events: [],
  backups: [],
  recipes: [
    {
      id: 'digest-recipe',
      label: 'Digest recipe',
      description: 'Enable a digest workflow',
      steps: [{ workerId: 'local.digest' }],
      requiredInputs: [],
    },
  ],
} as unknown as DashboardState;

const overviewSetupProps = {
  dashboard: overviewDashboard,
  busyKey: null,
  setBusyKey: noop,
  setError: noop,
  setDashboard: noop,
  setActiveTab: noop,
  onboardingRan: true,
  runDemoAction: noopAsync,
  fetchDashboard: noopAsync,
  firstResultJob: null,
  firstResultShownKey: 'smoke:first-result',
  setFirstResultJob: noop,
  lmAdoptDismissed: false,
  setLmAdoptDismissed: noop,
  lmAdopting: false,
  setLmAdopting: noop,
  demoNarration: null,
  demoRecap: null,
  setDemoRecap: noop,
  setWizardOpen: noop,
  starAsk: false,
  dismissStarAsk: noop,
  wizardCompleted: true,
  cloudTestReply: null,
  setCloudTestReply: noop,
  cloudConnectProvider: '',
  setCloudConnectProvider: noop,
  cloudConnectKey: '',
  setCloudConnectKey: noop,
  cloudConnecting: false,
  setCloudConnecting: noop,
  recipeApplied: new Set<string>(),
  setRecipeApplied: noop,
  recipeExpanded: null,
  setRecipeExpanded: noop,
  recipeInputValues: {},
  setRecipeInputValues: noop,
  recipeApplying: false,
  setRecipeApplying: noop,
  renderStuckDetectorBanner: () => null,
};

const mockAction: ActionRequest = {
  id: 'a1',
  workerId: 'core.demo',
  actionClass: 'approved-write',
  label: 'Write file',
  rationale: 'because',
  payload: {},
  preview: 'diff --git a b',
  state: 'pending',
  createdAt: new Date().toISOString(),
  decidedAt: null,
  executedAt: null,
};

const mockJob: SchedulerJobState = {
  name: 'digest',
  label: 'Digest job',
  description: 'Runs a digest',
  workerId: 'local.digest',
  workerName: 'Digest',
  workerBuiltIn: false,
  workerEnabled: true,
  approvalRequiredEditable: true,
  enabled: true,
  cron: '0 9 * * *',
  modelAlias: 'demo',
  approvalRequired: false,
  promptEditable: true,
  prompt: 'Summarize.',
  params: {},
  dashboardFields: [],
  presets: [],
  effectiveModelAlias: 'demo',
  running: false,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastStatus: 'idle',
  lastSummary: null,
  lastError: null,
  lastTrigger: null,
};

const mockWorker = overviewDashboard.workers[0] as unknown as WorkerSummary;

const mockWorkerSurface: WorkerDashboardSurface = {
  id: 'settings',
  label: 'Settings',
  description: 'Worker settings',
  path: '/api/workers/local.digest/settings',
  tab: 'config',
  fields: [
    {
      key: 'topic',
      label: 'Topic',
      type: 'text',
      defaultValue: 'AI',
    },
  ],
};

interface SmokeCase {
  name: string;
  el: ReactElement;
}

// Render-only smoke: each case must produce markup without throwing.
const cases: SmokeCase[] = [
  { name: 'Metric', el: createElement(Metric, { label: 'Queued', value: '3' }) },
  { name: 'Detail', el: createElement(Detail, { label: 'Model', value: 'local' }) },
  { name: 'DetailBlock', el: createElement(DetailBlock, { label: 'Notes', value: 'hello world' }) },
  { name: 'HelpTip', el: createElement(HelpTip, { children: 'help text' }) },
  {
    name: 'HealthRow',
    el: createElement(HealthRow, { label: 'API', status: { ok: true, detail: 'reachable' } }),
  },
  { name: 'StoreTrustBadge', el: createElement(StoreTrustBadge, { trust: 'community' }) },
  { name: 'StatusPill', el: createElement(StatusPill, { tone: 'good', children: 'OK' }) },
  { name: 'RunError', el: createElement(RunError, { message: 'boom' }) },
  {
    name: 'DashboardFieldEditor',
    el: createElement(DashboardFieldEditor, {
      field: {
        key: 'topics',
        label: 'Topics',
        type: 'string-list',
        defaultValue: [],
        suggestions: ['AI', 'Markets'],
      },
      value: 'AI',
      onChange: noop,
      customListItemDrafts: {},
      setCustomListItemDrafts: noop,
      draftKey: 'smoke.topics',
    }),
  },
  {
    name: 'JobOperationsPanel',
    el: createElement(JobOperationsPanel, {
      dashboard: overviewDashboard,
      job: mockJob,
      runs: [],
      busyKey: null,
      jobDrafts: {},
      setJobDrafts: noop,
      confirmSaveJobName: null,
      setConfirmSaveJobName: noop,
      openPromptEditors: {},
      setOpenPromptEditors: noop,
      customListItemDrafts: {},
      setCustomListItemDrafts: noop,
      mutate: noop,
      triggerRun: noop,
    }),
  },
  {
    name: 'PlatformRoutingPanel',
    el: createElement(PlatformRoutingPanel, {
      dashboard: overviewDashboard,
      busyKey: null,
      activeLocalProviderDraft: '',
      setActiveLocalProviderDraft: noop,
      primaryChannelDraft: '',
      setPrimaryChannelDraft: noop,
      savePlatformRouting: noop,
    }),
  },
  {
    name: 'PlatformSecurityPanel',
    el: createElement(PlatformSecurityPanel, {
      dashboard: overviewDashboard,
      busyKey: null,
      adminPasswordDraft: '',
      setAdminPasswordDraft: noop,
      sessionTtlDraft: null,
      setSessionTtlDraft: noop,
      jobTimeoutDraft: null,
      setJobTimeoutDraft: noop,
      saveCoreSettings: noop,
    }),
  },
  {
    name: 'WorkerConfigPage',
    el: createElement(WorkerConfigPage, {
      worker: mockWorker,
      surfaces: [mockWorkerSurface],
      dashboard: overviewDashboard,
      dashboardViews: [],
      surfaceDrafts: {},
      setSurfaceDrafts: noop,
      customListItemDrafts: {},
      setCustomListItemDrafts: noop,
      busyKey: null,
      fetchDashboard: noopAsync,
      saveWorkerConfigurationSurface: noop,
    }),
  },
  {
    name: 'Wizard',
    el: createElement(Wizard, {
      dashboard: overviewDashboard as never,
      onDismiss: noop,
      onComplete: noop,
      onRefreshDashboard: noopAsync,
      onNavigate: noop,
      onRunDemoAction: noop,
    }),
  },
  {
    name: 'ActionsTab',
    el: createElement(ActionsTab, {
      pendingActions: [mockAction],
      actionHistory: [mockAction],
      actionsLoading: false,
      selectedActionId: null,
      setSelectedActionId: () => {},
      busyKey: null,
      decideAction: () => {},
      fetchPendingActions: () => {},
    }),
  },
  {
    name: 'HealthTab (empty)',
    el: createElement(HealthTab, {
      jobMetrics: null,
      jobMetricsLoading: false,
      jobMetricsError: null,
      fetchJobMetrics: () => {},
      expandedWorkerIds: new Set<string>(),
      setExpandedWorkerIds: () => {},
      setActiveTab: () => {},
    }),
  },
  {
    name: 'StoreTab (empty)',
    el: createElement(StoreTab, {
      dashboard: mockDashboard,
      storeWorkers: null,
      storeLoading: false,
      storeError: null,
      storeQuery: '',
      setStoreQuery: () => {},
      storeQueryInput: '',
      setStoreQueryInput: () => {},
      storeCategoryFilter: 'all',
      setStoreCategoryFilter: () => {},
      storeSelectedId: null,
      setStoreSelectedId: () => {},
      storeDetail: null,
      setStoreDetail: () => {},
      storeDetailLoading: false,
      sideloadFile: null,
      setSideloadFile: () => {},
      setConsentTarget: () => {},
      busyKey: null,
      fetchStoreCatalog: () => {},
      fetchStoreDetail: () => {},
      installFromStore: () => {},
      sideloadWorkerZip: () => {},
      mutate: () => {},
    }),
  },
  {
    name: 'ChannelsTab (empty)',
    el: createElement(ChannelsTab, {
      dashboard: mockDashboard,
      expandedChannelId: null,
      setExpandedChannelId: () => {},
      dashboardViews: [],
      fetchDashboard: () => {},
    }),
  },
  {
    name: 'ChatTab (empty)',
    el: createElement(ChatTab, {
      dashboard: mockDashboard,
      dashboardViews: [],
      busyKey: null,
      chatDraft: '',
      setChatDraft: () => {},
      chatTurns: [],
      chatThreads: [],
      chatProjects: [],
      activeProjectId: null,
      setActiveProjectId: () => {},
      activeConversationId: null,
      chatArrivingFromOverview: false,
      chatQuery: '',
      setChatQuery: () => {},
      projectComboOpen: false,
      setProjectComboOpen: () => {},
      projectComboQuery: '',
      setProjectComboQuery: () => {},
      projectComboRef: nullRef,
      chatLogRef: nullRef,
      chatInputRef: nullRef,
      createChatProject: () => {},
      renameChatProject: () => {},
      startNewChat: () => {},
      openChatThread: () => {},
      renameChatThread: () => {},
      deleteChatThread: () => {},
      sendDashboardChat: () => {},
      fillChatDraft: () => {},
      artifacts: [],
      artifactPanelOpen: false,
      setArtifactPanelOpen: () => {},
      artifactPanelPinned: false,
      setArtifactPanelPinned: () => {},
      activeArtifactId: null,
      setActiveArtifactId: () => {},
      openArtifact: () => {},
      deleteArtifactFromConversation: () => {},
    }),
  },
  {
    name: 'SystemTab (empty)',
    el: createElement(SystemTab, {
      dashboard: {
        ...mockDashboard,
        dependencies: {
          localRuntimeCli: { ok: true, detail: 'ok' },
          sqliteCli: { ok: true, detail: 'ok' },
          ffmpeg: { ok: true, detail: 'ok' },
          whisperCli: { ok: true, detail: 'ok' },
          whisperModel: { ok: true, detail: 'ok' },
          embeddingModelReachable: { ok: true, detail: 'ok' },
        },
        backups: [],
        events: [],
        app: { adminUrl: 'http://127.0.0.1:3030' },
      } as unknown as DashboardState,
      whatsNew: null,
      autoBackupSettings: null,
      setAutoBackupSettings: () => {},
      saveAutoBackup: async () => {},
      busyKey: null,
      mutate: () => {},
      restoreBackup: async () => {},
      cancelRestore: async () => {},
      resetChecks: { wipeWorkerState: false, wipeCredentials: false, wipeBackups: false },
      setResetChecks: () => {},
      resetConfirmOpen: false,
      setResetConfirmOpen: () => {},
      executeFactoryReset: async () => {},
      setActiveTab: () => {},
    }),
  },
  {
    name: 'WorkersTab (empty)',
    el: createElement(WorkersTab, {
      dashboard: mockDashboard,
      busyKey: null,
      workerDescription: '',
      setWorkerDescription: () => {},
      generatedWorker: null,
      workerUploadFile: null,
      setWorkerUploadFile: () => {},
      storeUpdates: new Map<string, string>(),
      generateWorkerFromDescription: () => {},
      uploadWorkerZip: () => {},
      deleteWorker: () => {},
      mutate: () => {},
    }),
  },
  {
    name: 'OverviewModelPanel',
    el: createElement(OverviewModelPanel, {
      dashboard: overviewDashboard,
      busyKey: null,
      selectedModelAlias: 'demo',
      setSelectedModelAlias: noop,
      saveDefaultModel: noop,
    }),
  },
  {
    name: 'OverviewRecipesPanel',
    el: createElement(OverviewRecipesPanel, {
      dashboard: overviewDashboard,
      setDashboard: noop,
      setError: noop,
      recipeApplied: new Set<string>(),
      setRecipeApplied: noop,
      recipeExpanded: null,
      setRecipeExpanded: noop,
      recipeInputValues: {},
      setRecipeInputValues: noop,
      recipeApplying: false,
      setRecipeApplying: noop,
    }),
  },
  {
    name: 'OverviewSetupPanels',
    el: createElement(OverviewSetupPanels, overviewSetupProps),
  },
  {
    name: 'OverviewTab',
    el: createElement(OverviewTab, {
      ...overviewSetupProps,
      openChatFromOverview: noop,
      dashboardViews: [],
      workerViewContext: {},
      selectedModelAlias: 'demo',
      setSelectedModelAlias: noop,
      saveDefaultModel: noop,
      setNotice: noop,
    }),
  },
];

export interface SmokeResult {
  name: string;
  ok: boolean;
  error?: string;
}

export function runSmoke(): SmokeResult[] {
  return cases.map(({ name, el }) => {
    try {
      const markup = renderToStaticMarkup(el);
      if (typeof markup !== 'string') throw new Error('no markup produced');
      return { name, ok: true };
    } catch (err) {
      return { name, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
