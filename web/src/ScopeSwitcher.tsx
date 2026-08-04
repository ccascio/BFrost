import { useCallback, useEffect, useRef, useState } from 'react';

// Generic, worker-agnostic active-scope switcher. Core knows nothing about what a scope is
// (site, workspace, account, …): it reads the option list and the human label from
// whichever worker declared `scopeProvider`, via that worker's `workerData` slice, and
// persists the selection through the core /api/active-scope endpoint.
interface ScopeOption {
  id: string;
  label: string;
  health?: 'healthy' | 'error' | string;
}

interface ScopeSwitcherProps {
  providerWorkerId: string | null;
  activeScopeId: string | null;
  onScopeChanged: () => void | Promise<void>;
}

const GLOBAL_SCOPE_ID = '__global__';

export function ScopeSwitcher({ providerWorkerId, activeScopeId, onScopeChanged }: ScopeSwitcherProps) {
  const [options, setOptions] = useState<ScopeOption[]>([]);
  const [scopeLabel, setScopeLabel] = useState('Scope');
  const [allLabel, setAllLabel] = useState('All');
  const [allowAllScope, setAllowAllScope] = useState(true);
  const [defaultScopeId, setDefaultScopeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Guards against firing the auto-select twice before the parent re-renders with the new scope.
  const autoSelectPending = useRef(false);

  const loadOptions = useCallback(async () => {
    if (!providerWorkerId) {
      setOptions([]);
      return;
    }
    try {
      const res = await fetch('/api/dashboard/worker-data', { credentials: 'include' });
      if (!res.ok) return;
      const payload = (await res.json()) as { workerData?: Record<string, any> };
      const slice = payload.workerData?.[providerWorkerId] as any;
      setOptions(Array.isArray(slice?.scopes) ? slice.scopes : []);
      if (typeof slice?.scopeLabel === 'string') setScopeLabel(slice.scopeLabel);
      if (typeof slice?.allScopesLabel === 'string') setAllLabel(slice.allScopesLabel);
      setAllowAllScope(slice?.allowAllScope !== false);
      setDefaultScopeId(typeof slice?.defaultScopeId === 'string' ? slice.defaultScopeId : null);
    } catch {
      // The switcher is best-effort; a transient failure just leaves the prior options.
    }
  }, [providerWorkerId]);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions, activeScopeId]);

  // Older builds exposed "__global__" as a separate menu item. The single "All sites"
  // option now owns both meanings: all-site dashboards and global-default Config records.
  useEffect(() => {
    if (activeScopeId === GLOBAL_SCOPE_ID && !busy) {
      void changeScope('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeScopeId, busy]);

  // When allowAllScope is false, always ensure a scope is active.
  useEffect(() => {
    if (!allowAllScope && activeScopeId === null && options.length > 0 && !autoSelectPending.current) {
      const target =
        defaultScopeId && options.some((o) => o.id === defaultScopeId)
          ? defaultScopeId
          : options[0].id;
      autoSelectPending.current = true;
      void changeScope(target);
    }
    if (activeScopeId !== null) autoSelectPending.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowAllScope, activeScopeId, options.length, defaultScopeId]);

  if (!providerWorkerId) return null;

  async function changeScope(nextId: string) {
    setBusy(true);
    try {
      await fetch('/api/active-scope', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scopeId: nextId === '' ? null : nextId }),
      });
      await onScopeChanged();
      await loadOptions();
    } finally {
      setBusy(false);
    }
  }

  // When allowAllScope is false and no scope is active yet, visually pre-select the target
  // while the auto-select effect fires, to avoid an empty select appearing momentarily.
  const displayValue =
    activeScopeId === GLOBAL_SCOPE_ID
      ? ''
      : activeScopeId ??
    (!allowAllScope && options.length > 0
      ? (defaultScopeId && options.some((o) => o.id === defaultScopeId) ? defaultScopeId : options[0].id)
      : '');

  return (
    <div className="scope-switcher">
      <span className="scope-switcher-label" id="scope-switcher-label">{scopeLabel}</span>
      {options.length > 0 ? (
        <select
          aria-labelledby="scope-switcher-label"
          value={displayValue}
          disabled={busy}
          onChange={(event) => void changeScope(event.target.value)}
        >
          {allowAllScope ? <option value="">{allLabel}</option> : null}
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.health === 'error' ? `⚠ ${option.label}` : option.label}
            </option>
          ))}
        </select>
      ) : (
        <span className="scope-switcher-empty">none yet</span>
      )}
    </div>
  );
}
