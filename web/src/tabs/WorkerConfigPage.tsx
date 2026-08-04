import { useState, type Dispatch, type SetStateAction } from 'react';
import type {
  DashboardState,
  JobDashboardField,
  JobParamDraftValue,
  SchedulerJobState,
  WorkerDashboardSurface,
  WorkerSummary,
} from '../app-types';
import {
  buildSurfaceDraft,
  configSurfaceKey,
  fieldDefaultDraftValue,
  surfaceDraftHasValue,
  workerHealthLabel,
  workerHealthTone,
  StatusPill,
} from '../app-helpers';
import type { WorkerDashboardViewDefinition } from '../workers/types';
import { DashboardFieldEditor } from './DashboardFieldEditor';

type SurfaceDrafts = Record<string, Record<string, JobParamDraftValue>>;
type SaveSurface = (worker: WorkerSummary, surface: WorkerDashboardSurface) => void | Promise<void>;
type SaveJobModel = (
  job: SchedulerJobState,
  modelAlias: string,
  reasoningLevel?: string,
) => void | Promise<void>;

interface WorkerConfigPageProps {
  worker: WorkerSummary;
  surfaces: WorkerDashboardSurface[];
  dashboard: DashboardState;
  dashboardViews: WorkerDashboardViewDefinition[];
  surfaceDrafts: SurfaceDrafts;
  setSurfaceDrafts: Dispatch<SetStateAction<SurfaceDrafts>>;
  customListItemDrafts: Record<string, string>;
  setCustomListItemDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  busyKey: string | null;
  fetchDashboard: (preserveDrafts: boolean) => Promise<void>;
  saveWorkerConfigurationSurface: SaveSurface;
  saveJobModel: SaveJobModel;
}

export function WorkerConfigPage({
  worker,
  surfaces,
  dashboard,
  dashboardViews,
  surfaceDrafts,
  setSurfaceDrafts,
  customListItemDrafts,
  setCustomListItemDrafts,
  busyKey,
  fetchDashboard,
  saveWorkerConfigurationSurface,
  saveJobModel,
}: WorkerConfigPageProps) {
  const scopeLabel = describeActiveConfigScope(dashboard);
  const workerJobs = dashboard.cron.jobs.filter((job) => job.workerId === worker.id);
  return (
    <section className="panel tab-page">
      <div className="panel-head">
        <div>
          <p className="panel-kicker">{worker.builtIn ? 'Built-in worker' : 'Local worker'}</p>
          <h2>{worker.displayName ?? worker.name} - Config</h2>
          <p className="footnote">Editing: {scopeLabel}</p>
        </div>
        <StatusPill tone={workerHealthTone(worker.healthState)}>
          {workerHealthLabel(worker.healthState)}
        </StatusPill>
      </div>

      {surfaces.length === 0 && workerJobs.length === 0 ? (
        <p className="empty-state">No configurable settings declared for this worker.</p>
      ) : null}

      {workerJobs.length > 0 ? (
        <WorkerJobModelsPanel
          jobs={workerJobs}
          models={dashboard.models}
          busyKey={busyKey}
          saveJobModel={saveJobModel}
        />
      ) : null}

      {surfaces.map((surface) => (
        <div key={surface.id} className="detail-panel config-detail-panel" style={{ marginTop: '1rem' }}>
          {surfaces.length > 1 ? (
            <div className="panel-head section-break">
              <div>
                <p className="panel-kicker">Worker setting</p>
                <h2>{surface.label}</h2>
                {surface.description ? <p className="footnote">{surface.description}</p> : null}
              </div>
            </div>
          ) : surface.description ? (
            <p className="footnote" style={{ padding: '0 1.5rem', marginBottom: '0.5rem' }}>{surface.description}</p>
          ) : null}
          <WorkerConfigurationSurface
            worker={worker}
            surface={surface}
            dashboard={dashboard}
            dashboardViews={dashboardViews}
            surfaceDrafts={surfaceDrafts}
            setSurfaceDrafts={setSurfaceDrafts}
            customListItemDrafts={customListItemDrafts}
            setCustomListItemDrafts={setCustomListItemDrafts}
            busyKey={busyKey}
            fetchDashboard={fetchDashboard}
            saveWorkerConfigurationSurface={saveWorkerConfigurationSurface}
          />
        </div>
      ))}
    </section>
  );
}

interface WorkerJobModelsPanelProps {
  jobs: SchedulerJobState[];
  models: DashboardState['models'];
  busyKey: string | null;
  saveJobModel: SaveJobModel;
}

