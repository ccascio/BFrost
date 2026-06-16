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
import type { RefObject } from 'react';
import type { ActionRequest, DashboardState } from '../app-types';

const nullRef = { current: null } as RefObject<never>;

// Minimal dashboard mock for tabs that read a few fields. Cast: a render smoke only
// needs the fields a tab actually touches, not a full valid DashboardState.
const mockDashboard = {
  workers: [],
  workerIssues: [],
  defaultModel: { alias: 'local', provider: 'local' },
} as unknown as DashboardState;

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
      startNewChat: () => {},
      openChatThread: () => {},
      renameChatThread: () => {},
      deleteChatThread: () => {},
      sendDashboardChat: () => {},
      fillChatDraft: () => {},
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
