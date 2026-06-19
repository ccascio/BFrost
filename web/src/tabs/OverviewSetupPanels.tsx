import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type {
  AppError,
  DashboardState,
  DashboardTab,
  JobSecretReferenceField,
  WorkerOnboardingAction,
} from '../app-types';
import { toAppError } from '../app-types';
import { OverviewRecipesPanel } from './OverviewRecipesPanel';

export type DemoNarration = {
  stages: Array<{ label: string; detail: string }>;
  currentIndex: number;
  done: boolean;
} | null;

export type DemoRecap = {
  headline: string;
  body: string;
  ctaText?: string;
  ctaAction?: string;
} | null;

export type FirstResultJob = { label: string; summary: string; jobName: string } | null;

export interface OverviewSetupPanelsProps {
  dashboard: DashboardState;
  busyKey: string | null;
  setBusyKey: Dispatch<SetStateAction<string | null>>;
  setError: Dispatch<SetStateAction<AppError | null>>;
  setDashboard: Dispatch<SetStateAction<DashboardState | null>>;
  setActiveTab: (tab: DashboardTab) => void;
  onboardingRan: boolean;
  runDemoAction: (action: WorkerOnboardingAction & { workerId: string }) => Promise<void>;
  fetchDashboard: (force: boolean) => Promise<void>;
  firstResultJob: FirstResultJob;
  firstResultShownKey: string;
  setFirstResultJob: Dispatch<SetStateAction<FirstResultJob>>;
  lmAdoptDismissed: boolean;
  setLmAdoptDismissed: Dispatch<SetStateAction<boolean>>;
  lmAdopting: boolean;
  setLmAdopting: Dispatch<SetStateAction<boolean>>;
  demoNarration: DemoNarration;
  demoRecap: DemoRecap;
  setDemoRecap: Dispatch<SetStateAction<DemoRecap>>;
  setWizardOpen: Dispatch<SetStateAction<boolean>>;
  starAsk: boolean;
  dismissStarAsk: () => void;
  wizardCompleted: boolean;
  cloudTestReply: string | null;
  setCloudTestReply: Dispatch<SetStateAction<string | null>>;
  cloudConnectProvider: string;
  setCloudConnectProvider: Dispatch<SetStateAction<string>>;
  cloudConnectKey: string;
  setCloudConnectKey: Dispatch<SetStateAction<string>>;
  cloudConnecting: boolean;
  setCloudConnecting: Dispatch<SetStateAction<boolean>>;
  recipeApplied: Set<string>;
  setRecipeApplied: Dispatch<SetStateAction<Set<string>>>;
  recipeExpanded: string | null;
  setRecipeExpanded: Dispatch<SetStateAction<string | null>>;
  recipeInputValues: Record<string, string>;
  setRecipeInputValues: Dispatch<SetStateAction<Record<string, string>>>;
  recipeApplying: boolean;
  setRecipeApplying: Dispatch<SetStateAction<boolean>>;
  renderStuckDetectorBanner: () => ReactNode;
}

