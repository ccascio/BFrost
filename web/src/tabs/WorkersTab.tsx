// Workers tab — install/upload and the installed-worker list.
// Extracted from App.tsx (CODE_ROADMAP Phase 1.2). renderWorkerGroups/renderWorkerRow
// are worker-only closures kept as inner functions so they close over props.
import { HelpTip, StatusPill, workerHealthTone, workerHealthLabel } from '../app-helpers';
import type { DashboardState, WorkerKind, WorkerSummary } from '../app-types';

export interface WorkersTabProps {
  dashboard: DashboardState;
  busyKey: string | null;
  workerUploadFile: File | null;
  setWorkerUploadFile: (f: File | null) => void;
  storeUpdates: Map<string, string>;
  uploadWorkerZip: () => void | Promise<void>;
  deleteWorker: (worker: WorkerSummary) => void | Promise<void>;
  mutate: (key: string, input: RequestInfo, init: RequestInit, successMessage: string) => void | Promise<void>;
}

export function WorkersTab(props: WorkersTabProps) {
  const {
    dashboard, busyKey,
    workerUploadFile, setWorkerUploadFile, storeUpdates,
    uploadWorkerZip, deleteWorker, mutate,
  } = props;

  function renderWorkerGroups(workers: WorkerSummary[]) {
    const groups: Array<{ kind: WorkerKind; label: string; description: string }> = [
      { kind: 'provider', label: 'LLM Platforms', description: 'Model runtimes. One local platform is active at a time; cloud platforms coexist.' },
      { kind: 'channel', label: 'Channels', description: 'Communication adapters. Any can run; one is designated as the primary recipient for operator notifications.' },
      { kind: 'feature', label: 'Features', description: 'Job and tool workers that add capabilities.' },
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
                <StatusPill tone="muted">{String(groupWorkers.length)}</StatusPill>
              </div>
              {groupWorkers.map((worker) => renderWorkerRow(worker))}
            </div>
          );
        })}
      </div>
    );
  }

  function renderWorkerRow(worker: WorkerSummary) {
    const updateVersion = storeUpdates.get(worker.id);
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
          {updateVersion ? (
            <StatusPill tone="info">{`v${updateVersion} available`}</StatusPill>
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

  return (
        <>
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
              <StatusPill tone="muted">{`${dashboard.workers.length} loaded`}</StatusPill>
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
                BFrost ships with bundled workers for production, analysis, publishing, channels, and providers.
                If none are showing here, click <strong>Rescan</strong> above. To add a community
                worker, drop its folder under <code>workers/local/</code> and rescan.
              </p>
            </div>
          ) : (
            renderWorkerGroups(dashboard.workers)
          )}
        </section>
        </>
  );
}
