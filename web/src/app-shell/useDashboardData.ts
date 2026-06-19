import { useEffect, useRef, useState } from 'react';
import { loadRuntimeWorkerBundle, useWorkerDashboardViews } from '../workers/registry';
import type {
  AppError,
  AuthSession,
  DashboardSectionName,
  DashboardState,
  DashboardTab,
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

export function useDashboardData({
  activeTab,
  setWizardCompleted,
  setWizardOpen,
}: {
  activeTab: DashboardTab;
  setWizardCompleted: (completed: boolean) => void;
  setWizardOpen: (open: boolean) => void;
}) {
  const [dashboard, setDashboard] = useState<DashboardState | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [selectedModelAlias, setSelectedModelAlias] = useState('');
  const [jobDrafts, setJobDrafts] = useState<Record<string, JobDraft>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [notice, setNotice] = useState<string>('Loading dashboard...');
  const [password, setPassword] = useState('');
  const loadedSectionsRef = useRef<Set<DashboardSectionName>>(new Set());
  const inflightSectionsRef = useRef<Map<DashboardSectionName, Promise<void>>>(new Map());
  const activeTabRef = useRef<DashboardTab>('overview');
  const loadedBundleWorkersRef = useRef<Set<string>>(new Set());
  const dashboardViews = useWorkerDashboardViews();

  useEffect(() => {
    void initialize();
    const timer = window.setInterval(() => {
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
      void fetchSection(section);
    }
  }, [activeTab, dashboard !== null]);

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
        } as DashboardState;
      });
      if (!preserveDrafts || !selectedModelAlias) syncDrafts(seedEmptySections(payload));
      setError(null);
      setNotice(`Updated ${formatTime(payload.app.now)}`);
      await refreshActiveTabSections();
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

  function saveDefaultModel(alias: string) {
    void mutate('save-model', '/api/default-model', {
      method: 'POST',
      body: JSON.stringify({ alias }),
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
