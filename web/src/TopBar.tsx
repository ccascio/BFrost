import type { ChangeEventHandler } from 'react';

interface TopBarProps {
  notice: string;
  error: string | null;
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
        <div className="toast error-toast" role="alert">
          <span>{error}</span>
          <button type="button" aria-label="Dismiss error" onClick={onDismissError}>
            Dismiss
          </button>
        </div>
      ) : null}
    </header>
  );
}
