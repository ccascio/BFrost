// Workers tab — describe-a-worker, install/upload, and the installed-worker list.
// Extracted from App.tsx (CODE_ROADMAP Phase 1.2). renderWorkerGroups/renderWorkerRow
// are worker-only closures kept as inner functions so they close over props.
import type { Dispatch, SetStateAction } from 'react';
import { HelpTip, StatusPill, workerHealthTone, workerHealthLabel } from '../app-helpers';
import type { DashboardState, WorkerKind, WorkerSummary } from '../app-types';

export interface WorkersTabProps {
  dashboard: DashboardState;
  busyKey: string | null;
  workerDescription: string;
  setWorkerDescription: Dispatch<SetStateAction<string>>;
  generatedWorker: { id: string; displayName: string; role: string; enabled: boolean; note?: string } | null;
  workerUploadFile: File | null;
  setWorkerUploadFile: (f: File | null) => void;
  storeUpdates: Map<string, string>;
  generateWorkerFromDescription: () => void | Promise<void>;
  uploadWorkerZip: () => void | Promise<void>;
  deleteWorker: (worker: WorkerSummary) => void | Promise<void>;
  mutate: (key: string, input: RequestInfo, init: RequestInit, successMessage: string) => void | Promise<void>;
}

export function WorkersTab(props: WorkersTabProps) {
  const {
    dashboard, busyKey, workerDescription, setWorkerDescription, generatedWorker,
    workerUploadFile, setWorkerUploadFile, storeUpdates,
    generateWorkerFromDescription, uploadWorkerZip, deleteWorker, mutate,
  } = props;

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

  return (
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
  );
}
