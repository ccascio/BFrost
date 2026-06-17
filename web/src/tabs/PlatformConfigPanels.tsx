import type { Dispatch, SetStateAction } from 'react';
import type { DashboardState } from '../app-types';

type SaveCoreSettings = (patch: {
  adminPassword?: string;
  localWorkerCodeEnabled?: boolean;
  adminSessionTtlHours?: number;
  jobLlmTimeoutMs?: number;
}) => void | Promise<void>;

interface PlatformRoutingPanelProps {
  dashboard: DashboardState;
  busyKey: string | null;
  activeLocalProviderDraft: string;
  setActiveLocalProviderDraft: Dispatch<SetStateAction<string>>;
  primaryChannelDraft: string;
  setPrimaryChannelDraft: Dispatch<SetStateAction<string>>;
  savePlatformRouting: () => void | Promise<void>;
}

export function PlatformRoutingPanel({
  dashboard,
  busyKey,
  activeLocalProviderDraft,
  setActiveLocalProviderDraft,
  primaryChannelDraft,
  setPrimaryChannelDraft,
  savePlatformRouting,
}: PlatformRoutingPanelProps) {
  const providers = dashboard.availableLocalProviders;
  const channels = dashboard.availableChannels;
  const activeProviderValue = activeLocalProviderDraft || dashboard.platform.activeLocalProviderId;
  const primaryChannelValue = primaryChannelDraft || dashboard.platform.primaryChannelId;
  const dirty =
    (activeLocalProviderDraft && activeLocalProviderDraft !== dashboard.platform.activeLocalProviderId) ||
    (primaryChannelDraft && primaryChannelDraft !== dashboard.platform.primaryChannelId);

  return (
    <div className="detail-body">
      <p className="footnote">
        Pick which installed component drives each platform role. Switching does not enable or disable workers -
        enable/disable lives in the Workers tab.
      </p>

      <div className="form-grid">
        <label className="field">
          <span>Active local LLM platform</span>
          <select
            value={activeProviderValue}
            onChange={(event) => setActiveLocalProviderDraft(event.target.value)}
          >
            {providers.length === 0 ? <option value="">(no local providers installed)</option> : null}
            {providers.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label} ({entry.id})
              </option>
            ))}
          </select>
          <span className="footnote">
            Used by cron jobs and the assistant when running local models. Cloud models keep using their per-model provider.
          </span>
        </label>

        <label className="field">
          <span>Primary channel for notifications</span>
          <select
            value={primaryChannelValue}
            onChange={(event) => setPrimaryChannelDraft(event.target.value)}
          >
            {channels.length === 0 ? <option value="">(no channels installed)</option> : null}
            {channels.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label} ({entry.id})
              </option>
            ))}
          </select>
          <span className="footnote">
            Outbound operator notifications (cron-run outcomes, errors) go here. Inbound user messages still flow through every enabled channel.
          </span>
        </label>
      </div>

      <div className="panel-actions">
        <button
          className="primary"
          disabled={busyKey === 'save-platform-routing' || !dirty}
          onClick={() => void savePlatformRouting()}
        >
          {busyKey === 'save-platform-routing' ? 'Saving...' : 'Save routing'}
        </button>
      </div>
    </div>
  );
}

interface PlatformSecurityPanelProps {
  dashboard: DashboardState;
  busyKey: string | null;
  adminPasswordDraft: string;
  setAdminPasswordDraft: Dispatch<SetStateAction<string>>;
  sessionTtlDraft: string | null;
  setSessionTtlDraft: Dispatch<SetStateAction<string | null>>;
  jobTimeoutDraft: string | null;
  setJobTimeoutDraft: Dispatch<SetStateAction<string | null>>;
  saveCoreSettings: SaveCoreSettings;
}