export function OverviewSetupPanels(props: OverviewSetupPanelsProps) {
  const {
    dashboard,
    busyKey,
    setBusyKey,
    setError,
    setDashboard,
    setActiveTab,
    onboardingRan,
    runDemoAction,
    fetchDashboard,
    firstResultJob,
    firstResultShownKey,
    setFirstResultJob,
    lmAdoptDismissed,
    setLmAdoptDismissed,
    lmAdopting,
    setLmAdopting,
    demoNarration,
    demoRecap,
    setDemoRecap,
    setWizardOpen,
    starAsk,
    dismissStarAsk,
    wizardCompleted,
    cloudTestReply,
    setCloudTestReply,
    cloudConnectProvider,
    setCloudConnectProvider,
    cloudConnectKey,
    setCloudConnectKey,
    cloudConnecting,
    setCloudConnecting,
    recipeApplied,
    setRecipeApplied,
    recipeExpanded,
    setRecipeExpanded,
    recipeInputValues,
    setRecipeInputValues,
    recipeApplying,
    setRecipeApplying,
    renderStuckDetectorBanner,
  } = props;
  const localProviderWorkerIds = new Set(dashboard.availableLocalProviders.map((provider) => provider.workerId));

  return (
    <>
      {renderStuckDetectorBanner()}
      {(() => {
        // Generic first-run CTA: surface whatever onboarding actions the worker registry
        // exposes until the user has run something. Names no worker — removing the worker
        // that contributes the action removes this card.
        const hasRun = dashboard.cron.jobs.some((j) => j.lastStartedAt !== null && j.lastStartedAt !== undefined);
        if (hasRun || onboardingRan) return null;
        const actions = dashboard.workers
          .filter((w) => w.onboarding && w.enabled)
          .map((w) => ({ ...(w.onboarding as WorkerOnboardingAction), workerId: w.id }))
          .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
        if (actions.length === 0) return null;
        const runAction = runDemoAction;
        const deletableDemoWorkers = actions
          .map((a) => dashboard.workers.find((w) => w.id === a.workerId))
          .filter((w): w is NonNullable<typeof w> => Boolean(w?.deletable));

        const dismissDemo = async () => {
          if (!window.confirm('Delete the demo worker? You can restore it from the Worker store later.')) return;
          setBusyKey('onboarding:dismiss');
          try {
            for (const w of deletableDemoWorkers) {
              await fetch(`/api/workers/${encodeURIComponent(w.id)}`, {
                method: 'DELETE',
                credentials: 'include',
              });
            }
            await fetchDashboard(true);
          } catch (err) {
            setError(toAppError(err));
          } finally {
            setBusyKey(null);
          }
        };

        return (
          <section className="panel onboarding-hero">
            <div className="panel-head">
              <div>
                <p className="panel-kicker">Get started</p>
                <h2>See BFrost work — no setup needed</h2>
              </div>
            </div>
            <p className="footnote">{actions[0].description}</p>
            <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
              {actions.map((action) => (
                <button
                  key={`${action.workerId}:${action.id}`}
                  type="button"
                  className="primary"
                  disabled={(!action.endpoint && !action.runJob) || busyKey === `onboarding:${action.id}` || busyKey === 'onboarding:dismiss'}
                  onClick={() => void runAction(action)}
                >
                  {busyKey === `onboarding:${action.id}` ? 'Running…' : action.title}
                </button>
              ))}
              {deletableDemoWorkers.length > 0 ? (
                <button
                  type="button"
                  disabled={busyKey === 'onboarding:dismiss'}
                  onClick={() => void dismissDemo()}
                >
                  {busyKey === 'onboarding:dismiss' ? 'Deleting…' : 'Not interested — delete demo'}
                </button>
              ) : null}
            </div>
          </section>
        );
      })()}
      {firstResultJob ? (
        <section className="panel first-result-banner" aria-label="First result delivered" aria-live="polite">
          <div className="panel-head" style={{ alignItems: 'flex-start' }}>
            <div>
              <p className="panel-kicker" style={{ color: 'var(--good, #1f7a57)' }}>Result ready</p>
              <h2>{firstResultJob.label}</h2>
            </div>
            <button
              type="button"
              className="icon-btn"
              aria-label="Dismiss"
              onClick={() => {
                localStorage.setItem(firstResultShownKey, '1');
                setFirstResultJob(null);
              }}
            >
              ✕
            </button>
          </div>
          <p className="first-result-summary">{firstResultJob.summary}</p>
          <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
            <button
              type="button"
              className="primary"
              onClick={() => {
                localStorage.setItem(firstResultShownKey, '1');
                setFirstResultJob(null);
                setActiveTab('pipeline');
              }}
            >
              View full result →
            </button>
            <button
              type="button"
              onClick={() => {
                localStorage.setItem(firstResultShownKey, '1');
                setFirstResultJob(null);
              }}
            >
              Dismiss
            </button>
          </div>
        </section>
      ) : null}
      {(() => {
        const detectedProvider = dashboard.availableLocalProviders[0];
        const localRuntimeRunning = dashboard.localRuntime.running && dashboard.localRuntime.loadedCount > 0;
        const alreadyAdopted =
          detectedProvider &&
          dashboard.platform.activeLocalProviderId === detectedProvider.id &&
          localRuntimeRunning;
        if (!detectedProvider || !localRuntimeRunning || alreadyAdopted || lmAdoptDismissed) return null;
        const count = dashboard.localRuntime.loadedCount;
        return (
          <section className="panel lm-adoption-banner" aria-label="Local model provider detected">
            <div className="panel-head" style={{ alignItems: 'flex-start' }}>
              <div>
                <p className="panel-kicker" style={{ color: 'var(--good, #1f7a57)' }}>Detected</p>
                <h2>Found {detectedProvider.label} with {count} model{count !== 1 ? 's' : ''} loaded</h2>
              </div>
              <button
                type="button"
                className="icon-btn"
                aria-label="Dismiss"
                onClick={() => setLmAdoptDismissed(true)}
              >
                ✕
              </button>
            </div>
            <p className="footnote">Your jobs can run entirely on your machine — no API key needed.</p>
            <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
              <button
                type="button"
                className="primary"
                disabled={lmAdopting}
                onClick={async () => {
                  setLmAdopting(true);
                  try {
                    await fetch(`/api/workers/${encodeURIComponent(detectedProvider.workerId)}`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      credentials: 'include',
                      body: JSON.stringify({ enabled: true }),
                    });
                    await fetch('/api/platform-settings', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      credentials: 'include',
                      body: JSON.stringify({ activeLocalProviderId: detectedProvider.id }),
                    });
                    await fetchDashboard(true);
                    setLmAdoptDismissed(true);
                  } catch (err) {
                    setError(toAppError(err));
                  } finally {
                    setLmAdopting(false);
                  }
                }}
              >
                {lmAdopting ? 'Connecting…' : `Use ${detectedProvider.label} →`}
              </button>
              <button type="button" onClick={() => setLmAdoptDismissed(true)}>Later</button>
            </div>
          </section>
        );
      })()}

      {demoNarration ? (
        <section className="panel demo-narration-panel" aria-live="polite" aria-label="Pipeline run progress">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">Running</p>
              <h2>{demoNarration.done ? 'Pipeline ran' : 'Running pipeline…'}</h2>
            </div>
          </div>
          <div className="demo-narration-stages">
            {demoNarration.stages.map((stage, i) => {
              const completed = demoNarration.done || i < demoNarration.currentIndex;
              const active = !demoNarration.done && i === demoNarration.currentIndex;
              return (
                <div
                  key={stage.label}
                  className={`demo-narration-stage${completed ? ' completed' : ''}${active ? ' active' : ''}`}
                >
                  <span className="stage-icon" aria-hidden>{completed ? '✓' : active ? '◷' : '○'}</span>
                  <div>
                    <strong>{stage.label}</strong>
                    {(completed || active) ? <span>{stage.detail}</span> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {demoRecap ? (
        <section className="panel demo-recap-panel">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">What just happened</p>
              <h2>{demoRecap.headline}</h2>
            </div>
            <button
              type="button"
              className="icon-btn"
              aria-label="Dismiss recap"
              onClick={() => setDemoRecap(null)}
            >
              ✕
            </button>
          </div>
          <p className="footnote">{demoRecap.body}</p>
          <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
            {demoRecap.ctaAction === 'wizard' ? (
              <button
                type="button"
                className="primary"
                onClick={() => { setDemoRecap(null); setWizardOpen(true); }}
              >
                {demoRecap.ctaText ?? 'Open setup wizard →'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => { setDemoRecap(null); setActiveTab('pipeline'); }}
            >
              View Pipeline →
            </button>
          </div>
        </section>
      ) : null}

      {starAsk ? (
        <section className="panel star-ask-banner" aria-label="Enjoying BFrost?">
          <p>
            Enjoying BFrost?{' '}
            <a
              href="https://github.com/ccascio/BFrost"
              target="_blank"
              rel="noreferrer"
              onClick={dismissStarAsk}
            >
              Star it on GitHub ⭐
            </a>{' '}
            — it&rsquo;s how other people find it.
          </p>
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={dismissStarAsk}>
            ✕
          </button>
        </section>
      ) : null}

      {!wizardCompleted ? (
        <section className="panel onboarding-hero">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">Setup</p>
              <h2>Configure BFrost with the setup wizard</h2>
            </div>
          </div>
          <p className="footnote">Connect a model provider, a notification channel, and enable your first worker — guided step by step.</p>
          <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
            <button type="button" className="primary" onClick={() => setWizardOpen(true)}>
              Open setup wizard →
            </button>
          </div>
        </section>
      ) : null}

      {(() => {
        const credentialProviders = dashboard.workers
          .filter((worker) => worker.kind === 'provider' && !localProviderWorkerIds.has(worker.id))
          .map((worker) => {
            const surface = worker.dashboard.settings.find((setting) =>
              setting.path &&
              setting.fields?.some((field) => field.type === 'secret-reference' && field.key === 'apiKey'),
            );
            const apiKeyField = surface?.fields?.find(
              (field): field is JobSecretReferenceField =>
                field.type === 'secret-reference' && field.key === 'apiKey',
            );
            return surface?.path && apiKeyField
              ? {
                  id: worker.id,
                  label: worker.displayName ?? worker.name,
                  fieldLabel: apiKeyField.label ?? `${worker.displayName ?? worker.name} API key`,
                  placeholder: apiKeyField.placeholder ?? '',
                  path: surface.path,
                }
              : null;
          })
          .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
        const selectedCredentialProvider =
          credentialProviders.find((provider) => provider.id === cloudConnectProvider) ??
          credentialProviders[0];

        // Show cloud quick-connect when no real model is configured and no local runtime is detected.
        const hasRealModel = dashboard.models.some((m) => m.provider !== 'demo');
        const localRuntimeRunning = dashboard.localRuntime.running;
        if (hasRealModel || localRuntimeRunning || !selectedCredentialProvider) return null;
        if (cloudTestReply) {
          return (
            <section className="panel cloud-connect-panel cloud-connect-success">
              <div className="panel-head">
                <div>
                  <p className="panel-kicker" style={{ color: 'var(--good, #1f7a57)' }}>Connected</p>
                  <h2>Provider ready</h2>
                </div>
                <button className="icon-btn" type="button" onClick={() => setCloudTestReply(null)}>✕</button>
              </div>
              <p className="footnote" style={{ fontStyle: 'italic', margin: '0.25rem 0 0.5rem' }}>
                &ldquo;{cloudTestReply}&rdquo;
              </p>
              <p className="footnote">Your model is responding. Run a recipe below to get your first real result.</p>
            </section>
          );
        }
        return (
          <section className="panel cloud-connect-panel">
            <div className="panel-head">
              <div>
                <p className="panel-kicker">Model provider</p>
                <h2>Paste an API key to get started</h2>
              </div>
            </div>
            <p className="footnote" style={{ marginBottom: '0.75rem' }}>
              No local model detected. Paste a cloud key to run real jobs in seconds.
            </p>
            <div className="cloud-connect-form">
              <div className="panel-actions" style={{ marginBottom: '0.5rem' }}>
                {credentialProviders.map((provider) => (
                  <button
                    key={provider.id}
                    type="button"
                    className={selectedCredentialProvider.id === provider.id ? 'primary' : ''}
                    onClick={() => setCloudConnectProvider(provider.id)}
                  >
                    {provider.label}
                  </button>
                ))}
              </div>
              <label className="field" style={{ maxWidth: '380px' }}>
                <span>{selectedCredentialProvider.fieldLabel}</span>
                <input
                  type="password"
                  value={cloudConnectKey}
                  placeholder={selectedCredentialProvider.placeholder}
                  onChange={(e) => setCloudConnectKey(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && cloudConnectKey.trim()) void connectCloud(); }}
                />
              </label>
              <div className="panel-actions" style={{ marginTop: '0.35rem' }}>
                <button
                  type="button"
                  className="primary"
                  disabled={!cloudConnectKey.trim() || cloudConnecting}
                  onClick={() => void connectCloud()}
                >
                  {cloudConnecting ? 'Connecting…' : 'Connect →'}
                </button>
              </div>
            </div>
          </section>
        );
        async function connectCloud() {
          setCloudConnecting(true);
          try {
            await fetch(selectedCredentialProvider.path, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ apiKey: cloudConnectKey.trim() }),
            });
            await fetchDashboard(true);
            const pingRes = await fetch('/api/provider-ping', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: '{}',
            });
            const pingData = (await pingRes.json()) as { ok?: boolean; response?: string; error?: string };
            setCloudTestReply(pingData.response ?? 'Provider connected successfully.');
            setCloudConnectKey('');
          } catch (err) {
            setError(toAppError(err));
          } finally {
            setCloudConnecting(false);
          }
        }
      })()}

      <OverviewRecipesPanel
        dashboard={dashboard}
        setDashboard={setDashboard}
        setError={setError}
        recipeApplied={recipeApplied}
        setRecipeApplied={setRecipeApplied}
        recipeExpanded={recipeExpanded}
        setRecipeExpanded={setRecipeExpanded}
        recipeInputValues={recipeInputValues}
        setRecipeInputValues={setRecipeInputValues}
        recipeApplying={recipeApplying}
        setRecipeApplying={setRecipeApplying}
      />
    </>
  );
}
