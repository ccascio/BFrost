import { useState } from 'react';
import type { DashboardSnapshot } from './types';

export function StepSecurity({ dashboard, onRefresh }: { dashboard: DashboardSnapshot; onRefresh: () => Promise<void> }) {
  const platform = dashboard.platform;
  const [password, setPassword] = useState('');
  const [ttl, setTtl] = useState(String(platform?.adminSessionTtlHours ?? 12));
  const [jobTimeout, setJobTimeout] = useState(String(platform?.jobLlmTimeoutMs ?? 120000));
  const [localCode, setLocalCode] = useState(platform?.localWorkerCodeEnabled ?? false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [savedSettings, setSavedSettings] = useState(false);
  const [passwordSet, setPasswordSet] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ttlNum = Number(ttl);
  const timeoutNum = Number(jobTimeout);

  async function saveSettings() {
    setSavingSettings(true);
    setError(null);
    setSavedSettings(false);
    try {
      const body: Record<string, unknown> = { localWorkerCodeEnabled: localCode };
      if (Number.isFinite(ttlNum) && ttlNum > 0) body.adminSessionTtlHours = ttlNum;
      if (Number.isFinite(timeoutNum) && timeoutNum > 0) body.jobLlmTimeoutMs = timeoutNum;
      const res = await fetch('/api/core-settings', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(await res.text());
      setSavedSettings(true);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingSettings(false);
    }
  }

  async function savePassword() {
    if (password.trim().length < 4) return;
    setSavingPassword(true);
    setError(null);
    try {
      await fetch('/api/wizard/state', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: true }),
      }).catch(() => undefined);
      const res = await fetch('/api/core-settings', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminPassword: password.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      setPasswordSet(true);
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div className="wizard-step-body">
      <h2>Platform &amp; security</h2>
      <p className="wizard-lead">
        BFrost runs locally and binds to <code>127.0.0.1</code> by default. These controls protect the
        dashboard and govern how workers run. All are optional - sensible defaults already apply.
      </p>

      <label className="wizard-field-label" htmlFor="wizard-admin-password">
        Dashboard password {platform?.adminPasswordSet ? '(currently set)' : '(not set - dashboard is open)'}
      </label>
      <div className="wizard-key-row">
        <input
          id="wizard-admin-password"
          type="password"
          placeholder={platform?.adminPasswordSet ? 'Enter a new password to change it' : 'Set a password to require login'}
          value={password}
          autoComplete="new-password"
          onChange={(e) => setPassword(e.target.value)}
        />
        <button
          type="button"
          className="primary"
          disabled={savingPassword || password.trim().length < 4}
          onClick={() => void savePassword()}
        >
          {savingPassword ? 'Saving...' : 'Set password'}
        </button>
      </div>
      {passwordSet ? (
        <p className="wizard-status-ok">✓ Password set. You'll be asked to log in again when you close the wizard.</p>
      ) : (
        <p className="wizard-footnote">Minimum 4 characters. Setting it logs out all sessions - do this last.</p>
      )}

      <label className="wizard-field-label" htmlFor="wizard-session-ttl">Login session length (hours)</label>
      <input
        id="wizard-session-ttl"
        type="number"
        min={1}
        value={ttl}
        onChange={(e) => setTtl(e.target.value)}
      />

      <label className="wizard-field-label" htmlFor="wizard-job-timeout">Job model timeout (ms)</label>
      <input
        id="wizard-job-timeout"
        type="number"
        min={1}
        value={jobTimeout}
        onChange={(e) => setJobTimeout(e.target.value)}
      />
      <p className="wizard-footnote">Maximum time a scheduled job's model call may run before it is aborted.</p>

      <label className="checkbox-row" htmlFor="wizard-local-code" style={{ marginTop: '0.75rem' }}>
        <input
          id="wizard-local-code"
          type="checkbox"
          checked={localCode}
          onChange={(e) => setLocalCode(e.target.checked)}
        />
        Allow local worker code execution
      </label>
      <p className="wizard-footnote">
        Leave off (recommended) unless you run local workers that ship executable code you trust. Built-in
        and manifest-only workers always load.
      </p>

      <div className="wizard-key-row" style={{ marginTop: '0.75rem' }}>
        <button type="button" className="primary" disabled={savingSettings} onClick={() => void saveSettings()}>
          {savingSettings ? 'Saving...' : 'Save settings'}
        </button>
      </div>
      {savedSettings ? <p className="wizard-status-ok">✓ Settings saved.</p> : null}
      {error ? <p className="wizard-error">{error}</p> : null}
    </div>
  );
}
