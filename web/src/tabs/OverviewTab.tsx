import type { Dispatch, ReactNode, SetStateAction } from 'react';
import type {
  AppError,
  DashboardState,
  DashboardTab,
  WorkerOnboardingAction,
} from '../app-types';
import {
  HelpTip,
  StatusPill,
  eventSeverityTone,
  formatDate,
  workerHealthLabel,
  workerHealthTone,
} from '../app-helpers';
import type { WorkerDashboardViewDefinition } from '../workers/types';
import { toAppError } from '../app-types';

type DemoNarration = {
  stages: Array<{ label: string; detail: string }>;
  currentIndex: number;
  done: boolean;
} | null;

type DemoRecap = {
  headline: string;
  body: string;
  ctaText?: string;
  ctaAction?: string;
} | null;

type FirstResultJob = { label: string; summary: string; jobName: string } | null;

interface OverviewTabProps {
  dashboard: DashboardState;
  busyKey: string | null;
  setBusyKey: Dispatch<SetStateAction<string | null>>;
  setError: Dispatch<SetStateAction<AppError | null>>;
  setDashboard: Dispatch<SetStateAction<DashboardState | null>>;
  setActiveTab: (tab: DashboardTab) => void;
  onboardingRan: boolean;
  runDemoAction: (action: WorkerOnboardingAction & { workerId: string }) => Promise<void>;
  fetchDashboard: (force?: boolean) => Promise<void>;
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
  openChatFromOverview: () => void;
  renderModelPanel: () => ReactNode;
  renderStuckDetectorBanner: () => ReactNode;
  dashboardViews: WorkerDashboardViewDefinition[];
  workerViewContext: unknown;
  setNotice: Dispatch<SetStateAction<string>>;
}

