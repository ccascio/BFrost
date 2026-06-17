import type { Dispatch, SetStateAction } from 'react';
import type { DashboardState } from '../app-types';
import { StatusPill, providerLabel } from '../app-helpers';

interface OverviewModelPanelProps {
  dashboard: DashboardState;
  busyKey: string | null;
  selectedModelAlias: string;
  setSelectedModelAlias: Dispatch<SetStateAction<string>>;
  saveDefaultModel: (alias: string) => void;
}

export function OverviewModelPanel({
  dashboard,
  busyKey,
  selectedModelAlias,
  setSelectedModelAlias,
  saveDefaultModel,
}: OverviewModelPanelProps) {
  const providersInUse = Array.from(new Set(dashboard.models.map((model) => model.provider)));
  const currentModel =
    dashboard.models.find((model) => model.alias === selectedModelAlias) ?? dashboard.defaultModel;
  const selectedProvider = currentModel.provider;
  const modelsForProvider = dashboard.models.filter((model) => model.provider === selectedProvider);

  function changeProvider(nextProvider: string) {
    const firstForProvider = dashboard.models.find((model) => model.provider === nextProvider);
    if (firstForProvider) setSelectedModelAlias(firstForProvider.alias);
  }

  return (
    <article className="panel">
      <div className="panel-head">
        <div>
          <p className="panel-kicker">Default model</p>
          <h2>Assistant baseline</h2>
        </div>
        <StatusPill tone="info">{dashboard.defaultModel.label}</StatusPill>
      </div>

      <div className="form-grid">
        <label className="field">
          <span>Provider</span>
          <select
            value={selectedProvider}
            onChange={(event) => changeProvider(event.target.value)}
          >
            {providersInUse.map((provider) => (
              <option key={provider} value={provider}>
                {providerLabel(provider, dashboard.workers)}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Model</span>
          <select
            value={selectedModelAlias}
            onChange={(event) => setSelectedModelAlias(event.target.value)}
            disabled={modelsForProvider.length === 0}
          >
            {modelsForProvider.length === 0 ? (
              <option value="">(no models available for this provider)</option>
            ) : null}
            {modelsForProvider.map((model) => (
              <option key={model.alias} value={model.alias}>
                {model.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="footnote">
        Pick the provider first, then the model. Cloud provider lists are refreshed from the API
        when you save an API key; local lists come from your active runtime.
      </p>

      <div className="panel-actions">
        <button
          className="primary"
          disabled={busyKey === 'save-model'}
          onClick={() => saveDefaultModel(selectedModelAlias)}
        >
          {busyKey === 'save-model' ? 'Saving...' : 'Save default model'}
        </button>
      </div>
    </article>
  );
}
