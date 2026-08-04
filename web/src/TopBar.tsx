import { Fragment, useEffect, useMemo, useState } from 'react';
import type { ChangeEventHandler } from 'react';
import type { PipelineStageSummary } from './app-types';
import { Icon } from './icons';
import { CopyButton, NotificationStack, Progress } from './ui';
import { ScopeSwitcher } from './ScopeSwitcher';

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
  pipelineStages: PipelineStageSummary[];
  models: Array<{ alias: string; label: string; provider: string; reasoningLevels?: string[] }>;
  selectedModelAlias: string;
  /** Platform-wide reasoning level applied when the selected model supports levels. */
  defaultReasoningLevel: string;
  modelBusy: boolean;
  selectedModelIsLocal: boolean;
  selectedModelIsPinned: boolean;
  pinBusy: boolean;
  authEnabled: boolean;
  logoutBusy: boolean;
  scope?: { providerWorkerId: string | null; activeScopeId: string | null };
  onScopeChanged: () => void | Promise<void>;
  onOpenNavigation: () => void;
  onModelChange: ChangeEventHandler<HTMLSelectElement>;
  onReasoningLevelChange: ChangeEventHandler<HTMLSelectElement>;
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
  pipelineStages,
  models,
  selectedModelAlias,
  defaultReasoningLevel,
  modelBusy,
  selectedModelIsLocal,
  selectedModelIsPinned,
  pinBusy,
  authEnabled,
  logoutBusy,
  scope,
  onScopeChanged,
  onOpenNavigation,
  onModelChange,
  onReasoningLevelChange,
  onTogglePin,
  onDismissError,
  onLogout,
}: TopBarProps) {
  const [showDetail, setShowDetail] = useState(false);
  const [dismissedNotice, setDismissedNotice] = useState<string | null>(null);
  const [modelQuery, setModelQuery] = useState('');
  const normalizedModelQuery = modelQuery.trim().toLowerCase();
  const matchingModels = useMemo(() => {
    if (!normalizedModelQuery) return models;
    return models.filter((model) =>
      [model.label, model.alias, model.provider]
        .some((value) => value.toLowerCase().includes(normalizedModelQuery)),
    );
  }, [models, normalizedModelQuery]);
  const selectedModel = models.find((model) => model.alias === selectedModelAlias);
  const visibleModels = selectedModel && !matchingModels.some((model) => model.alias === selectedModel.alias)
    ? [selectedModel, ...matchingModels]
    : matchingModels;

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
      BFrost: { adminUrl, pid },
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
        {pipelineStages.length > 0 ? (
          <MiniPipeline stages={pipelineStages} />
        ) : (
          <span>Worker-first local AI operations</span>
        )}
      </div>

      <div className="topbar-meta">
        {scope?.providerWorkerId ? (
          <ScopeSwitcher
            providerWorkerId={scope.providerWorkerId}
            activeScopeId={scope.activeScopeId}
            onScopeChanged={onScopeChanged}
          />
        ) : null}
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
        <div className="model-select">
          <span id="default-model-label">Default model</span>
          <div className="model-select-controls">
            <input
              className="model-search"
              type="search"
              value={modelQuery}
              placeholder={`Search ${models.length} models`}
              aria-label="Search default models"
              onChange={(event) => setModelQuery(event.target.value)}
            />
            <select
              value={selectedModelAlias}
              onChange={(event) => {
                onModelChange(event);
                setModelQuery('');
              }}
              aria-labelledby="default-model-label"
            >
              {visibleModels.length > 0 ? visibleModels.map((model) => (
                <option key={model.alias} value={model.alias}>
                  {model.label}
                </option>
              )) : (
                <option value="" disabled>No matching models</option>
              )}
            </select>
            {(selectedModel?.reasoningLevels?.length ?? 0) > 0 ? (
              <select
                value={
                  selectedModel!.reasoningLevels!.includes(defaultReasoningLevel)
                    ? defaultReasoningLevel
                    : selectedModel!.reasoningLevels!.includes('medium')
                      ? 'medium'
                      : selectedModel!.reasoningLevels![0]
                }
                aria-label="Default reasoning level"
                title="Reasoning level for the default model"
                onChange={onReasoningLevelChange}
              >
                {selectedModel!.reasoningLevels!.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        </div>
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

/**
 * A miniature rendering of the Overview "Live view" pipeline: one small node per
 * registered stage (showing its pending count), joined by plain connectors. Pending
 * counts say work is *waiting*; the running/queued state says work is *moving*, which is
 * the question the header is actually there to answer — so a running stage gets a
 * spinner ring and the strip grows a label naming what is being processed right now.
 *
 * The only animation is on nodes that are genuinely busy, so an idle desk stays as cheap
 * on battery as the original static strip. Names live in each node's tooltip.
 */
function MiniPipeline({ stages }: { stages: PipelineStageSummary[] }) {
  const running = stages.filter((stage) => stage.running);
  const queued = stages.filter((stage) => stage.queued && !stage.running);
  const summary = stages
    .map((stage) => {
      const state = stage.running ? 'running' : stage.queued ? 'queued' : 'idle';
      return `${stage.workerDisplayName} ${stage.pendingCount} pending, ${state}`;
    })
    .join('; ');

  return (
    <div className="topbar-pipeline-wrap">
      <div className="topbar-pipeline" role="img" aria-label={`Live pipeline — ${summary}`}>
        {stages.map((stage, index) => (
          <Fragment key={stage.jobId}>
            <span
              className={
                'topbar-pipeline-node' +
                (stage.running ? ' running' : '') +
                (stage.queued && !stage.running ? ' queued' : '') +
                (stage.pendingCount > 0 ? ' active' : '')
              }
              title={
                `${stage.workerDisplayName} · ${stage.jobLabel}: ${stage.pendingCount} pending` +
                (stage.running ? ' · running now' : stage.queued ? ' · waiting to start' : '')
              }
            >
              {stage.pendingCount}
            </span>
            {index < stages.length - 1 ? <span className="topbar-pipeline-link" aria-hidden="true" /> : null}
          </Fragment>
        ))}
      </div>
      <ProcessingLabel running={running} queued={queued} />
    </div>
  );
}

/**
 * The plain-language half of the strip: says who is working, not just how much is stacked
 * up. Falls back to a queued notice, then to the idle state, so the line never disappears
 * and shift the header's layout around.
 */
function ProcessingLabel({
  running,
  queued,
}: {
  running: PipelineStageSummary[];
  queued: PipelineStageSummary[];
}) {
  if (running.length > 0) {
    const names = running.map((stage) => stage.workerDisplayName);
    const label = names.length <= 2 ? names.join(' + ') : `${names[0]} +${names.length - 1} more`;
    const startedAt = running
      .map((stage) => stage.startedAt)
      .filter((value): value is string => Boolean(value))
      .sort()[0];
    return (
      <span className="topbar-pipeline-status running" role="status" aria-live="polite">
        <span className="topbar-pipeline-spinner" aria-hidden="true" />
        <span className="topbar-pipeline-status-text">
          {label}
          {startedAt ? <Elapsed since={startedAt} /> : null}
        </span>
      </span>
    );
  }

  if (queued.length > 0) {
    return (
      <span className="topbar-pipeline-status queued" role="status" aria-live="polite">
        {queued.length === 1 ? `${queued[0].workerDisplayName} queued` : `${queued.length} stages queued`}
      </span>
    );
  }

  return <span className="topbar-pipeline-status idle">Idle</span>;
}

/** Ticks a coarse mm:ss readout so a long-running stage visibly differs from a stuck one. */
function Elapsed({ since }: { since: string }) {
  const startedMs = new Date(since).getTime();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [since]);

  if (!Number.isFinite(startedMs)) return null;
  const seconds = Math.max(0, Math.floor((now - startedMs) / 1000));
  const text = seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
  return <span className="topbar-pipeline-elapsed"> · {text}</span>;
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
