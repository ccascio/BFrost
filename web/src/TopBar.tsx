import { useState } from 'react';
import type { ChangeEventHandler } from 'react';
import { Icon } from './icons';
import { CopyButton, NotificationStack, Progress } from './ui';

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
  onOpenNavigation: () => void;
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
  onOpenNavigation,
  onModelChange,
  onSaveModel,
  onTogglePin,
  onDismissError,
  onLogout,
}: TopBarProps) {
  const [showDetail, setShowDetail] = useState(false);
  const [dismissedNotice, setDismissedNotice] = useState<string | null>(null);

  // Reset detail panel when error changes
  const errorKey = error?.friendly ?? '';

  function diagnosticBundle() {
    if (!error) return;
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      error: {
        friendly: error.friendly,
        technical: error.detail ?? error.friendly,
      },
      bfrost: { adminUrl, pid },
      browser: navigator.userAgent,
    }, null, 2);
  }

  const busyLabel =
    modelBusy ? 'Saving model preference' :
    pinBusy ? selectedModelIsPinned ? 'Unloading local model' : 'Loading local model' :
    logoutBusy ? 'Signing out' :
    null;
  const promotedNoticeTone = promotedNoticeFor(notice);
  const notificationItems = [
    promotedNoticeTone && dismissedNotice !== notice ? {
      id: 'topbar-notice',
      tone: promotedNoticeTone,
      title: notice,
    } : null,
    error ? {
      id: 'topbar-error',
      tone: 'error' as const,
      title: error.friendly,
      description: error.detail && showDetail ? (
        <pre className="error-toast-detail">{error.detail}</pre>
      ) : null,
      action: error.detail ? (
        <div className="error-toast-meta">
          <button
            type="button"
            className="error-toast-toggle"
            aria-expanded={showDetail}
            onClick={() => setShowDetail((v) => !v)}
          >
            {showDetail ? 'Hide details' : 'Show details'}
          </button>
          <CopyButton
            value={diagnosticBundle() ?? ''}
            label="Copy diagnostic"
            copiedLabel="Copied"
            variant="ghost"
            size="sm"
          />
        </div>
      ) : null,
    } : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null);

  return (
    <header className="topbar">
      <button
        className="topbar-menu-button"
        type="button"
        aria-label="Open dashboard navigation"
        onClick={onOpenNavigation}
      >
        <Icon name="overview" />
      </button>
      <div className="topbar-title">
        <strong>BFrost</strong>
        <span>Worker-first local AI operations</span>
      </div>

      <div className="topbar-meta">
        {environment ? (
          <span className="environment-chip" title={`${adminUrl} · PID ${pid}`}>
            {environment}
          </span>
        ) : null}
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
          Save
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
            {selectedModelIsPinned ? 'Unload' : 'Load'}
          </button>
        ) : null}
        {authEnabled ? (
          <button className="compact-button" type="button" disabled={logoutBusy} onClick={onLogout}>
            Sign out
          </button>
        ) : null}
        {busyLabel ? (
          <div className="topbar-progress" role="status" aria-live="polite">
            <Progress label={busyLabel} />
          </div>
        ) : null}
      </div>

      {notificationItems.length > 0 ? (
        <NotificationStack
          key={errorKey}
          label="Dashboard notifications"
          items={notificationItems}
          onDismiss={(id) => {
            if (id === 'topbar-error') {
              onDismissError();
              return;
            }
            setDismissedNotice(notice);
          }}
        />
      ) : null}
    </header>
  );
}

function promotedNoticeFor(notice: string): 'info' | 'success' | 'warning' | null {
  const normalized = notice.trim().toLowerCase();
  if (!normalized || normalized.startsWith('loading') || normalized.startsWith('updated ')) return null;
  if (
    normalized.includes('failed') ||
    normalized.includes('offline') ||
    normalized.includes('safe mode') ||
    normalized.includes('restart')
  ) {
    return 'warning';
  }
  if (
    normalized.includes('installed') ||
    normalized.includes('uploaded') ||
    normalized.includes('deleted') ||
    normalized.includes('updated') ||
    normalized.includes('authenticated') ||
    normalized.includes('signed out') ||
    normalized.includes('loaded') ||
    normalized.includes('unloaded') ||
    normalized.includes('answered') ||
    normalized.includes('sample data')
  ) {
    return 'success';
  }
  return 'info';
}
