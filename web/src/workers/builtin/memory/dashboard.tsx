import { useEffect, useState } from 'react';
import type { WorkerDashboardViewDefinition } from '../../types';

const OPENAI_EMBEDDING_MODELS = [
  'text-embedding-3-large',
  'text-embedding-3-small',
  'text-embedding-ada-002',
];

interface PlatformSettings {
  embeddingProvider: string;
  embeddingModel: string;
}

interface HealthStatus {
  ok: boolean;
  detail: string;
}

function EmbeddingConfigPanel({ ctx }: { ctx: Record<string, any> }) {
  const platform = ctx.dashboard?.platform as PlatformSettings | undefined;
  const health = ctx.dashboard?.dependencies?.embeddingModelReachable as HealthStatus | undefined;
  const StatusPill = ctx.StatusPill as
    | ((props: { tone: string; children: React.ReactNode }) => React.ReactElement)
    | undefined;
  const HealthRow = ctx.HealthRow as
    | ((props: { label: string; status: HealthStatus }) => React.ReactElement)
    | undefined;

  const [providerDraft, setProviderDraft] = useState('');
  const [modelDraft, setModelDraft] = useState('');
  const [localModels, setLocalModels] = useState<Array<{ id: string; label: string }> | null>(null);
  const [loadingLocal, setLoadingLocal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);

  const providerValue = providerDraft || platform?.embeddingProvider || 'local';
  const modelValue = modelDraft || platform?.embeddingModel || '';

  const dirty =
    (providerDraft && providerDraft !== platform?.embeddingProvider) ||
    (modelDraft.trim() && modelDraft.trim() !== platform?.embeddingModel);

  async function fetchLocalModels() {
    if (loadingLocal) return;
    setLoadingLocal(true);
    try {
      const res = await fetch('/api/dashboard/local-embedding-models', { credentials: 'include' });
      if (res.ok) {
        const data = (await res.json()) as { models: Array<{ id: string; label: string }> };
        setLocalModels(data.models);
      }
    } catch {
      // leave previous list in place
    } finally {
      setLoadingLocal(false);
    }
  }

  useEffect(() => {
    if (providerValue === 'local') void fetchLocalModels();
  }, [providerValue]);

  async function save() {
    if (!dirty || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const body: Record<string, string> = {};
      if (providerDraft && providerDraft !== platform?.embeddingProvider) body.provider = providerDraft;
      if (modelDraft.trim() && modelDraft.trim() !== platform?.embeddingModel) body.model = modelDraft.trim();
      if (!body.provider && !body.model) return;
      const res = await fetch('/api/embedding-settings', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        setNotice({ ok: false, message: err.error ?? 'Failed to save embedding settings.' });
        return;
      }
      setProviderDraft('');
      setModelDraft('');
      setNotice({ ok: true, message: 'Embedding settings saved.' });
      ctx.refreshDashboard?.();
    } catch (err) {
      setNotice({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="detail-body">
      {HealthRow && health ? (
        <div className="stack-list compact">
          <HealthRow label="Embedding model reachable" status={health} />
        </div>
      ) : null}

      <p className="footnote" style={{ marginTop: '0.75rem' }}>
        Choose the provider and model for long-term memory embeddings. Local models are served
        by your active LM Studio or Ollama instance and must support the embeddings endpoint.
      </p>

      <div className="form-grid">
        <label className="field">
          <span>Embedding provider</span>
          <select
            value={providerValue}
            onChange={(event) => {
              const p = event.target.value;
              setProviderDraft(p);
              setModelDraft('');
              if (p === 'local') void fetchLocalModels();
            }}
          >
            <option value="local">Local (LM Studio / Ollama)</option>
            <option value="openai">OpenAI</option>
          </select>
        </label>

        <label className="field">
          <span>Embedding model</span>
          {providerValue === 'openai' ? (
            <select value={modelValue} onChange={(event) => setModelDraft(event.target.value)}>
              {OPENAI_EMBEDDING_MODELS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : (
            <>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <select
                  value={modelValue}
                  onChange={(event) => setModelDraft(event.target.value)}
                  disabled={loadingLocal}
                  style={{ flex: 1 }}
                >
                  {loadingLocal ? (
                    <option value="">Loading…</option>
                  ) : !localModels || localModels.length === 0 ? (
                    <option value={modelValue}>{modelValue || '(no embedding models found)'}</option>
                  ) : null}
                  {!loadingLocal &&
                    localModels?.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label !== m.id ? `${m.label} (${m.id})` : m.id}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  disabled={loadingLocal}
                  onClick={() => void fetchLocalModels()}
                  title="Refresh model list from local provider"
                >
                  {loadingLocal ? '…' : '↻'}
                </button>
              </div>
              <span className="footnote">
                {localModels && localModels.length > 0
                  ? `${localModels.length} embedding model${localModels.length === 1 ? '' : 's'} found. LM Studio: models with type "embedding"; Ollama: models with "embed" in the name.`
                  : localModels && localModels.length === 0
                    ? 'No embedding models found. Make sure your local provider is running and has an embedding model installed, then click ↻.'
                    : 'Click ↻ to load available models from your local provider.'}
              </span>
            </>
          )}
        </label>
      </div>

      <div className="panel-actions">
        <button
          className="primary"
          disabled={busy || !dirty}
          onClick={() => void save()}
        >
          {busy ? 'Saving…' : 'Save embedding settings'}
        </button>
        {notice ? (
          <span
            className="footnote"
            style={{ color: notice.ok ? 'var(--good)' : 'var(--warning)', alignSelf: 'center' }}
          >
            {notice.message}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export const dashboardView: WorkerDashboardViewDefinition = {
  workerId: 'core.memory',
  kind: 'embedding-config',
  surfaceIds: [],
  count: () => undefined,
  render: (ctx) => <EmbeddingConfigPanel ctx={ctx} />,
};
