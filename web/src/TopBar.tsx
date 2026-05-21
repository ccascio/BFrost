import { useState } from 'react';
import type { ChangeEventHandler } from 'react';

interface AppError {
  friendly: string;
  detail?: string;
}

interface TopBarProps {
  notice: string;
  error: AppError | null;
  environment: string;
  adminUrl: string;
  pid: number;
  models: Array<{ alias: string; label: string; provider: string }>;
  selectedModelAlias: string;
  modelBusy: boolean;
  selectedModelIsLocal: boolean;
  selectedModelIsPinned: boolean;
  pinBusy: boolean;
  authEnabled: boolean;
  logoutBusy: boolean;
  onModelChange: ChangeEventHandler<HTMLSelectElement>;
  onSaveModel: () => void;
  onTogglePin: () => void;
  onDismissError: () => void;
  onLogout: () => void;
}

export function TopBar({
  notice,
  error,
  environment,
  adminUrl,
  pid,
  models,
  selectedModelAlias,
  modelBusy,
  selectedModelIsLocal,
  selectedModelIsPinned,
  pinBusy,
  authEnabled,
  logoutBusy,
  onModelChange,
  onSaveModel,
  onTogglePin,
  onDismissError,
  onLogout,
}: TopBarProps) {
  const [showDetail, setShowDetail] = useState(false);

  // Reset detail panel when error changes
  const errorKey = error?.friendly ?? '';

  function copyDiagnostic() {
    if (!error) return;
    const bundle = JSON.stringify({
      timestamp: new Date().toISOString(),
      error: {
        friendly: error.friendly,
        technical: error.detail ?? error.friendly,
      },
      bfrost: { adminUrl, pid },
      browser: navigator.userAgent,
    }, null, 2);
    void navigator.clipboard.writeText(bundle);
  }

  return (
    <header className="topbar">
      <div className="topbar-title">
        <strong>BFrost</strong>
        <span>Worker-first local AI operations</span>
      </div>

      <div className="topbar-meta">
        <span className="environment-chip" title={`${adminUrl} · PID ${pid}`}>
          {environment}
        </span>
        <span className="notice-line" role="status" aria-live="polite">
          {notice}
        </span>
      </div>

      <div className="topbar-actions">
        <label className="model-select">
          <span>Active model</span>
          <select value={selectedModelAlias} onChange={onModelChange}>
            {models.map((model) => (
              <option key={model.alias} value={model.alias}>
                {model.label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="compact-button primary"
          type="button"
          disabled={modelBusy}
          onClick={onSaveModel}
        >
          {modelBusy ? 'Saving...' : 'Save'}
        </button>
        {selectedModelIsLocal ? (
          <button
            className={`compact-button${selectedModelIsPinned ? ' pin-active' : ''}`}
            type="button"
            disabled={pinBusy}
            onClick={onTogglePin}
            title={
              selectedModelIsPinned
                ? 'Unload this model and stop keeping it resident'
                : 'Load this model now and keep it resident across chats/jobs'
            }
          >
            {pinBusy
              ? selectedModelIsPinned ? 'Unloading...' : 'Loading...'
              : selectedModelIsPinned ? 'Unload' : 'Load'}
          </button>
        ) : null}
        {authEnabled ? (
          <button className="compact-button" type="button" disabled={logoutBusy} onClick={onLogout}>
            {logoutBusy ? 'Signing out...' : 'Sign out'}
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="toast error-toast" role="alert" key={errorKey}>
          <div className="error-toast-body">
            <span className="error-toast-message">{error.friendly}</span>
            {error.detail ? (
              <div className="error-toast-meta">
                <button
                  type="button"
                  className="error-toast-toggle"
                  aria-expanded={showDetail}
                  onClick={() => setShowDetail((v) => !v)}
                >
                  {showDetail ? 'Hide details' : 'Show details'}
                </button>
                <button
                  type="button"
                  className="error-toast-toggle"
                  title="Copy diagnostic bundle to clipboard"
                  onClick={copyDiagnostic}
                >
                  Copy
                </button>
              </div>
            ) : null}
            {showDetail && error.detail ? (
              <pre className="error-toast-detail">{error.detail}</pre>
            ) : null}
          </div>
          <button type="button" className="error-toast-dismiss" aria-label="Dismiss error" onClick={onDismissError}>
            ✕
          </button>
        </div>
      ) : null}
    </header>
  );
}
