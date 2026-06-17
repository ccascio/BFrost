import { useEffect, useState } from 'react';
import type {
  DashboardState,
  StoreWorkerDetail,
  StoreWorkerListing,
  WorkerSummary,
} from '../app-types';
import { toAppError } from '../app-types';

const STORE_API = 'https://api.bfrost.net/v1';
const STORE_CDN = 'https://raw.githubusercontent.com/ccascio/bfrost-workers/main/index.json';

export function useStoreController({
  dashboard,
  setBusyKey,
  setError,
  setNotice,
  fetchDashboard,
  mutate,
}: {
  dashboard: DashboardState | null;
  setBusyKey: (key: string | null) => void;
  setError: (error: ReturnType<typeof toAppError> | null) => void;
  setNotice: (notice: string) => void;
  fetchDashboard: (preserveDrafts: boolean) => Promise<void>;
  mutate: (key: string, input: RequestInfo, init: RequestInit, successMessage: string) => Promise<void>;
}) {
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
  const [storeUpdates, setStoreUpdates] = useState<Map<string, string>>(new Map());
  const [consentTarget, setConsentTarget] = useState<StoreWorkerDetail | null>(null);

  useEffect(() => {
    if (!dashboard) return;
    void fetchStoreUpdates(dashboard.workers);
    const timer = window.setInterval(() => {
      void fetchStoreUpdates(dashboard.workers);
    }, 24 * 60 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [dashboard !== null]);

  async function fetchStoreCatalog(query: string): Promise<void> {
    setStoreLoading(true);
    setStoreError(null);
    try {
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
        // fall through to CDN
      }
      if (apiOk) return;

      const cdnRes = await fetch(STORE_CDN);
      if (!cdnRes.ok) throw new Error(`Store registry returned ${cdnRes.status}`);
      let all = await cdnRes.json() as StoreWorkerListing[];
      if (!Array.isArray(all)) all = [];
      if (query.trim()) {
        const q = query.toLowerCase();
        all = all.filter(
          (worker) =>
            worker.name.toLowerCase().includes(q) ||
            worker.tagline.toLowerCase().includes(q) ||
            worker.tags.some((tag) => tag.toLowerCase().includes(q)),
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
      try {
        const res = await fetch(`${STORE_API}/workers/${encodeURIComponent(id)}`);
        if (res.ok) {
          setStoreDetail(await res.json() as StoreWorkerDetail);
          return;
        }
      } catch {
        // fall through to CDN
      }
      const cdnRes = await fetch(STORE_CDN);
      if (!cdnRes.ok) throw new Error(`CDN returned ${cdnRes.status}`);
      const all = await cdnRes.json() as StoreWorkerDetail[];
      const found = Array.isArray(all) ? all.find((worker) => worker.id === id) : null;
      if (!found) throw new Error('Worker not found in registry.');
      setStoreDetail(found);
    } catch (err) {
      console.error('[store] fetchStoreDetail failed:', err);
    } finally {
      setStoreDetailLoading(false);
    }
  }

  async function fetchStoreUpdates(workers: WorkerSummary[]): Promise<void> {
    const localWorkers = workers.filter((worker) => !worker.builtIn);
    if (localWorkers.length === 0) return;
    try {
      const params = new URLSearchParams();
      localWorkers.forEach((worker) => {
        params.append('ids', worker.id);
        params.append('versions', worker.version);
      });
      const res = await fetch(`${STORE_API}/updates?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json() as { updates: Array<{ id: string; latestVersion: string }> };
      if (Array.isArray(data.updates)) {
        setStoreUpdates(new Map(data.updates.map((update) => [update.id, update.latestVersion])));
      }
    } catch {
      // best-effort
    }
  }

  async function installFromStore(worker: StoreWorkerListing): Promise<void> {
    const detail = storeDetail?.id === worker.id ? storeDetail : null;
    const version = detail?.versions?.find((entry) => !entry.yanked && entry.bundleUrl && entry.bundleSha256);
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
      if (!res.ok || !payload.ok) throw new Error(payload.error ?? `Install failed (HTTP ${res.status})`);
      setNotice(`"${worker.name}" installed! Use the Enable button to activate it.`);
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

  return {
    storeWorkers,
    storeLoading,
    storeError,
    storeQuery,
    setStoreQuery,
    storeQueryInput,
    setStoreQueryInput,
    storeCategoryFilter,
    setStoreCategoryFilter,
    storeSelectedId,
    setStoreSelectedId,
    storeDetail,
    setStoreDetail,
    storeDetailLoading,
    sideloadFile,
    setSideloadFile,
    storeUpdates,
    consentTarget,
    setConsentTarget,
    fetchStoreCatalog,
    fetchStoreDetail,
    installFromStore,
    sideloadWorkerZip,
    mutate,
  };
}
