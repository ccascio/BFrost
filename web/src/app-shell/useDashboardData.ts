import { useEffect, useRef, useState } from 'react';
import { loadRuntimeWorkerBundle, useWorkerDashboardViews } from '../workers/registry';
import type {
  AppError,
  AuthSession,
  DashboardSectionName,
  DashboardState,
  DashboardTab,
  EventLogRecord,
  JobDraft,
} from '../app-types';
import {
  DASHBOARD_REFRESH_INTERVAL_MS,
  JOBS_REFRESH_INTERVAL_MS,
  toAppError,
} from '../app-types';
import {
  buildJobParamsDraft,
  formatTime,
  mergeSection,
  sectionEndpoint,
  sectionsForTab,
} from '../app-helpers';
import { useEventStream } from './useEventStream';

export function useDashboardData({
  activeTab,
  setWizardCompleted,
  setWizardOpen,
  setQueueFilter,
}: {
  activeTab: DashboardTab;
  setWizardCompleted: (completed: boolean) => void;
  setWizardOpen: (open: boolean) => void;
  setQueueFilter: (filter: string) => void;
}) {
  const [dashboard, setDashboard] = useState<DashboardState | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [selectedModelAlias, setSelectedModelAlias] = useState('');
  const [jobDrafts, setJobDrafts] = useState<Record<string, JobDraft>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [notice, setNotice] = useState<string>('Loading dashboard...');
  const [password, setPassword] = useState('');
  const [lastStreamEvent, setLastStreamEvent] = useState<EventLogRecord | null>(null);
  const loadedSectionsRef = useRef<Set<DashboardSectionName>>(new Set());
  const inflightSectionsRef = useRef<Map<DashboardSectionName, Promise<void>>>(new Map());
  const activeTabRef = useRef<DashboardTab>('overview');
  const loadedBundleWorkersRef = useRef<Set<string>>(new Set());
  const pendingStreamSectionsRef = useRef<Set<DashboardSectionName>>(new Set());
  const streamSectionTimerRef = useRef<number | null>(null);
  const streamDashboardTimerRef = useRef<number | null>(null);
  const dashboardViews = useWorkerDashboardViews();
  const streamEnabled = Boolean(session?.authenticated || session?.authEnabled === false);
  const eventStreamStatus = useEventStream({
    enabled: streamEnabled,
    onEvent: handleStreamEvent,
    onOpen: handleStreamOpen,
  });

  useEffect(() => {
    void initialize();
    return () => {
      if (streamSectionTimerRef.current !== null) window.clearTimeout(streamSectionTimerRef.current);
      if (streamDashboardTimerRef.current !== null) window.clearTimeout(streamDashboardTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (eventStreamStatus === 'open') return;
      if (activeTabRef.current === 'config') return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (session?.authenticated || session?.authEnabled === false) {
        void fetchDashboard(true);
      } else {
        void refreshSession(false);
      }
    }, DASHBOARD_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [session?.authenticated, session?.authEnabled, eventStreamStatus]);

  useEffect(() => {
    if (!dashboard || activeTab !== 'jobs') return;
    const timer = window.setInterval(() => {
      if (eventStreamStatus === 'open') return;
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
  }, [activeTab, dashboard !== null, session?.authenticated, session?.authEnabled, eventStreamStatus]);

  useEffect(() => {
    if (!dashboard) return;
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
    for (const section of sectionsForTab(activeTab)) {
      void fetchSection(section, { force: true });
    }
  }, [activeTab, dashboard !== null]);

  // Reset the queue filter whenever the active tab changes, so each worker dashboard opens
  // showing its own declared default (e.g. "pending") rather than whatever filter was last
  // selected on a different tab. Core stays worker-agnostic — it just relays whatever
  // defaultQueueFilter (if any) the active tab's own view definition declares.
  useEffect(() => {
    const workerId = activeTab.startsWith('worker:') ? activeTab.slice('worker:'.length) : null;
    // A worker may register more than one view (e.g. a queue dashboard plus a config-surface
    // override) — prefer the "queue" one since that's what defaultQueueFilter is meant for.
    const view = workerId
      ? dashboardViews.find((v) => v.workerId === workerId && v.kind === 'queue')
        ?? dashboardViews.find((v) => v.workerId === workerId)
      : null;
    setQueueFilter(view?.defaultQueueFilter ?? 'all');
  }, [activeTab, dashboardViews]);

  useEffect(() => {
    if (!dashboard || eventStreamStatus !== 'open') return;

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        void refreshActiveTabSections();
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [dashboard !== null, eventStreamStatus]);

  function handleStreamOpen() {
    if (!dashboard) return;
    queueStreamSections(sectionsForTab(activeTabRef.current));
  }

  function handleStreamEvent(event: EventLogRecord) {
    setLastStreamEvent(event);
    if (eventNeedsDashboardRefresh(event)) {
      queueDashboardRefreshFromStream();
    }
    queueStreamSections(sectionsForStreamEvent(event));
  }

  function sectionsForStreamEvent(event: EventLogRecord): DashboardSectionName[] {
    const sections = new Set<DashboardSectionName>(['events']);
    for (const section of sectionsForTab(activeTabRef.current)) sections.add(section);

    switch (event.category) {
      case 'queue':
        sections.add('queue');
        sections.add('pipelineStages');
        break;
      case 'scheduler':
        sections.add('cronRuns');
        sections.add('queue');
        sections.add('workerData');
        sections.add('pipelineStages');
        break;
      case 'backups':
        sections.add('backups');
        break;
      case 'config':
        sections.add('localRuntimeModels');
        sections.add('workerData');
        break;
      case 'actions':
        break;
      default:
        // Ordinary worker job runs land here. They no longer trigger a full shell rebuild,
        // so pull the pipeline strip explicitly — this is what makes the header's running
        // indicator light up and clear as jobs start and finish.
        sections.add('workerData');
        sections.add('pipelineStages');
        break;
    }

    return [...sections];
  }

  function eventNeedsDashboardRefresh(event: EventLogRecord): boolean {
    // Only *structural* changes justify a full `/api/dashboard` rebuild — that call
    // re-runs health probes, local-worker discovery and the scheduler snapshot, so it is
    // by far the most expensive thing the UI can ask for. While the SSE stream is open
    // the periodic polls are suppressed, so this predicate is the sole trigger.
    if (event.category === 'workers' || event.category === 'config' || event.category === 'admin') {
      return true;
    }

    // The singular `worker` category is overloaded: it covers install/enable/delete/
    // hot-reload and health transitions (which change the shell — worker list, health
    // badges) *and* the routine output of every worker job run (which does not, and is
    // far more frequent). Split them on the action name rather than refreshing for both.
    //
    // Structural actions are named generically by core — `worker_*` / `workers_*` from the
    // worker routes and watcher, `health_*` from the health projection. Routine job actions
    // are named by each worker for itself, so core stays worker-agnostic by matching only
    // the core-owned prefixes and treating everything else as ordinary run output.
    if (event.category === 'worker') {
      return /^workers?_/.test(event.action) || event.action.startsWith('health_');
    }

    return false;
  }

  function queueStreamSections(sections: DashboardSectionName[]) {
    if (sections.length === 0) return;
    for (const section of sections) pendingStreamSectionsRef.current.add(section);
    if (streamSectionTimerRef.current !== null) return;

    streamSectionTimerRef.current = window.setTimeout(() => {
      streamSectionTimerRef.current = null;
      const queued = [...pendingStreamSectionsRef.current];
      pendingStreamSectionsRef.current.clear();
      if (!dashboardAccessAllowed()) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void Promise.all(queued.map((section) => fetchSection(section, { force: true })));
    }, 250);
  }

  function queueDashboardRefreshFromStream() {
    if (streamDashboardTimerRef.current !== null) return;
    streamDashboardTimerRef.current = window.setTimeout(() => {
      streamDashboardTimerRef.current = null;
      if (!dashboardAccessAllowed()) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      // `queueStreamSections` already force-fetches this tab's sections for the same
      // event, so skip the shell's own follow-up pass instead of fetching each twice.
      void fetchDashboard(true, { refreshSections: false });
    }, 250);
  }

  function dashboardAccessAllowed(): boolean {
    return Boolean(session?.authenticated || session?.authEnabled === false);
  }

  async function initialize() {
    const nextSession = await refreshSession(true);
    if (nextSession?.authenticated || nextSession?.authEnabled === false) {
      const urlParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
      if (urlParams.get('safe') === '1') {
        await fetch('/api/admin/disable-all-workers', { method: 'POST', credentials: 'include' });
        setNotice('Safe mode: all workers have been disabled. Re-enable them one at a time from the Workers tab.');
        window.history.replaceState({}, '', window.location.pathname);
      }
      await fetchDashboard(false);
      try {
        const wizRes = await fetch('/api/wizard/state', { credentials: 'include' });
        if (wizRes.ok) {
          const wizState = await wizRes.json() as { step: number; completed: boolean };
          setWizardCompleted(wizState.completed);
          if (!wizState.completed) setWizardOpen(true);
        }
      } catch {
        // wizard state is non-fatal
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
      if (!payload.authenticated && payload.authEnabled) setDashboard(null);
      return payload;
    } catch (err) {
      if (showErrors) {
        setError(toAppError(err));
        setNotice('Authentication check failed.');
      }
      return null;
    }
  }

  function seedEmptySections(shell: DashboardState): DashboardState {
    return {
      ...shell,
      localRuntime: { ...shell.localRuntime, loadedModels: shell.localRuntime.loadedModels ?? [] },
      cron: { ...shell.cron, runs: shell.cron.runs ?? [] },
      queue: shell.queue ?? {
        total: 0, queued: 0, approved: 0, posted: 0, rejected: 0,
        failed: 0, seen: 0, retrying: 0, recentItems: [],
      },
      events: shell.events ?? [],
      backups: shell.backups ?? [],
      workerData: (shell as any).workerData ?? {},
      recipes: shell.recipes ?? [],
      pipelineStages: shell.pipelineStages ?? [],
    } as DashboardState;
  }

  async function fetchDashboard(preserveDrafts: boolean, opts: { refreshSections?: boolean } = {}) {
    const refreshSections = opts.refreshSections ?? true;
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
        const seeded = seedEmptySections(payload);
        if (!prev) return seeded;
        return {
          ...seeded,
          localRuntime: loadedSectionsRef.current.has('localRuntimeModels')
            ? { ...seeded.localRuntime, loadedModels: prev.localRuntime.loadedModels }
            : seeded.localRuntime,
          cron: loadedSectionsRef.current.has('cronRuns')
            ? { ...seeded.cron, runs: prev.cron.runs }
            : seeded.cron,
          queue: loadedSectionsRef.current.has('queue') ? prev.queue : seeded.queue,
          events: loadedSectionsRef.current.has('events') ? prev.events : seeded.events,
          backups: loadedSectionsRef.current.has('backups') ? prev.backups : seeded.backups,
          workerData: loadedSectionsRef.current.has('workerData') ? prev.workerData : seeded.workerData,
          pipelineStages: loadedSectionsRef.current.has('pipelineStages') ? prev.pipelineStages : seeded.pipelineStages,
        } as DashboardState;
      });
      if (!preserveDrafts || !selectedModelAlias) syncDrafts(seedEmptySections(payload));
      setError(null);
      setNotice(`Updated ${formatTime(payload.app.now)}`);
      if (refreshSections) await refreshActiveTabSections();
    } catch (err) {
      setError(toAppError(err));
      setNotice('Dashboard refresh failed.');
    }
  }

  async function fetchSection(name: DashboardSectionName, opts: { force?: boolean } = {}): Promise<void> {
    if (!opts.force && loadedSectionsRef.current.has(name)) return;
    const inflight = inflightSectionsRef.current.get(name);
    if (inflight) return inflight;

    const promise = (async () => {
      try {
        const response = await fetch(sectionEndpoint(name), { credentials: 'include' });
        const payload = await response.json();
        if (!response.ok || 'error' in payload) throw new Error(payload.error ?? `Failed to load ${name}`);
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

  async function refreshActiveTabSections(): Promise<void> {
    const sections = sectionsForTab(activeTabRef.current);
    await Promise.all(sections.map((section) => fetchSection(section, { force: true })));
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
  }

  async function mutate(key: string, input: RequestInfo, init: RequestInit, successMessage: string) {
    setBusyKey(key);
    setError(null);
    try {
      const response = await fetch(input, {
        ...init,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
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
      const payload = (await response.json()) as { queued?: boolean; started?: boolean; job?: { label?: string }; error?: string };
      if (!response.ok || 'error' in payload) {
        if (response.status === 401) setSession({ authenticated: false, authEnabled: true });
        throw new Error('error' in payload ? payload.error : 'Request failed');
      }
      setNotice(payload.queued ? `${payload.job?.label ?? 'Job'} queued.` : successMessage);
      await fetchDashboard(true);
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
      if (!response.ok || 'error' in payload) throw new Error('error' in payload ? payload.error : 'Login failed');
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

  function saveDefaultModel(alias: string, reasoningLevel?: string) {
    void mutate('save-model', '/api/default-model', {
      method: 'POST',
      body: JSON.stringify(
        reasoningLevel === undefined ? { alias } : { alias, reasoningLevel },
      ),
    }, 'Default model updated.');
  }

  return {
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
  };
}
