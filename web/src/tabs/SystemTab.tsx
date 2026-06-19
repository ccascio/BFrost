import type { Dispatch, SetStateAction } from 'react';
import type {
  AutoBackupSettings,
  CoreDashboardTab,
  DashboardState,
  WhatsNewEntry,
} from '../app-types';
import {
  Detail,
  HealthRow,
  HelpTip,
  StatusPill,
  eventSeverityTone,
  formatBytes,
  formatDate,
} from '../app-helpers';
import { CopyButton } from '../ui';

interface ResetChecks {
  wipeWorkerState: boolean;
  wipeCredentials: boolean;
  wipeBackups: boolean;
}

interface SystemTabProps {
  dashboard: DashboardState;
  whatsNew: WhatsNewEntry[] | null;
  autoBackupSettings: AutoBackupSettings | null;
  setAutoBackupSettings: Dispatch<SetStateAction<AutoBackupSettings | null>>;
  saveAutoBackup: (patch: Partial<AutoBackupSettings>) => Promise<void>;
  busyKey: string | null;
  mutate: (key: string, input: RequestInfo, init: RequestInit, successMessage: string) => void;
  restoreBackup: (file: string) => Promise<void>;
  cancelRestore: () => Promise<void>;
  resetChecks: ResetChecks;
  setResetChecks: Dispatch<SetStateAction<ResetChecks>>;
  resetConfirmOpen: boolean;
  setResetConfirmOpen: Dispatch<SetStateAction<boolean>>;
  executeFactoryReset: () => Promise<void>;
  setActiveTab: (tab: CoreDashboardTab) => void;
}

