import { useEffect, useState } from 'react';
import type { DashboardSnapshot, WorkerDashboardField, WorkerDashboardSurface, WorkerSummary } from './types';

export function StepModel({ dashboard, onRefresh }: { dashboard: DashboardSnapshot; onRefresh: () => Promise<void> }) {
  const credentialProviders = findCredentialProviders(dashboard.workers);
  const localRuntimeTabId = 'local-runtime';
  const firstProviderId = credentialProviders[0]?.worker.id ?? localRuntimeTabId;
  const [tab, setTab] = useState(firstProviderId);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runtimeRunning = dashboard.localRuntime?.running ?? false;
  const tabs = [...credentialProviders.map((provider) => provider.worker.id), localRuntimeTabId];

  useEffect(() => {
    if (!tabs.includes(tab)) setTab(tabs[0] ?? localRuntimeTabId);
  }, [tabs.join('\n'), tab]);

  async function saveKey(provider: CredentialProvider) {
    const draftKey = provider.worker.id;
    const key = drafts[draftKey] ?? '';
    if (!key.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(provider.surface.path!, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [provider.field.key]: key.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSaved(draftKey);
      setDrafts((current) => ({ ...current, [draftKey]: '' }));
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="wizard-step-body">
      <h2>Connect a model provider</h2>
      <p className="wizard-lead">BFrost needs at least one model to run workers. Choose how you want to connect.</p>

      <div className="wizard-tabs" role="tablist" aria-label="Model provider">
        {tabs.map((t) => {
          const provider = credentialProviders.find((item) => item.worker.id === t);
          const configured = provider ? isProviderConfigured(provider.worker) : runtimeRunning;
          const label = provider ? provider.worker.displayName ?? provider.worker.name : 'Local runtime';
          return (
          <button
            key={t}
            id={`wizard-tab-${t}`}
            role="tab"
            type="button"
            aria-selected={tab === t}
            aria-controls={`wizard-panel-${t}`}
            tabIndex={tab === t ? 0 : -1}
            className={`wizard-tab${tab === t ? ' active' : ''}`}
            onClick={() => setTab(t)}
            onKeyDown={(e) => {
              const idx = tabs.indexOf(t);
              if (e.key === 'ArrowRight') setTab(tabs[(idx + 1) % tabs.length]);
              if (e.key === 'ArrowLeft') setTab(tabs[(idx + tabs.length - 1) % tabs.length]);
            }}
          >
            {label}{configured ? ' ✓' : ''}
          </button>
        );
        })}
      </div>

      {credentialProviders.map((provider) => (
        <ProviderKeyPanel
          key={provider.worker.id}
          id={provider.worker.id}
          active={tab === provider.worker.id}
          configured={isProviderConfigured(provider.worker)}
          label={provider.worker.displayName ?? provider.worker.name}
          inputLabel={provider.field.label}
          description={provider.surface.description}
          placeholder={
            isProviderConfigured(provider.worker)
              ? 'Configured - enter a new secret to update'
              : provider.field.placeholder ?? ''
          }
          value={drafts[provider.worker.id] ?? ''}
          setValue={(value) => setDrafts((current) => ({ ...current, [provider.worker.id]: value }))}
          saving={saving}
          saved={saved === provider.worker.id}
          helpText={provider.field.helpText}
          onSave={() => void saveKey(provider)}
        />
      ))}

      <div
        id={`wizard-panel-${localRuntimeTabId}`}
        role="tabpanel"
        aria-labelledby={`wizard-tab-${localRuntimeTabId}`}
        hidden={tab !== localRuntimeTabId}
        className="wizard-tab-panel"
      >
        {runtimeRunning ? (
          <p className="wizard-status-ok">✓ Local runtime is running with {dashboard.localRuntime.loadedCount} model(s) loaded.</p>
        ) : (
          <>
            <p>No local AI runtime is detected. Start your configured local provider to run models fully locally.</p>
            <p className="wizard-footnote">Once it is running, load a model there, then come back.</p>
          </>
        )}
        {dashboard.localRuntime.loadedModels.length > 0 && (
          <ul className="wizard-bullets">
            {dashboard.localRuntime.loadedModels.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
      </div>

      {error ? <p className="wizard-error">{error}</p> : null}
    </div>
  );
}

interface CredentialProvider {
  worker: WorkerSummary;
  surface: WorkerDashboardSurface;
  field: SecretDashboardField;
}

type SecretDashboardField = WorkerDashboardField & {
  type: 'secret-reference';
  defaultValue: string;
  placeholder?: string;
  helpText?: string;
};

function findCredentialProviders(workers: WorkerSummary[]): CredentialProvider[] {
  return workers
    .filter((worker) => worker.kind === 'provider')
    .flatMap((worker) => {
      const settings = worker.dashboard?.settings ?? [];
      const credentialSurface = settings.find((surface) =>
        Boolean(surface.path) && (surface.fields ?? []).some((field) => field.type === 'secret-reference'),
      );
      const field = credentialSurface?.fields?.find((item): item is SecretDashboardField =>
        item.type === 'secret-reference',
      );
      return credentialSurface?.path && field ? [{ worker, surface: credentialSurface, field }] : [];
    });
}

function isProviderConfigured(worker: WorkerSummary): boolean {
  return worker.enabled && worker.healthState === 'healthy';
}

function ProviderKeyPanel({
  id,
  active,
  configured,
  label,
  inputLabel,
  description,
  placeholder,
  value,
  setValue,
  saving,
  saved,
  helpText,
  onSave,
}: {
  id: string;
  active: boolean;
  configured: boolean;
  label: string;
  inputLabel: string;
  description: string;
  placeholder: string;
  value: string;
  setValue: (value: string) => void;
  saving: boolean;
  saved: boolean;
  helpText?: string;
  onSave: () => void;
}) {
  return (
    <div
      id={`wizard-panel-${id}`}
      role="tabpanel"
      aria-labelledby={`wizard-tab-${id}`}
      hidden={!active}
      className="wizard-tab-panel"
    >
      {configured ? (
        <p className="wizard-status-ok">✓ {label} is configured.</p>
      ) : null}
      <p>{description}</p>
      <label className="wizard-field-label" htmlFor={`wizard-${id}-key`}>{inputLabel}</label>
      <div className="wizard-key-row">
        <input
          id={`wizard-${id}-key`}
          type="password"
          placeholder={placeholder}
          value={value}
          autoComplete="off"
          onChange={(e) => setValue(e.target.value)}
        />
        <button
          type="button"
          className="primary"
          disabled={saving || !value.trim()}
          onClick={onSave}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
      {saved ? <p className="wizard-status-ok">✓ Saved successfully.</p> : null}
      {helpText ? <p className="wizard-footnote">{helpText}</p> : null}
    </div>
  );
}

export function StepEmbedding({ dashboard, onRefresh }: { dashboard: DashboardSnapshot; onRefresh: () => Promise<void> }) {
  const platform = dashboard.platform;
  const reachable = dashboard.dependencies?.embeddingModelReachable?.ok ?? false;
  const embeddingProviders = findEmbeddingProviders(dashboard.workers);
  const [provider, setProvider] = useState(platform?.embeddingProvider ?? 'local');
  const [model, setModel] = useState(platform?.embeddingModel ?? '');
  const [localModels, setLocalModels] = useState<Array<{ id: string; label: string }>>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (provider !== 'local') return;
    let cancelled = false;
    fetch('/api/dashboard/local-embedding-models', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { models: [] }))
      .then((d: { models?: Array<{ id: string; label: string }> }) => {
        if (!cancelled) setLocalModels(d.models ?? []);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [provider]);

  async function save() {
    if (!model.trim()) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch('/api/embedding-settings', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model: model.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSaved(true);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="wizard-step-body">
      <h2>Long-term memory embeddings</h2>
      <p className="wizard-lead">
        Workers that remember things turn text into vectors with an embedding model. Pick where those
        embeddings come from - a local model keeps everything on your machine; a configured cloud provider can be faster to set up.
      </p>
      {reachable ? (
        <p className="wizard-status-ok">✓ Current embedding model is reachable ({platform?.embeddingProvider} · {platform?.embeddingModel}).</p>
      ) : null}

      <label className="wizard-field-label" htmlFor="wizard-embedding-provider">Provider</label>
      <select
        id="wizard-embedding-provider"
        value={provider}
        onChange={(e) => {
          setProvider(e.target.value);
          setModel('');
          setSaved(false);
        }}
      >
        <option value="local">Local runtime</option>
        {embeddingProviders.map((item) => (
          <option key={item.provider.id} value={item.provider.id}>
            {item.provider.label}
          </option>
        ))}
      </select>

      <label className="wizard-field-label" htmlFor="wizard-embedding-model">Model</label>
      {provider === 'local' ? (
        localModels.length > 0 ? (
          <select id="wizard-embedding-model" value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">Select a model...</option>
            {localModels.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        ) : (
          <>
            <input
              id="wizard-embedding-model"
              type="text"
              placeholder="e.g. nomic-embed-text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
            <p className="wizard-footnote">No local embedding models detected. Load one in your local runtime, or type its id.</p>
          </>
        )
      ) : (
        <>
          <input
            id="wizard-embedding-model"
            type="text"
            placeholder="Embedding model id"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
          <p className="wizard-footnote">Uses the selected provider's credential from the Model step. Requires embeddings support.</p>
        </>
      )}

      <div className="wizard-key-row" style={{ marginTop: '0.75rem' }}>
        <button type="button" className="primary" disabled={saving || !model.trim()} onClick={() => void save()}>
          {saving ? 'Saving...' : 'Save embedding model'}
        </button>
      </div>
      {saved ? <p className="wizard-status-ok">✓ Saved successfully.</p> : null}
      {error ? <p className="wizard-error">{error}</p> : null}
      <p className="wizard-footnote">Optional - skip to keep the default. You can change this later from the Config tab.</p>
    </div>
  );
}

function findEmbeddingProviders(workers: WorkerSummary[]) {
  return workers
    .filter((worker) => worker.enabled && worker.healthState === 'healthy')
    .flatMap((worker) =>
      (worker.providers ?? [])
        .filter((provider) => provider.capabilities.embeddings && !provider.capabilities.localRuntime)
        .map((provider) => ({ worker, provider })),
    );
}
