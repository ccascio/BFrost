import { useEffect, useState } from 'react';
import type {
  ActionRequest,
  AutoBackupSettings,
  DashboardState,
  DashboardTab,
  JobMetricsResponse,
  WhatsNewEntry,
  WorkerSummary,
} from '../app-types';
import { toAppError } from '../app-types';

export function useDashboardOperations({
  activeTab,
  setActiveTab,
  setBusyKey,
  setError,
  setNotice,
  setDashboard,
  fetchDashboard,
  fetchSection,
  mutate,
}: {
  activeTab: DashboardTab;
  setActiveTab: (tab: DashboardTab) => void;
  setBusyKey: (key: string | null) => void;
  setError: (error: ReturnType<typeof toAppError> | null) => void;
  setNotice: (notice: string) => void;
  setDashboard: (dashboard: DashboardState) => void;
  fetchDashboard: (preserveDrafts: boolean) => Promise<void>;
  fetchSection: (name: any, opts?: { force?: boolean }) => Promise<void>;
  mutate: (key: string, input: RequestInfo, init: RequestInit, successMessage: string) => Promise<void>;
}) {
  const [workerUploadFile, setWorkerUploadFile] = useState<File | null>(null);
  const [workerDescription, setWorkerDescription] = useState('');
  const [generatedWorker, setGeneratedWorker] = useState<
    { id: string; displayName: string; role: string; enabled: boolean; note?: string } | null
  >(null);
  const [pendingActions, setPendingActions] = useState<ActionRequest[]>([]);
  const [actionHistory, setActionHistory] = useState<ActionRequest[]>([]);
  const [actionsLoading, setActionsLoading] = useState(false);
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [jobMetrics, setJobMetrics] = useState<JobMetricsResponse | null>(null);
  const [jobMetricsLoading, setJobMetricsLoading] = useState(false);
  const [jobMetricsError, setJobMetricsError] = useState<string | null>(null);
  const [expandedWorkerIds, setExpandedWorkerIds] = useState<Set<string>>(new Set());
  const [autoBackupSettings, setAutoBackupSettings] = useState<AutoBackupSettings | null>(null);
  const [resetChecks, setResetChecks] = useState({ wipeWorkerState: false, wipeCredentials: false, wipeBackups: false });
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [whatsNew, setWhatsNew] = useState<WhatsNewEntry[] | null>(null);

  useEffect(() => {
    if (activeTab !== 'health') return;
    void fetchJobMetrics();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'actions') return;
    void fetchPendingActions();
    void fetchActionHistory();
    const timer = window.setInterval(() => void fetchPendingActions(), 3000);
    return () => window.clearInterval(timer);
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'system' || whatsNew !== null) return;
    fetch('/whats-new.json')
      .then((response) => response.json())
      .then((data) => setWhatsNew(data as WhatsNewEntry[]))
      .catch(() => setWhatsNew([]));
  }, [activeTab, whatsNew]);

  useEffect(() => {
    if (activeTab !== 'system' || autoBackupSettings !== null) return;
    void fetchAutoBackupSettings();
  }, [activeTab]);

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
      if (!response.ok || 'error' in payload) throw new Error(payload.error ?? 'Worker upload failed');
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
      if (!response.ok || 'error' in payload) throw new Error(payload.error ?? 'Worker generation failed');
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
      if (!response.ok || 'error' in payload) throw new Error(payload.error ?? 'Worker delete failed');
      setNotice(`${worker.name} worker deleted.`);
      await fetchDashboard(true);
    } catch (err) {
      setError(toAppError(err));
    } finally {
      setBusyKey(null);
    }
  }

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
      setPendingActions((prev) => prev.filter((action) => action.id !== requestId));
      if (selectedActionId === requestId) setSelectedActionId(null);
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

  return {
    workers: {
      workerUploadFile,
      setWorkerUploadFile,
      workerDescription,
      setWorkerDescription,
      generatedWorker,
      uploadWorkerZip,
      generateWorkerFromDescription,
      deleteWorker,
    },
    actions: {
      pendingActions,
      actionHistory,
      actionsLoading,
      selectedActionId,
      setSelectedActionId,
      decideAction,
      fetchPendingActions,
    },
    health: {
      jobMetrics,
      jobMetricsLoading,
      jobMetricsError,
      expandedWorkerIds,
      setExpandedWorkerIds,
      fetchJobMetrics,
      setActiveTab,
    },
    system: {
      whatsNew,
      autoBackupSettings,
      setAutoBackupSettings,
      saveAutoBackup,
      restoreBackup,
      cancelRestore,
      resetChecks,
      setResetChecks,
      resetConfirmOpen,
      setResetConfirmOpen,
      executeFactoryReset,
      setActiveTab,
    },
  };
}