export function PlatformSecurityPanel({
  dashboard,
  busyKey,
  adminPasswordDraft,
  setAdminPasswordDraft,
  sessionTtlDraft,
  setSessionTtlDraft,
  jobTimeoutDraft,
  setJobTimeoutDraft,
  saveCoreSettings,
}: PlatformSecurityPanelProps) {
  const platform = dashboard.platform;
  const saving = busyKey === 'save-core-settings';
  const ttlValue = sessionTtlDraft ?? String(platform.adminSessionTtlHours);
  const timeoutValue = jobTimeoutDraft ?? String(platform.jobLlmTimeoutMs);
  const ttlNum = Number(ttlValue);
  const timeoutNum = Number(timeoutValue);
  const ttlDirty = Number.isFinite(ttlNum) && ttlNum > 0 && ttlNum !== platform.adminSessionTtlHours;
  const timeoutDirty = Number.isFinite(timeoutNum) && timeoutNum > 0 && timeoutNum !== platform.jobLlmTimeoutMs;

  return (
    <div className="detail-body">
      <p className="footnote">
        Core platform and security settings. Changes are written to your <code>.env</code> and applied
        immediately (no restart) unless noted. The admin password itself is never displayed here.
      </p>

      <div className="form-grid">
        <label className="field">
          <span>Admin password {platform.adminPasswordSet ? '(currently set)' : '(not set - dashboard is open)'}</span>
          <input
            type="password"
            value={adminPasswordDraft}
            placeholder={platform.adminPasswordSet ? 'Enter a new password to change it' : 'Set a password to require login'}
            onChange={(event) => setAdminPasswordDraft(event.target.value)}
          />
          <span className="footnote">
            Setting or changing the password logs out every session (including this one) - you will be
            asked to log in again. Minimum 4 characters. Leave the dashboard unprotected only on a
            machine you fully trust.
          </span>
          <div className="panel-actions">
            <button
              className="primary"
              disabled={saving || adminPasswordDraft.trim().length < 4}
              onClick={() => void saveCoreSettings({ adminPassword: adminPasswordDraft })}
            >
              {saving ? 'Saving...' : platform.adminPasswordSet ? 'Change password' : 'Set password'}
            </button>
            {platform.adminPasswordSet ? (
              <button
                className="ghost"
                disabled={saving}
                onClick={() => {
                  if (window.confirm('Remove the admin password and disable login? Anyone who can reach the dashboard will have full control.')) {
                    void saveCoreSettings({ adminPassword: '' });
                  }
                }}
              >
                Disable login
              </button>
            ) : null}
          </div>
        </label>

        <label className="field checkbox">
          <span>Allow local worker code execution ({platform.localWorkerCodeEnabled ? 'allowed' : 'blocked - recommended'})</span>
          <input
            type="checkbox"
            checked={platform.localWorkerCodeEnabled}
            disabled={saving}
            onChange={(event) => void saveCoreSettings({ localWorkerCodeEnabled: event.target.checked })}
          />
          <span className="footnote">
            When off, local workers that ship executable code are not compiled or run - only built-in
            workers and manifest-only local workers load. Turn this on solely for worker code you have
            reviewed and trust. After enabling, re-enable affected workers from the Workers tab (or
            restart) so they load.
          </span>
        </label>

        <label className="field">
          <span>Login session length (hours)</span>
          <input
            type="number"
            min={1}
            value={ttlValue}
            onChange={(event) => setSessionTtlDraft(event.target.value)}
          />
          <span className="footnote">How long a login stays valid before re-authentication is required.</span>
          <div className="panel-actions">
            <button
              className="primary"
              disabled={saving || !ttlDirty}
              onClick={() => void saveCoreSettings({ adminSessionTtlHours: ttlNum })}
            >
              {saving ? 'Saving...' : 'Save session length'}
            </button>
          </div>
        </label>

        <label className="field">
          <span>Job model timeout (ms)</span>
          <input
            type="number"
            min={1}
            value={timeoutValue}
            onChange={(event) => setJobTimeoutDraft(event.target.value)}
          />
          <span className="footnote">Maximum time a scheduled job's model call may run before it is aborted.</span>
          <div className="panel-actions">
            <button
              className="primary"
              disabled={saving || !timeoutDirty}
              onClick={() => void saveCoreSettings({ jobLlmTimeoutMs: timeoutNum })}
            >
              {saving ? 'Saving...' : 'Save timeout'}
            </button>
          </div>
        </label>

        <label className="field">
          <span>Dashboard bind address</span>
          <input type="text" value={`${platform.adminHost}:${platform.adminPort}`} readOnly disabled />
          <span className="footnote">
            Read-only. Changing the host or port requires editing <code>ADMIN_HOST</code> / <code>ADMIN_PORT</code>{' '}
            in <code>.env</code> and restarting. Keep it on <code>127.0.0.1</code> unless you understand the
            exposure - a non-loopback bind makes the dashboard reachable from your network.
          </span>
        </label>
      </div>
    </div>
  );
}
