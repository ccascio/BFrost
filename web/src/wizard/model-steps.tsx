import { useEffect, useState } from 'react';
import type { DashboardSnapshot, IntegrationStatus } from './types';

export function StepModel({ dashboard, onRefresh }: { dashboard: DashboardSnapshot; onRefresh: () => Promise<void> }) {
  const [tab, setTab] = useState<'local' | 'openai' | 'anthropic'>('openai');
  const [openaiKey, setOpenaiKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<'openai' | 'anthropic' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openaiOk = (dashboard.integrations['openai'] ?? dashboard.integrations['openaiConfigured'] as unknown as IntegrationStatus)?.ok ?? false;
  const anthropicOk = (dashboard.integrations['anthropic'] ?? dashboard.integrations['anthropicConfigured'] as unknown as IntegrationStatus)?.ok ?? false;
  const lmRunning = dashboard.lmStudio?.running ?? false;

  async function saveKey(provider: 'openai' | 'anthropic') {
    const key = provider === 'openai' ? openaiKey : anthropicKey;
    if (!key.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const endpoint = provider === 'openai'
        ? '/api/workers/providers-openai/credentials'
        : '/api/workers/providers-anthropic/credentials';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: key.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSaved(provider);
      if (provider === 'openai') setOpenaiKey('');
      else setAnthropicKey('');
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
        {(['openai', 'anthropic', 'local'] as const).map((t) => (
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
              const tabs = ['openai', 'anthropic', 'local'] as const;
              const idx = tabs.indexOf(t);
              if (e.key === 'ArrowRight') setTab(tabs[(idx + 1) % tabs.length]);
              if (e.key === 'ArrowLeft') setTab(tabs[(idx + tabs.length - 1) % tabs.length]);
            }}
          >
            {t === 'openai' ? 'OpenAI' : t === 'anthropic' ? 'Anthropic' : 'Local (LM Studio)'}
            {t === 'openai' && openaiOk ? ' ✓' : ''}
            {t === 'anthropic' && anthropicOk ? ' ✓' : ''}
            {t === 'local' && lmRunning ? ' ✓' : ''}
          </button>
        ))}
      </div>

      <ProviderKeyPanel
        id="openai"
        active={tab === 'openai'}
        configured={openaiOk}
        label="OpenAI"
        inputLabel="OpenAI API key"
        placeholder={openaiOk ? 'Configured - enter new key to update' : 'sk-...'}
        value={openaiKey}
        setValue={setOpenaiKey}
        saving={saving}
        saved={saved === 'openai'}
        docsUrl="https://platform.openai.com/api-keys"
        docsLabel="platform.openai.com/api-keys"
        onSave={() => void saveKey('openai')}
      />

      <ProviderKeyPanel
        id="anthropic"
        active={tab === 'anthropic'}
        configured={anthropicOk}
        label="Anthropic"
        inputLabel="Anthropic API key"
        placeholder={anthropicOk ? 'Configured - enter new key to update' : 'sk-ant-...'}
        value={anthropicKey}
        setValue={setAnthropicKey}
        saving={saving}
        saved={saved === 'anthropic'}
        docsUrl="https://console.anthropic.com/account/keys"
        docsLabel="console.anthropic.com"
        onSave={() => void saveKey('anthropic')}
      />

      <div
        id="wizard-panel-local"
        role="tabpanel"
        aria-labelledby="wizard-tab-local"
        hidden={tab !== 'local'}
        className="wizard-tab-panel"
      >
        {lmRunning ? (
          <p className="wizard-status-ok">✓ LM Studio is running with {dashboard.lmStudio.loadedCount} model(s) loaded.</p>
        ) : (
          <>
            <p>LM Studio is not detected. Download it to run AI models fully locally.</p>
            <a
              href="https://lmstudio.ai"
              target="_blank"
              rel="noreferrer"
              className="wizard-external-link"
            >
              Download LM Studio →
            </a>
            <p className="wizard-footnote">Once installed and running, load a model in LM Studio, then come back.</p>
          </>
        )}
        {dashboard.lmStudio.loadedModels.length > 0 && (
          <ul className="wizard-bullets">
            {dashboard.lmStudio.loadedModels.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
      </div>

      {error ? <p className="wizard-error">{error}</p> : null}
    </div>
  );
}

function ProviderKeyPanel({
  id,
  active,
  configured,
  label,
  inputLabel,
  placeholder,
  value,
  setValue,
  saving,
  saved,
  docsUrl,
  docsLabel,
  onSave,
}: {
  id: 'openai' | 'anthropic';
  active: boolean;
  configured: boolean;
  label: string;
  inputLabel: string;
  placeholder: string;
  value: string;
  setValue: (value: string) => void;
  saving: boolean;
  saved: boolean;
  docsUrl: string;
  docsLabel: string;
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
        <p className="wizard-status-ok">✓ {label} API is configured.</p>
      ) : null}
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
      <p className="wizard-footnote">Get your key at <a href={docsUrl} target="_blank" rel="noreferrer">{docsLabel}</a></p>
    </div>
  );
}

export function StepEmbedding({ dashboard, onRefresh }: { dashboard: DashboardSnapshot; onRefresh: () => Promise<void> }) {
  const platform = dashboard.platform;
  const reachable = dashboard.dependencies?.embeddingModelReachable?.ok ?? false;
  const [provider, setProvider] = useState<'local' | 'openai'>(
    platform?.embeddingProvider === 'openai' ? 'openai' : 'local',
  );
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
        embeddings come from - a local model keeps everything on your machine; OpenAI is faster to set up.
      </p>
      {reachable ? (
        <p className="wizard-status-ok">✓ Current embedding model is reachable ({platform?.embeddingProvider} · {platform?.embeddingModel}).</p>
      ) : null}

      <label className="wizard-field-label" htmlFor="wizard-embedding-provider">Provider</label>
      <select
        id="wizard-embedding-provider"
        value={provider}
        onChange={(e) => {
          setProvider(e.target.value as 'local' | 'openai');
          setModel('');
          setSaved(false);
        }}
      >
        <option value="local">Local (LM Studio / Ollama)</option>
        <option value="openai">OpenAI</option>
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
            <p className="wizard-footnote">No local embedding models detected. Load one in LM Studio / Ollama, or type its id.</p>
          </>
        )
      ) : (
        <>
          <input
            id="wizard-embedding-model"
            type="text"
            placeholder="e.g. text-embedding-3-small"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />
          <p className="wizard-footnote">Uses your OpenAI API key from the Model step. Requires the embeddings endpoint.</p>
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
