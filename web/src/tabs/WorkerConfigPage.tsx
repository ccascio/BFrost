import type { Dispatch, SetStateAction } from 'react';
import type {
  DashboardState,
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
  const connectView = dashboardViews.find(
    (view) => view.workerId === worker.id && view.kind === 'channel-connect' && view.surfaceIds.includes(surface.id),
  );
  if (connectView?.render) {
    return <>{connectView.render({ onSaved: () => void fetchDashboard(true) })}</>;
  }

  const key = configSurfaceKey(worker.id, surface.id);
  const fields = surface.fields ?? [];
  const draft = surfaceDrafts[key] ?? buildSurfaceDraft(surface, dashboard.workerData);
  const canPersist = Boolean(surface.path && !surface.path.includes('#'));
  const canSubmit = canPersist && surfaceDraftHasValue(fields, draft);

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

  return (
    <div className="detail-body">
      <div className="job-grid config-field-grid">
        {fields.map((field) =>
          <DashboardFieldEditor
            key={field.key}
            field={field}
            value={draft[field.key] ?? fieldDefaultDraftValue(field, dashboard.workerData)}
            onChange={(nextValue) => updateSurfaceDraftParam(field.key, nextValue)}
            customListItemDrafts={customListItemDrafts}
            setCustomListItemDrafts={setCustomListItemDrafts}
            draftKey={`${key}.${field.key}`}
          />,
        )}
      </div>

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
