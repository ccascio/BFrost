import dotenv from 'dotenv';
dotenv.config();

export interface ModelOption {
  alias: string;
  id: string;
  label: string;
  provider: string;
}

export interface ProviderModelOption {
  alias?: string;
  id: string;
  label?: string;
}

export const availableModels: ModelOption[] = [];
const discoveredModelsByProvider = new Map<string, ProviderModelOption[]>();

function positiveNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  ollamaModel: process.env.OLLAMA_MODEL || '',
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1',
  allowedUserId: Number(process.env.ALLOWED_USER_ID || '0'),
  whisperModelPath: process.env.WHISPER_MODEL_PATH || './models/ggml-large-v3-turbo-q5_0.bin',
  googleApiKey: process.env.GOOGLE_API_KEY || '',
  googleSearchEngineId: process.env.GOOGLE_SEARCH_ENGINE_ID || '',
  modelFallbackAliases: (process.env.MODEL_FALLBACK_ALIASES || '')
    .split(',')
    .map((alias) => alias.trim())
    .filter(Boolean),
  embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-nomic-embed-text-v1.5',
  embeddingProvider: process.env.EMBEDDING_PROVIDER || 'local',
  memoryStorePath: process.env.MEMORY_STORE_PATH || './data/memory.json',
  conversationStorePath: process.env.CONVERSATION_STORE_PATH || './data/conversations.json',
  appDbPath: process.env.APP_DB_PATH || './data/bfrost.sqlite',
  itemBusStoreDir: process.env.BFROST_ITEM_BUS_DIR || './data/item-bus',
  xConsumerKey: process.env.X_CONSUMER_KEY || '',
  xConsumerSecret: process.env.X_CONSUMER_SECRET || '',
  xAccessToken: process.env.X_ACCESS_TOKEN || '',
  xAccessTokenSecret: process.env.X_ACCESS_TOKEN_SECRET || '',
  xUsername: process.env.X_USERNAME || '',
  adminHost: process.env.ADMIN_HOST || '127.0.0.1',
  adminPort: Number(process.env.ADMIN_PORT || '3030'),
  adminStoreDir: process.env.ADMIN_STORE_DIR || './data/admin',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  adminSessionTtlHours: Number(process.env.ADMIN_SESSION_TTL_HOURS || '24'),
  jobLlmTimeoutMs: positiveNumberEnv('JOB_LLM_TIMEOUT_MS', 600000),
  workerPaths: (process.env.BFROST_WORKER_PATHS || './workers/local,./workers')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
  localWorkerCodeEnabled: process.env.BFROST_ENABLE_LOCAL_WORKER_CODE === 'true',
  /**
   * Watch local worker source dirs and hot-reload an enabled worker when its backend source
   * changes — recompile and re-register without restarting BFrost. Only ever touches workers
   * that are already enabled, and is a no-op unless local worker code execution is enabled.
   * Defaults on; set BFROST_WORKER_HOT_RELOAD=false to disable.
   */
  workerHotReloadEnabled: process.env.BFROST_WORKER_HOT_RELOAD !== 'false',
  /**
   * ID of the active local-runtime provider worker. When more than
   * one local provider is installed, only this one is treated as the active local runtime.
   * Cloud providers coexist freely via per-model selection — this setting
   * is only consulted for local-runtime dispatch. Persisted in admin settings; this default
   * is overwritten at boot from the stored value.
   */
  activeLocalProviderId: '',
  /**
   * ID of the channel worker that receives operator notifications (e.g. cron-run outcomes).
   * Other channels can still be enabled and serve incoming user messages; only outbound
   * notifications are funneled through the primary. Persisted in admin settings.
   */
  primaryChannelId: '',
};

export function findModel(aliasOrId: string): ModelOption | undefined {
  const needle = aliasOrId.trim().toLowerCase();
  return availableModels.find(
    (m) => m.alias.toLowerCase() === needle || m.id.toLowerCase() === needle,
  );
}

export function replaceDiscoveredProviderModels(provider: string, models: ProviderModelOption[]): void {
  discoveredModelsByProvider.set(provider, dedupeProviderModels(models));
  rebuildAvailableModels();
}

export function clearDiscoveredProviderModels(provider: string): void {
  if (!discoveredModelsByProvider.delete(provider)) return;
  rebuildAvailableModels();
}