// Generic per-job model override editor. Every job already carries a `modelAlias`
// setting resolved by the scheduler (empty = platform default); this panel surfaces
// it at the worker level so heavier-reasoning jobs can run a stronger model and
// routine scans a lighter one, without digging into the Jobs page. Models that
// declare vendor reasoning levels also get a reasoning listbox beside the model.
function WorkerJobModelsPanel({ jobs, models, busyKey, saveJobModel }: WorkerJobModelsPanelProps) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reasoningDrafts, setReasoningDrafts] = useState<Record<string, string>>({});

  function effectiveAliasFor(job: SchedulerJobState): string {
    return (drafts[job.name] ?? job.modelAlias) || job.effectiveModelAlias;
  }

  function reasoningLevelsFor(job: SchedulerJobState): string[] {
    const alias = effectiveAliasFor(job);
    return models.find((model) => model.alias === alias)?.reasoningLevels ?? [];
  }

  function reasoningValueFor(job: SchedulerJobState): string {
    const value = reasoningDrafts[job.name] ?? job.reasoningLevel;
    // A stored level the (possibly re-selected) model doesn't support renders as default.
    return reasoningLevelsFor(job).includes(value) ? value : '';
  }

  const changedJobs = jobs.filter(
    (job) =>
      (drafts[job.name] !== undefined && drafts[job.name] !== job.modelAlias) ||
      (reasoningDrafts[job.name] !== undefined && reasoningDrafts[job.name] !== job.reasoningLevel),
  );
  const saving = busyKey?.startsWith('job-model-') ?? false;

  return (
    <div className="detail-panel config-detail-panel" style={{ marginTop: '1rem' }}>
      <div className="panel-head section-break">
        <div>
          <p className="panel-kicker">Worker setting</p>
          <h2>Models</h2>
          <p className="footnote">
            Choose which model each job of this worker uses. Give reasoning-heavy jobs a smarter
            model and routine ones a lighter, cheaper model — or leave the default to follow the
            platform-wide choice. When a model supports reasoning levels, pick how hard it should
            think next to it (Default follows the platform-wide level).
          </p>
        </div>
      </div>
      <div className="detail-body">
        <div className="job-grid config-field-grid">
          {jobs.map((job) => {
            const value = drafts[job.name] ?? job.modelAlias;
            const usingDefault = value === '';
            const reasoningLevels = reasoningLevelsFor(job);
            const reasoningValue = reasoningValueFor(job);
            return (
              <label className="field" key={job.name}>
                <span>{job.label}</span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <select
                    style={{ flex: 2, minWidth: 0 }}
                    value={value}
                    onChange={(event) =>
                      setDrafts((current) => ({ ...current, [job.name]: event.target.value }))
                    }
                  >
                    <option value="">Use default model</option>
                    {models.map((model) => (
                      <option key={model.alias} value={model.alias}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                  {reasoningLevels.length > 0 ? (
                    <select
                      style={{ flex: 1, minWidth: 0 }}
                      value={reasoningValue}
                      aria-label={`${job.label} reasoning level`}
                      title="Reasoning level"
                      onChange={(event) =>
                        setReasoningDrafts((current) => ({
                          ...current,
                          [job.name]: event.target.value,
                        }))
                      }
                    >
                      <option value="">Default reasoning</option>
                      {reasoningLevels.map((level) => (
                        <option key={level} value={level}>
                          {level}
                        </option>
                      ))}
                    </select>
                  ) : null}
                </div>
                <span className="footnote">
                  {usingDefault
                    ? `Currently running on ${job.effectiveModelAlias || 'the platform default'}${
                        job.effectiveReasoningLevel ? ` at ${job.effectiveReasoningLevel} reasoning` : ''
                      }`
                    : job.description}
                </span>
              </label>
            );
          })}
        </div>

        <div className="panel-actions wrap">
          <button
            className="primary"
            disabled={saving || changedJobs.length === 0}
            onClick={async () => {
              for (const job of changedJobs) {
                await saveJobModel(
                  job,
                  drafts[job.name] ?? job.modelAlias,
                  reasoningDrafts[job.name] !== undefined ? reasoningValueFor(job) : undefined,
                );
              }
              setDrafts({});
              setReasoningDrafts({});
            }}
          >
            {saving ? 'Saving...' : 'Save models'}
          </button>
          {changedJobs.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setDrafts({});
                setReasoningDrafts({});
              }}
            >
              Discard changes
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface WorkerConfigurationSurfaceProps extends Omit<WorkerConfigPageProps, 'surfaces' | 'saveJobModel'> {
  surface: WorkerDashboardSurface;
}

function WorkerConfigurationSurface({
  worker,
  surface,
  dashboard,
  dashboardViews,
  surfaceDrafts,
  setSurfaceDrafts,
  customListItemDrafts,
  setCustomListItemDrafts,
  busyKey,
  fetchDashboard,
  saveWorkerConfigurationSurface,
}: WorkerConfigurationSurfaceProps) {
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const connectView = dashboardViews.find(
    (view) => view.workerId === worker.id && view.kind === 'channel-connect' && view.surfaceIds.includes(surface.id),
  );
  if (connectView?.render) {
    const activeScopeId = dashboard.scope?.activeScopeId ?? null;
    return (
      <>
        {connectView.render({
          onSaved: () => void fetchDashboard(true),
          dashboard,
          activeScopeId,
        })}
      </>
    );
  }

  const key = configSurfaceKey(worker.id, surface.id, dashboard.scope?.activeScopeId ?? null);
  const fields = surface.fields ?? [];
  const draft = surfaceDrafts[key] ?? buildSurfaceDraft(surface, dashboard.workerData, dashboard.cron.jobs);
  const canPersistSurface = Boolean(surface.path && !surface.path.includes('#'));
  const canPersistJobModels = fields.some((field) => field.type === 'model-alias' && field.targetJob);
  const canPersist = canPersistSurface || canPersistJobModels;
  const canSubmit = canPersist && surfaceDraftHasValue(fields, draft);
  const fieldGroups = surface.fieldGroups ?? [];
  const groupedFields = fieldGroups.length > 0
    ? fields.filter((field) => field.group && fieldGroups.some((group) => group.id === field.group))
    : [];
  const hasGroupedLayout = fieldGroups.length > 0 && groupedFields.length > 0;
  const selectedGroup = fieldGroups.find((group) => group.id === selectedGroupId) ?? fieldGroups[0] ?? null;
  const selectedGroupFields = selectedGroup
    ? fields.filter((field) => field.group === selectedGroup.id)
    : [];

  function updateSurfaceDraftParam(fieldKey: string, value: JobParamDraftValue) {
    setSurfaceDrafts((current) => ({
      ...current,
      [key]: {
        ...(current[key] ?? {}),
        [fieldKey]: value,
      },
    }));
  }

  if (fields.length === 0) {
    return (
      <div className="detail-body">
        <p className="empty-state">
          {worker.name} declares {surface.label}, but it does not expose manifest fields yet.
        </p>
      </div>
    );
  }

  function renderFieldEditors(visibleFields: typeof fields, className = 'job-grid config-field-grid') {
    return (
      <div className={className}>
        {visibleFields.filter((field) => isFieldVisible(field, draft)).map((field) => {
          const hydratedField = applyDynamicFieldSuggestions(worker, surface, field, dashboard.workerData);
          return (
            <DashboardFieldEditor
              key={field.key}
              field={hydratedField}
              value={draft[field.key] ?? fieldDefaultDraftValue(field, dashboard.workerData, dashboard.cron.jobs)}
              formValues={draft}
              onChange={(nextValue) => updateSurfaceDraftParam(field.key, nextValue)}
              customListItemDrafts={customListItemDrafts}
              setCustomListItemDrafts={setCustomListItemDrafts}
              modelOptions={dashboard.models}
              draftKey={`${key}.${field.key}`}
              onActionComplete={() => fetchDashboard(true)}
            />
          );
        })}
      </div>
    );
  }

  return (
    <div className="detail-body">
      {hasGroupedLayout ? (
        <div className="config-provider-layout">
          <div className="config-provider-list" role="listbox" aria-label={`${surface.label} providers`}>
            {fieldGroups.map((group) => {
              const selected = group.id === selectedGroup?.id;
              const providerFieldCount = fields.filter((field) => field.group === group.id).length;
              return (
                <button
                  key={group.id}
                  type="button"
                  className={`run-item run-button job-row-button${selected ? ' selected' : ''}`}
                  aria-selected={selected}
                  role="option"
                  onClick={() => setSelectedGroupId(group.id)}
                >
                  <div>
                    <strong>{group.label}</strong>
                    {group.description ? <span>{group.description}</span> : null}
                  </div>
                  <StatusPill tone="muted">{`${providerFieldCount} settings`}</StatusPill>
                </button>
              );
            })}
          </div>

          <section className="config-provider-detail" aria-live="polite">
            <div className="panel-head section-break">
              <div>
                <p className="panel-kicker">Provider</p>
                <h2>{selectedGroup?.label ?? surface.label}</h2>
                {selectedGroup?.description ? <p className="footnote">{selectedGroup.description}</p> : null}
              </div>
            </div>
            {selectedGroupFields.length > 0
              ? renderFieldEditors(selectedGroupFields, 'config-provider-field-stack')
              : <p className="empty-state">No settings declared for this provider.</p>}
          </section>
        </div>
      ) : renderFieldEditors(fields)}

      <div className="panel-actions wrap">
        <button
          className="primary"
          disabled={busyKey === `config-surface-${key}` || !canSubmit}
          onClick={() => void saveWorkerConfigurationSurface(worker, surface)}
        >
          {busyKey === `config-surface-${key}` ? 'Saving...' : 'Save configuration'}
        </button>
        {surfaceDrafts[key] !== undefined ? (
          <button
            type="button"
            onClick={() =>
              setSurfaceDrafts((current) => {
                const next = { ...current };
                delete next[key];
                return next;
              })
            }
          >
            Discard changes
          </button>
        ) : null}
        {!canPersist ? <span className="footnote">This manifest declares defaults, but no save endpoint.</span> : null}
      </div>
    </div>
  );
}

function describeActiveConfigScope(dashboard: DashboardState): string {
  const activeScopeId = dashboard.scope?.activeScopeId ?? null;
  if (activeScopeId === '__global__') return 'Global default';
  if (activeScopeId === null) return 'Global default';
  const providerWorkerId = dashboard.scope?.providerWorkerId;
  const providerData = providerWorkerId ? dashboard.workerData[providerWorkerId] : null;
  const scopes = providerData && typeof providerData === 'object'
    ? (providerData as Record<string, unknown>).scopes
    : null;
  if (Array.isArray(scopes)) {
    const match = scopes.find((scope) => (
      scope && typeof scope === 'object' && (scope as Record<string, unknown>).id === activeScopeId
    ));
    const label = match && typeof (match as Record<string, unknown>).label === 'string'
      ? String((match as Record<string, unknown>).label)
      : null;
    if (label) return label;
  }
  return activeScopeId;
}

function isFieldVisible(field: JobDashboardField, draft: Record<string, JobParamDraftValue>): boolean {
  const condition = field.visibleWhen;
  if (!condition) return true;
  return String(draft[condition.field] ?? '') === condition.equals;
}

function applyDynamicFieldSuggestions(
  worker: WorkerSummary,
  surface: WorkerDashboardSurface,
  field: JobDashboardField,
  workerData: DashboardState['workerData'],
): JobDashboardField {
  if (field.type === 'string-list') {
    const dynamicSuggestions = resolveDynamicFieldSuggestions(worker, surface, field, workerData);
    if (dynamicSuggestions.length === 0) return field;
    const merged = Array.from(new Set([...(field.suggestions ?? []), ...dynamicSuggestions]));
    return { ...field, suggestions: merged };
  }
  if (field.type === 'select' && field.dynamicOptions) {
    const dynamicOptions = resolveDynamicSelectOptions(worker, surface, field, workerData);
    if (dynamicOptions.length === 0) return field;
    return { ...field, options: dynamicOptions };
  }
  return field;
}

function resolveDynamicFieldSuggestions(
  worker: WorkerSummary,
  surface: WorkerDashboardSurface,
  field: JobDashboardField,
  workerData: DashboardState['workerData'],
): string[] {
  const slice = workerData[worker.id];
  if (!slice || typeof slice !== 'object') return [];

  const source = (slice as Record<string, unknown>).fieldSuggestions;
  if (!source || typeof source !== 'object') return [];

  const record = source as Record<string, unknown>;
  return normalizeSuggestionValues(record[field.key] ?? nestedSuggestionValue(record[surface.id], field.key));
}

function nestedSuggestionValue(value: unknown, fieldKey: string): unknown {
  if (!value || typeof value !== 'object') return undefined;
  return (value as Record<string, unknown>)[fieldKey];
}

function normalizeSuggestionValues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && typeof entry === 'object' && typeof (entry as { value?: unknown }).value === 'string') {
        return (entry as { value: string }).value;
      }
      return '';
    })
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function resolveDynamicSelectOptions(
  worker: WorkerSummary,
  surface: WorkerDashboardSurface,
  field: JobDashboardField,
  workerData: DashboardState['workerData'],
): Array<{ label: string; value: string }> {
  const slice = workerData[worker.id];
  if (!slice || typeof slice !== 'object') return [];
  const source = (slice as Record<string, unknown>).fieldSuggestions;
  if (!source || typeof source !== 'object') return [];
  const record = source as Record<string, unknown>;
  const raw = record[field.key] ?? nestedSuggestionValue(record[surface.id], field.key);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry) => entry && typeof entry === 'object' && typeof (entry as { value?: unknown }).value === 'string')
    .map((entry) => ({
      label: String((entry as { label?: unknown; value: string }).label ?? (entry as { value: string }).value),
      value: (entry as { value: string }).value,
    }));
}
