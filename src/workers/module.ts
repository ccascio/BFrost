import type { AdminApiRoute } from '../admin-route';
import type { ProviderModelOption } from '../config';
import type { WorkerManifest } from './types';

/**
 * Context passed to `loadDashboardData`. Carries the platform's active scope id (see
 * `WorkerManifest.scopeProvider`) so workers can slice their dashboard data to the
 * currently-selected scope. Worker-agnostic: `activeScopeId` is an opaque string the
 * worker itself defined as a scope option, or `null` when nothing is selected.
 */
export interface WorkerDashboardContext {
  activeScopeId: string | null;
}

export interface BackendWorkerModule<TDashboardData = unknown> {
  manifest: WorkerManifest;
  apiRoutes?: AdminApiRoute[];
  loadDashboardData?: (context?: WorkerDashboardContext) => Promise<TDashboardData>;
  healthChecks?: WorkerHealthCheck[];
  channelAdapters?: ChannelAdapterFactory[];
  providerAdapters?: ProviderAdapterFactory[];
  /**
   * Optional lifecycle hooks. Core calls them in this order:
   *   - `onInstall(ctx)` — once, the first time the worker is added to BFrost.
   *   - `onMigrate(ctx)` — when the loaded manifest's `version` differs from the version
   *     last seen for this worker id. Runs before `onEnable` so workers can migrate
   *     owned KV / SQLite state before the assistant starts calling into them.
   *   - `onEnable(ctx)` — every time the worker transitions from disabled to enabled,
   *     including the first boot after install.
   *   - `onDisable(ctx)` — when the operator disables the worker or before uninstall.
   *   - `onUninstall(ctx)` — once, when the operator removes the worker.
   * Workers use these to migrate their owned storage, register watchers, etc. All optional.
   */
  lifecycle?: WorkerLifecycleHooks;
}

export type WorkerHealthCategory = 'integrations' | 'dependencies';

export interface WorkerHealthStatus {
  ok: boolean;
  detail: string;
  action?: WorkerHealthAction;
}

export interface WorkerHealthAction {
  label: string;
  method: 'POST';
  path: string;
  successMessage: string;
}

export interface WorkerHealthCheck {
  key: string;
  category: WorkerHealthCategory;
  label?: string;
  check(): WorkerHealthStatus | Promise<WorkerHealthStatus>;
}

export interface WorkerLifecycleContext {
  workerId: string;
  workerDir?: string;
}

export interface WorkerMigrationContext extends WorkerLifecycleContext {
  /** Version string the platform last saw for this worker id. `null` on first install. */
  fromVersion: string | null;
  /** Version on the manifest about to be enabled. */
  toVersion: string;
}

export interface WorkerLifecycleHooks {
  onInstall?: (ctx: WorkerLifecycleContext) => Promise<void>;
  onMigrate?: (ctx: WorkerMigrationContext) => Promise<void>;
  onEnable?: (ctx: WorkerLifecycleContext) => Promise<void>;
  onDisable?: (ctx: WorkerLifecycleContext) => Promise<void>;
  onUninstall?: (ctx: WorkerLifecycleContext) => Promise<void>;
}

export interface ProviderAdapterFactory {
  providerId: string;
  create(): ProviderAdapter;
}

export interface ChatModelOptions {
  /**
   * Reasoning-effort level to apply to this model handle. Only ever set when the model's
   * `reasoningLevels` metadata (declared by the provider worker) contains the value; the
   * adapter translates it to its vendor's wire format.
   */
  reasoningLevel?: string;
}

export interface NativeWebSearchOptions extends ChatModelOptions {
  searchContextSize?: 'low' | 'medium' | 'high';
  allowedDomains?: string[];
}

/**
 * A provider adapter handles model resolution and (optionally) the lifecycle of a local
 * model runtime. Cloud providers leave the lifecycle methods undefined; local runtimes
 * (e.g. LM Studio) implement them.
 *
 * The `getChatModel`-style call is intentionally typed loosely because the AI SDK's
 * LanguageModel type varies between providers and would force every caller into a
 * generic dance. Callers pass the model id and receive the SDK's LanguageModel.
 */
export interface ProviderAdapter {
  providerId: string;
  /** Returns true if the provider is ready to handle requests (e.g. credentials present). */
  isConfigured(): boolean;
  /** Resolve a chat model handle the AI SDK can use. */
  getChatModel(modelId: string, options?: ChatModelOptions): unknown;
  /**
   * For providers whose API can search the web itself (e.g. OpenAI, Anthropic), returns
   * the model handle plus AI SDK tool(s) to enable that for a single call. Providers with
   * no native web search (local runtimes, generic OpenAI-compatible endpoints) omit this
   * entirely — callers fall back to a worker-provided search tool instead.
   */
  getNativeWebSearch?(
    modelId: string,
    options?: NativeWebSearchOptions,
  ): { model: unknown; tools: Record<string, unknown> } | undefined;
  /** List provider models that can be selected by the operator. */
  listAvailableModels?(): Promise<ProviderModelOption[]>;
  /** List models that support the embeddings endpoint (type-filtered where the provider supports it). */
  listEmbeddingModels?(): Promise<ProviderModelOption[]>;
  /** Produce an embedding vector for providers that support embeddings. */
  embedText?(modelId: string, input: string): Promise<number[]>;
  // ---- Optional local-runtime lifecycle ----
  /** Returns true if the runtime had to be started by this call. */
  startRuntime?(): Promise<boolean>;
  stopRuntime?(): Promise<void>;
  getRuntimeStatus?(): Promise<boolean>;
  listLoadedModels?(): Promise<Array<{ modelKey?: string; identifier?: string }>>;
  loadModel?(modelKey: string): Promise<void>;
  unloadModel?(modelKey: string): Promise<void>;
  unloadAllModels?(): Promise<void>;
}

/**
 * A channel adapter takes responsibility for receiving inbound messages on its channel,
 * dispatching them through the shared assistant core, and delivering replies back to the
 * user. The worker owns the lifecycle (network connection, polling, etc.).
 */
export interface ChannelAdapterFactory {
  /** Must match a channel id declared on the worker manifest. */
  channelId: string;
  /** Constructed lazily by core during boot so unconfigured channels do not throw on import. */
  create(): ChannelAdapter;
}

export interface ChannelAdapter {
  channelId: string;
  /**
   * Whether the operator has configured this adapter (e.g. credentials present).
   * Adapters that return `false` are skipped at boot without producing an error.
   */
  isConfigured(): boolean | Promise<boolean>;
  start(): Promise<void>;
  stop(reason: string): Promise<void>;
  /**
   * Optional: deliver a proactive operator notification (e.g. a cron run summary or
   * failure alert) on this channel. Adapters that cannot push messages omit this.
   */
  notifyOperator?(text: string): Promise<void>;
}
