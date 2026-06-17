import type { DashboardState, DashboardTab } from '../app-types';
import { toAppError } from '../app-types';

export function SpecialModeBanners({
  dashboard,
  busyKey,
  setBusyKey,
  setError,
  setActiveTab,
  fetchDashboard,
}: {
  dashboard: DashboardState;
  busyKey: string | null;
  setBusyKey: (key: string | null) => void;
  setError: (error: ReturnType<typeof toAppError>) => void;
  setActiveTab: (tab: DashboardTab) => void;
  fetchDashboard: (preserveDrafts: boolean) => Promise<void>;
}) {
  return (
    <>
      {dashboard.workers
        .filter((worker) => worker.enabled && worker.demoNotice)
        .map((worker) => (
          <div key={`demo-notice-${worker.id}`} className="demo-notice-banner" role="status">
            <span aria-hidden="true">🧪</span>
            <span>{worker.demoNotice}</span>
            {worker.deletable ? (
              <button
                type="button"
                disabled={busyKey === `banner-delete-${worker.id}`}
                onClick={() => {
                  if (!window.confirm(`Delete ${worker.name}? You can restore it from the Worker store later.`)) return;
                  setBusyKey(`banner-delete-${worker.id}`);
                  fetch(`/api/workers/${encodeURIComponent(worker.id)}`, { method: 'DELETE', credentials: 'include' })
                    .then(() => fetchDashboard(true))
                    .catch((err: unknown) => setError(toAppError(err)))
                    .finally(() => setBusyKey(null));
                }}
              >
                {busyKey === `banner-delete-${worker.id}` ? 'Deleting…' : 'Delete'}
              </button>
            ) : (
              <button type="button" onClick={() => setActiveTab('workers')}>
                Open Workers
              </button>
            )}
          </div>
        ))}
    </>
  );
}
