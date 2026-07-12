import { useState, type Dispatch, type SetStateAction } from 'react';
import type {
  DashboardState,
  JobDashboardField,
  JobParamDraftValue,
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
}: WorkerConfigPageProps) {
  return (
    <section className="panel tab-page">
      <div className="panel-head">
        <div>
          <p className="panel-kicker">{worker.builtIn ? 'Built-in worker' : 'Local worker'}</p>
          <h2>{worker.displayName ?? worker.name} - Config</h2>
        </div>
        <StatusPill tone={workerHealthTone(worker.healthState)}>
          {workerHealthLabel(worker.healthState)}
        </StatusPill>
      </div>

      {surfaces.length === 0 ? (
        <p className="empty-state">No configurable settings declared for this worker.</p>
      ) : null}

      {surfaces.map((surface) => (
        <div key={surface.id} className="detail-panel config-detail-panel" style={{ marginTop: '1rem' }}>
          <div className="panel-head section-break">
            <div>
              <p className="panel-kicker">Worker setting</p>
              <h2>{surface.label}</h2>
              {surface.description ? <p className="footnote">{surface.description}</p> : null}
            </div>
          </div>
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

interface WorkerConfigurationSurfaceProps extends Omit<WorkerConfigPageProps, 'surfaces'> {
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
    return <>{connectView.render({ onSaved: () => void fetchDashboard(true) })}</>;
  }

  const key = configSurfaceKey(worker.id, surface.id);
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
        {visibleFields.map((field) => {
          const fieldWithSuggestions = applyDynamicFieldSuggestions(worker, surface, field, dashboard.workerData);
          return (
            <DashboardFieldEditor
              key={field.key}
              field={fieldWithSuggestions}
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

function applyDynamicFieldSuggestions(
  worker: WorkerSummary,
  surface: WorkerDashboardSurface,
  field: JobDashboardField,
  workerData: DashboardState['workerData'],
): JobDashboardField {
  if (field.type !== 'string-list') return field;

  const dynamicSuggestions = resolveDynamicFieldSuggestions(worker, surface, field, workerData);
  if (dynamicSuggestions.length === 0) return field;

  const merged = Array.from(new Set([...(field.suggestions ?? []), ...dynamicSuggestions]));
  return { ...field, suggestions: merged };
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