export function SystemTab(props: SystemTabProps) {
  const {
    dashboard,
    whatsNew,
    autoBackupSettings,
    setAutoBackupSettings,
    saveAutoBackup,
    busyKey,
    mutate,
    restoreBackup,
    cancelRestore,
    resetChecks,
    setResetChecks,
    resetConfirmOpen,
    setResetConfirmOpen,
    executeFactoryReset,
    setActiveTab,
  } = props;
  const dependencyEntries = Object.entries(dashboard.dependencies)
    .sort(([a], [b]) => dependencyLabel(a).localeCompare(dependencyLabel(b)));

  return (
    <>
      {whatsNew && whatsNew.length > 0 ? (
        <section className="panel tab-page">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">Changelog</p>
              <h2>What's new</h2>
            </div>
          </div>
          <div className="detail-body">
            {whatsNew.map((entry) => (
              <div key={entry.version} className="whats-new-entry">
                <div className="whats-new-header">
                  <strong>v{entry.version}</strong>
                  <span className="whats-new-headline">{entry.headline}</span>
                  <span className="whats-new-date">{entry.date}</span>
                </div>
                <ul className="whats-new-list">
                  {entry.items.map((item, i) => (
                    <li key={i}>{item.replace(/\*\*(.*?)\*\*/g, '$1')}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="panel tab-page">
        <div className="panel-head">
          <div>
            <p className="panel-kicker">System</p>
            <h2>Runtime readiness <HelpTip>Shows whether BFrost's required services are running and configured — the AI model, any connected channels, and the local database. A yellow "missing" pill means a credential or dependency is not yet set up; use the worker's Config subtab in the left panel to fix it.</HelpTip></h2>
          </div>
        </div>

        <div className="panel-head section-break">
          <div>
            <p className="panel-kicker">Dependencies</p>
            <h2>Runtime readiness <HelpTip>Optional tools that workers need. Local runtimes let you run AI models on your own machine; other command-line tools support storage, audio, and worker-specific processing. Missing items are only a problem if a worker that needs them is enabled.</HelpTip></h2>
          </div>
        </div>

        <div className="stack-list">
          {dependencyEntries.map(([key, status]) => (
            <HealthRow key={key} label={dependencyLabel(key)} status={status} />
          ))}
        </div>

        <div className="panel-head section-break">
          <div>
            <p className="panel-kicker">Backups</p>
            <h2>Backups &amp; database <HelpTip>BFrost stores everything — queue items, events, worker settings, run history — in a single SQLite file on your machine. Enable automatic daily backups here; use the Restore button next to any snapshot to roll back. This is the easiest way to recover from a mistake.</HelpTip></h2>
          </div>
          <StatusPill tone={dashboard.backups.length > 0 ? 'good' : 'warning'}>
            {`${dashboard.backups.length} backups`}
          </StatusPill>
        </div>

        {autoBackupSettings ? (
          <div className="form-grid" style={{ marginBottom: '0.75rem' }}>
            <label className="field">
              <span>Automatic daily backup</span>
              <select
                value={autoBackupSettings.enabled ? 'yes' : 'no'}
                onChange={(e) => void saveAutoBackup({ enabled: e.target.value === 'yes' })}
                disabled={busyKey === 'auto-backup-settings'}
              >
                <option value="no">Off</option>
                <option value="yes">On — every day at 03:00</option>
              </select>
            </label>
            {autoBackupSettings.enabled ? (
              <label className="field">
                <span>Keep backups for (days)</span>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={autoBackupSettings.retentionDays}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (v >= 1 && v <= 365) {
                      setAutoBackupSettings((prev) => prev ? { ...prev, retentionDays: v } : prev);
                    }
                  }}
                  onBlur={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (v >= 1 && v <= 365) void saveAutoBackup({ retentionDays: v });
                  }}
                  disabled={busyKey === 'auto-backup-settings'}
                />
              </label>
            ) : null}
          </div>
        ) : null}

        <div className="panel-actions wrap">
          <button
            className="primary"
            disabled={busyKey === 'create-backup'}
            onClick={() =>
              void mutate(
                'create-backup',
                '/api/backups',
                { method: 'POST', body: JSON.stringify({}) },
                'SQLite backup created.',
              )
            }
          >
            {busyKey === 'create-backup' ? 'Creating...' : 'Create backup'}
          </button>
        </div>

        <div className="stack-list compact">
          {dashboard.backups.map((backup) => (
            <div className="backup-row" key={backup.file}>
              <div>
                <strong>
                  {backup.file}
                  {backup.restorePending ? (
                    <span className="status-pill warning" style={{ marginLeft: '0.5rem' }}>Restore pending</span>
                  ) : null}
                </strong>
                <span>{formatBytes(backup.sizeBytes)} · {formatDate(backup.createdAt)}</span>
                <span>{backup.path}</span>
              </div>
              <div className="panel-actions" style={{ flexShrink: 0 }}>
                {backup.restorePending ? (
                  <button type="button" onClick={() => void cancelRestore()}>
                    Cancel restore
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busyKey === `restore-${backup.file}`}
                    onClick={() => void restoreBackup(backup.file)}
                  >
                    {busyKey === `restore-${backup.file}` ? 'Scheduling...' : 'Restore'}
                  </button>
                )}
              </div>
            </div>
          ))}
          {dashboard.backups.length === 0 ? (
            <div className="empty-state">
              <p>No backups yet.</p>
              <p className="footnote">
                A backup is a snapshot of your local BFrost database — workers, settings,
                queue, events, and run history. Click <strong>Create backup</strong> above to
                make your first one; backups stay on this machine.
              </p>
            </div>
          ) : null}
        </div>
      </section>

      <section className="panel tab-page">
        <div className="panel-head">
          <div>
            <p className="panel-kicker">Danger zone</p>
            <h2>Factory reset <HelpTip>Use this when something is badly broken and you want a fresh start. You can choose what to wipe: worker state (job history, queue, notes), credentials (API keys), or both. The app restarts automatically afterward. This cannot be undone — take a backup first.</HelpTip></h2>
          </div>
        </div>
        <div className="detail-body">
          <div className="danger-zone-row">
            <div>
              <strong>Safe mode</strong>
              <span className="footnote">Opens the dashboard with all workers disabled. Re-enable them one at a time to diagnose a broken worker.</span>
            </div>
            <button type="button" onClick={() => { window.location.href = '/?safe=1'; }}>
              Restart in Safe Mode
            </button>
          </div>
          <p className="footnote" style={{ marginTop: '1rem' }}>
            Choose what to erase. <strong>Worker state</strong> includes all jobs, queue items, run
            history, and worker settings. <strong>Credentials</strong> removes all stored API keys.
            <strong> Backups</strong> deletes all local backup files. This cannot be undone.
          </p>
          <div className="factory-reset-checks">
            {(['wipeWorkerState', 'wipeCredentials', 'wipeBackups'] as const).map((key) => (
              <label key={key} className="checkbox-row">
                <input
                  type="checkbox"
                  checked={resetChecks[key]}
                  onChange={(e) => setResetChecks((c) => ({ ...c, [key]: e.target.checked }))}
                />
                {key === 'wipeWorkerState' ? 'Worker state (queue, runs, settings)' :
                 key === 'wipeCredentials' ? 'Credentials (API keys)' :
                 'Backups (all local backup files)'}
              </label>
            ))}
          </div>
          {!resetConfirmOpen ? (
            <button
              type="button"
              className="btn-danger"
              disabled={!resetChecks.wipeWorkerState && !resetChecks.wipeCredentials && !resetChecks.wipeBackups}
              onClick={() => setResetConfirmOpen(true)}
            >
              Reset…
            </button>
          ) : (
            <div className="factory-reset-confirm">
              <p><strong>Are you sure?</strong> This will permanently delete the selected data and exit BFrost. You must restart it manually.</p>
              <div className="panel-actions">
                <button
                  type="button"
                  className="btn-danger"
                  disabled={busyKey === 'factory-reset'}
                  onClick={() => void executeFactoryReset()}
                >
                  {busyKey === 'factory-reset' ? 'Resetting…' : 'Yes, reset and exit'}
                </button>
                <button type="button" onClick={() => setResetConfirmOpen(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="panel tab-page">
        <div className="panel-head">
          <div>
            <p className="panel-kicker">Event history</p>
            <h2>Recent operations <HelpTip>The full event log for this session — every action BFrost has taken across all workers. Use the search box above to filter by category or keyword. The most recent events are shown first.</HelpTip></h2>
          </div>
          <StatusPill tone="muted">{`${dashboard.events.length} events`}</StatusPill>
        </div>

        <div className="stack-list">
          {dashboard.events.map((event) => (
            <div className="event-row" key={event.id}>
              <div>
                <strong>{event.summary}</strong>
                <span>
                  {event.category} / {event.action} · {formatDate(event.createdAt)}
                </span>
              </div>
              <StatusPill tone={eventSeverityTone(event.severity)}>{event.severity}</StatusPill>
            </div>
          ))}
          {dashboard.events.length === 0 ? (
            <div className="empty-state">
              <p>No events recorded yet.</p>
              <p className="footnote">
                Every job run, worker change, queue update, and credential edit shows up here as a
                durable record. Enable a worker and trigger a run to populate this list.
              </p>
              <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
                <button type="button" onClick={() => setActiveTab('workers')}>
                  Open Workers
                </button>
                <button type="button" onClick={() => setActiveTab('jobs')}>
                  Open Jobs
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="panel tab-page">
        <div className="panel-head">
          <div>
            <p className="panel-kicker">Privacy</p>
            <h2>Zero telemetry</h2>
          </div>
          <StatusPill tone="good">Local-only</StatusPill>
        </div>
        <div className="detail-body">
          <div className="system-copy-row">
            <Detail label="Admin URL" value={dashboard.app.adminUrl} />
            <CopyButton value={dashboard.app.adminUrl} label="Copy URL" size="sm" />
          </div>
          <p className="footnote">
            BFrost collects <strong>no telemetry, no usage data, and no analytics</strong> — not even
            crash reports. All data (workers, queue, events, conversations, credentials) stays on your
            machine in <code>data/</code>. The only outbound connections BFrost makes are the ones you
            explicitly configure: AI provider API calls, channel messages, and optional store catalog
            lookups (which are opt-in when you open the Store tab).
          </p>
          <p className="footnote">
            Cloud provider API keys are stored in the local <code>.env</code> file and sent only to
            the selected provider. They are never sent to bfrost.net or any
            third-party service.
          </p>
        </div>
      </section>
    </>
  );
}

function dependencyLabel(key: string): string {
  const known: Record<string, string> = {
    ffmpeg: 'ffmpeg',
    sqliteCli: 'sqlite3',
    whisperCli: 'whisper-cli',
    whisperModel: 'Whisper model',
    embeddingModelReachable: 'Embedding model',
  };
  if (known[key]) return known[key];
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_.]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