export function OverviewTab(props: OverviewTabProps) {
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
    openChatFromOverview,
    renderModelPanel,
    renderStuckDetectorBanner,
    dashboardViews,
    workerViewContext,
    setNotice,
  } = props;
  const localProviderWorkerIds = new Set(dashboard.availableLocalProviders.map((provider) => provider.workerId));

  return (
    <section className="tab-page">
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
        const localRuntimeRunning = dashboard.lmStudio.running && dashboard.lmStudio.loadedCount > 0;
        const alreadyAdopted =
          detectedProvider &&
          dashboard.platform.activeLocalProviderId === detectedProvider.id &&
          localRuntimeRunning;
        if (!detectedProvider || !localRuntimeRunning || alreadyAdopted || lmAdoptDismissed) return null;
        const count = dashboard.lmStudio.loadedCount;
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
              const completed = demoNarration!.done || i < demoNarration!.currentIndex;
              const active = !demoNarration!.done && i === demoNarration!.currentIndex;
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
            return surface?.path
              ? {
                  id: worker.id,
                  label: worker.displayName ?? worker.name,
                  fieldLabel:
                    surface.fields?.find((field) => field.type === 'secret-reference' && field.key === 'apiKey')?.label ??
                    `${worker.displayName ?? worker.name} API key`,
                  placeholder:
                    surface.fields?.find((field) => field.type === 'secret-reference' && field.key === 'apiKey')?.placeholder ??
                    '',
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
        const localRuntimeRunning = dashboard.lmStudio.running;
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

      {(() => {
        const recipes = dashboard?.recipes ?? [];
        if (recipes.length === 0) return null;
        return (
          <section className="panel recipes-panel" aria-label="One-click recipes">
            <div className="panel-head">
              <div>
                <p className="panel-kicker">Recipes</p>
                <h2>One-click outcomes</h2>
              </div>
            </div>
            <p className="footnote" style={{ marginBottom: '1rem' }}>
              Pick a recipe to wire up a real workflow. You only fill in what's missing.
            </p>
            <div className="recipes-grid">
              {recipes.map((recipe) => {
                const isActive = recipe.steps.every((s) =>
                  dashboard?.workers.find((w) => w.id === s.workerId)?.enabled,
                ) || recipeApplied.has(recipe.id);
                const isExpanded = recipeExpanded === recipe.id;
                const hasInputs = (recipe.requiredInputs?.length ?? 0) > 0;
                return (
                  <div
                    key={recipe.id}
                    className={`recipe-card${isActive ? ' recipe-active' : ''}${isExpanded ? ' recipe-expanded' : ''}`}
                  >
                    <div className="recipe-card-header">
                      <div className="recipe-card-title">
                        <strong>{recipe.label}</strong>
                        {isActive ? (
                          <span className="recipe-badge recipe-badge-active">Active</span>
                        ) : (
                          <span className="recipe-badge">{recipe.steps.length} worker{recipe.steps.length !== 1 ? 's' : ''}</span>
                        )}
                      </div>
                      <p className="recipe-card-desc">{recipe.description}</p>
                    </div>
                    {!isActive && (
                      <div className="recipe-card-actions">
                        {!isExpanded ? (
                          <button
                            type="button"
                            className="primary"
                            onClick={() => {
                              setRecipeExpanded(recipe.id);
                              setRecipeInputValues({});
                            }}
                          >
                            {hasInputs ? 'Set up →' : 'Enable →'}
                          </button>
                        ) : (
                          <div className="recipe-form">
                            {recipe.requiredInputs?.map((input) => (
                              <label key={input.key} className="field recipe-field">
                                <span>{input.label}</span>
                                <input
                                  type={input.inputType === 'password' ? 'password' : 'text'}
                                  value={recipeInputValues[input.key] ?? ''}
                                  placeholder={input.helpText ?? ''}
                                  onChange={(e) =>
                                    setRecipeInputValues((prev) => ({ ...prev, [input.key]: e.target.value }))
                                  }
                                />
                                {input.helpText ? (
                                  <small className="footnote">{input.helpText}</small>
                                ) : null}
                              </label>
                            ))}
                            <div className="panel-actions">
                              <button
                                type="button"
                                className="primary"
                                disabled={recipeApplying}
                                onClick={async () => {
                                  setRecipeApplying(true);
                                  try {
                                    const res = await fetch('/api/recipes/apply', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      credentials: 'include',
                                      body: JSON.stringify({ recipeId: recipe.id, inputs: recipeInputValues }),
                                    });
                                    const data = (await res.json()) as {
                                      ok?: boolean;
                                      applied?: boolean;
                                      missing?: string[];
                                      dashboard?: DashboardState;
                                    };
                                    if (data.dashboard) {
                                      setDashboard(data.dashboard);
                                    }
                                    if (data.applied) {
                                      setRecipeApplied((prev) => new Set([...prev, recipe.id]));
                                      setRecipeExpanded(null);
                                    }
                                  } catch (err) {
                                    setError(toAppError(err));
                                  } finally {
                                    setRecipeApplying(false);
                                  }
                                }}
                              >
                                {recipeApplying ? 'Applying…' : 'Apply recipe'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setRecipeExpanded(null)}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })()}

      <section className="overview-chat-panel" aria-label="Dashboard chat quick entry">
        <p className="panel-kicker">Assistant</p>
        <label className="overview-chat-launcher">
          <span>Ask BFrost</span>
          <input
            type="text"
            readOnly
            value=""
            placeholder="Ask about workers, schedules, queue items, or models"
            onFocus={openChatFromOverview}
            onClick={openChatFromOverview}
          />
        </label>
      </section>
      <section className="grid top-grid">
        {renderModelPanel()}
        {(() => {
          // Render the active local provider's runtime panel from its worker bundle.
          const localProvider = dashboard.availableLocalProviders.find(
            (provider) => provider.id === dashboard.platform.activeLocalProviderId,
          );
          const localProviderWorker = localProvider
            ? dashboard.workers.find((worker) => worker.id === localProvider.workerId)
            : undefined;
          const localProviderView = localProvider
            ? dashboardViews.find((view) => view.workerId === localProvider.workerId)
            : undefined;
          if (!localProviderView?.render || !localProviderWorker?.enabled) return null;
          return localProviderView.render(workerViewContext as Parameters<NonNullable<typeof localProviderView.render>>[0]);
        })()}
      </section>

      <section className="grid overview-grid">
        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">Capabilities</p>
              <h2>Active workers <HelpTip>Workers that are healthy and ready to run. Workers missing credentials won't appear here — configure them in the Workers tab, then they'll show up once healthy.</HelpTip></h2>
            </div>
            <StatusPill tone={dashboard.workers.some((w) => w.healthState === 'healthy') ? 'good' : 'muted'}>
              {`${dashboard.workers.filter((w) => w.healthState === 'healthy').length} healthy`}
            </StatusPill>
          </div>
          <div className="stack-list compact">
            {dashboard.workers
              .filter((w) => w.enabled && (w.healthState === 'healthy' || w.runningJobCount > 0))
              .map((worker) => (
                <div className="summary-row" key={`${worker.id}-overview`}>
                  <div>
                    <strong>{worker.displayName ?? worker.name}</strong>
                    <span>{worker.tagline ?? worker.description}</span>
                    <span>{worker.builtIn ? 'built-in' : 'local'} · {worker.jobCount} jobs</span>
                  </div>
                  <StatusPill tone={workerHealthTone(worker.healthState)}>
                    {worker.runningJobCount > 0 ? 'running' : workerHealthLabel(worker.healthState)}
                  </StatusPill>
                </div>
              ))}
            {dashboard.workers.filter((w) => w.enabled && (w.healthState === 'healthy' || w.runningJobCount > 0)).length === 0 ? (
              <div className="empty-state">
                <p>No workers are active yet.</p>
                <p className="footnote">
                  Run the demo above to see the pipeline in action, or open Workers to enable and configure your first worker.
                </p>
                <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
                  <button type="button" onClick={() => setActiveTab('workers')}>
                    Open Workers
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">Activity</p>
              <h2>Recent events <HelpTip>A live log of everything BFrost has done — fetched news, ran a job, published a post, recorded an error. Events are stored locally; nothing is sent to any server.</HelpTip></h2>
            </div>
            <StatusPill tone="muted">{`${dashboard.events.length} stored`}</StatusPill>
          </div>
          <div className="stack-list compact">
            {dashboard.events.slice(0, 8).map((event) => (
              <div className="summary-row" key={`${event.id}-overview`}>
                <div>
                  <strong>{event.summary}</strong>
                  <span>{event.category} · {event.action}</span>
                  <span>{formatDate(event.createdAt)}</span>
                </div>
                <StatusPill tone={eventSeverityTone(event.severity)}>{event.severity}</StatusPill>
              </div>
            ))}
            {dashboard.events.length === 0 ? (
              <div className="empty-state">
                <p>Nothing has happened here yet.</p>
                <p className="footnote">
                  Events show up when a worker runs, finishes, or changes state. Enable a worker
                  to start collecting activity, or open Chat to ask the assistant a question.
                </p>
                <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
                  <button type="button" onClick={() => setActiveTab('workers')}>
                    Open Workers
                  </button>
                  <button type="button" onClick={() => setActiveTab('chat')}>
                    Open Chat
                  </button>
                  <button
                    type="button"
                    disabled={busyKey === 'seed-sample-data'}
                    onClick={() => void (async () => {
                      setBusyKey('seed-sample-data');
                      try {
                        await fetch('/api/admin/seed-sample-data', { method: 'POST', credentials: 'include' });
                        await fetchDashboard(true);
                        setNotice('Sample data loaded — browse the Jobs tab to see queued items.');
                      } finally { setBusyKey(null); }
                    })()}
                  >
                    {busyKey === 'seed-sample-data' ? 'Loading…' : 'Load sample data'}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </article>
      </section>
    </section>
  );
}