function rebuildAvailableModels(): void {
  const next: ModelOption[] = [];
  const usedAliases = new Set(next.map((model) => model.alias.toLowerCase()));
  const usedIds = new Set(next.map((model) => model.id.toLowerCase()));

  for (const [provider, models] of discoveredModelsByProvider) {
    for (const model of models) {
      const id = model.id.trim();
      if (!id || usedIds.has(id.toLowerCase())) continue;

      const alias = uniqueAlias(model.alias || id, usedAliases, provider);
      usedAliases.add(alias.toLowerCase());
      usedIds.add(id.toLowerCase());
      next.push({
        alias,
        id,
        label: model.label?.trim() || id,
        provider,
      });
    }
  }

  availableModels.splice(0, availableModels.length, ...next);
}

function dedupeProviderModels(models: ProviderModelOption[]): ProviderModelOption[] {
  const seen = new Set<string>();
  const result: ProviderModelOption[] = [];
  for (const model of models) {
    const id = model.id.trim();
    if (!id) continue;
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      alias: model.alias?.trim(),
      id,
      label: model.label?.trim(),
    });
  }
  return result;
}

function uniqueAlias(raw: string, usedAliases: Set<string>, provider: string): string {
  const base = slugAlias(raw) || `${provider}-model`;
  if (!usedAliases.has(base.toLowerCase())) return base;

  const providerBase = `${slugAlias(provider) || 'provider'}-${base}`;
  if (!usedAliases.has(providerBase.toLowerCase())) return providerBase;

  let suffix = 2;
  while (usedAliases.has(`${providerBase}-${suffix}`.toLowerCase())) {
    suffix += 1;
  }
  return `${providerBase}-${suffix}`;
}

function slugAlias(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function getDefaultModel(): ModelOption {
  const configured = config.ollamaModel ? findModel(config.ollamaModel) : undefined;
  return configured ?? availableModels[0] ?? {
    alias: 'unconfigured',
    id: config.ollamaModel || 'unconfigured',
    label: 'No configured model',
    provider: 'unconfigured',
  };
}

export function getDefaultModelAlias(): string {
  return getDefaultModel().alias;
}

export function setDefaultModel(aliasOrId: string): ModelOption {
  const model = findModel(aliasOrId);
  if (!model) {
    throw new Error(`Unknown model: ${aliasOrId}`);
  }
  config.ollamaModel = model.id;
  return model;
}

export function setGoogleCredentials(values: { googleApiKey?: string; googleSearchEngineId?: string }): void {
  if (values.googleApiKey !== undefined) config.googleApiKey = values.googleApiKey;
  if (values.googleSearchEngineId !== undefined) config.googleSearchEngineId = values.googleSearchEngineId;
}

export function setAllowedUserId(value: number): void {
  config.allowedUserId = value;
}

export function setActiveLocalProviderId(value: string): void {
  config.activeLocalProviderId = value;
}

export function setPrimaryChannelId(value: string): void {
  config.primaryChannelId = value;
}

export function setEmbeddingSettings(values: { provider?: string; model?: string }): void {
  if (values.provider !== undefined) config.embeddingProvider = values.provider;
  if (values.model !== undefined) config.embeddingModel = values.model;
}

export function setAdminPassword(value: string): void {
  config.adminPassword = value;
}

export function setLocalWorkerCodeEnabled(enabled: boolean): void {
  config.localWorkerCodeEnabled = enabled;
}

export function setAdminSessionTtlHours(hours: number): void {
  config.adminSessionTtlHours = hours;
}

export function setJobLlmTimeoutMs(ms: number): void {
  config.jobLlmTimeoutMs = ms;
}

export function setXCredentials(values: {
  xConsumerKey?: string;
  xConsumerSecret?: string;
  xAccessToken?: string;
  xAccessTokenSecret?: string;
  xUsername?: string;
}): void {
  if (values.xConsumerKey !== undefined) config.xConsumerKey = values.xConsumerKey;
  if (values.xConsumerSecret !== undefined) config.xConsumerSecret = values.xConsumerSecret;
  if (values.xAccessToken !== undefined) config.xAccessToken = values.xAccessToken;
  if (values.xAccessTokenSecret !== undefined) config.xAccessTokenSecret = values.xAccessTokenSecret;
  if (values.xUsername !== undefined) config.xUsername = values.xUsername;
}
