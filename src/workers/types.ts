import type { z } from 'zod';

/**
 * Primary role a worker plays in the platform. Determines how it is grouped in the UI and
 * whether it participates in platform-level "active runtime" selection.
 *
 * - `feature`: standard job/tool worker (news, x-publisher, research, ...). Default when omitted.
 * - `channel`: provides at least one communication channel adapter (telegram, future whatsapp).
 *   The platform picks one as the primary recipient for operator notifications.
 * - `provider`: provides at least one LLM platform (lmstudio, future ollama). The platform
 *   picks one as the active local runtime; cloud providers (openai, anthropic) coexist freely.
 */
export type WorkerKind = 'feature' | 'channel' | 'provider';

export interface WorkerManifest {
  manifestVersion?: number;
  bfrostApiVersion?: string;
  /**
   * Semver range expressing the minimum BFrost engine version this worker
   * requires. Used by the store's compatibility badge and the host's install
   * guard. Example: `">=0.2.0"`. When absent, any version is assumed compatible.
   */
  bfrostEngineRange?: string;
  id: string;
  name: string;
  /**
   * Optional plain-language display name shown in user-facing dashboard surfaces
   * (Overview, Workers tab, future catalog). Falls back to `name` when absent.
   * Use this to make a worker readable to non-developers — e.g. "Daily News Digest"
   * instead of "News". `name` stays as the short technical label used in logs.
   */
  displayName?: string;
  version: string;
  description: string;
  /**
   * Optional one-sentence pitch shown in user-facing dashboard surfaces. Falls back
   * to `description` when absent. Write for a non-developer reader: explain what the
   * worker does for them, not how it works internally.
   */
  tagline?: string;
  /**
   * Natural-language requests this worker contributes to dashboard chat's welcome screen.
   * The core UI treats these as opaque examples: clicking one fills the chat composer,
   * and the assistant/tool registry decides how to handle the request.
   */
  chatPrompts?: WorkerChatPromptExample[];
  /**
   * Optional first-run call-to-action the worker contributes to the onboarding surfaces
   * (the setup wizard's welcome step, the overview empty state). The core renders whatever
   * actions the registry exposes without knowing any worker by name — removing the worker
   * removes its CTA. Use this for a zero-config "try me now" moment that runs one of the
   * worker's own jobs and shows the result inline.
   */
  onboarding?: WorkerOnboardingAction;
  /**
   * Optional persistent banner shown at the top of the dashboard while this worker is
   * enabled. Worker-agnostic: the core renders whatever enabled workers expose, naming none —
   * disabling or deleting the worker removes its banner. Use it for "you're in a special mode"
   * notices, e.g. a demo worker telling the operator how to turn the demo off.
   */
  demoNotice?: string;
  owner?: string;
  builtIn: boolean;
  /**
   * When `true`, this built-in worker can be "soft-deleted" by the operator and later
   * restored from the community store. Infrastructure workers (channels, providers, core
   * tools) leave this unset (falsy) and cannot be deleted.
   */
  deletable?: boolean;
  kind?: WorkerKind;
  /**
   * Which sidebar section this worker belongs to. Defaults to `'workers'` when unset.
   * Set to `'system'` for platform-infrastructure workers (shell, ops digest, etc.) that
   * should appear in a distinct "System" group rather than the main "Workers" group.
   */
  section?: 'workers' | 'system';
  /**
   * When true, this worker's config surface is surfaced inside the Settings modal
   * (Config tab) rather than as a standalone sidebar entry. Has no effect on workers
   * that also declare a dashboard view tab (those keep their sidebar slot).
   */
  settingsOnly?: boolean;
  backendEntrypoint?: string;
  requiredCredentials?: WorkerHealthRequirement[];
  optionalCredentials?: WorkerHealthRequirement[];
  requiredDependencies?: WorkerHealthRequirement[];
  optionalDependencies?: WorkerHealthRequirement[];
  ownedSettings?: WorkerOwnedSetting[];
  dashboard?: WorkerDashboardManifest;
  jobs: WorkerJobManifest[];
  channels?: WorkerChannelManifest[];
  tools?: WorkerToolManifest[];
  providers?: WorkerProviderManifest[];
  /**
   * Optional permission scopes for the action runtime (Workstream 5).
   *
   * Declares which file paths and shell commands this worker is allowed to access via the
   * `requestFileRead`, `requestFileWrite`, and `requestShell` primitives. When absent the
   * worker is unrestricted (backward-compatible default). When present, only the listed
   * scopes are permitted; an empty array means the worker cannot touch any guarded resource.
   *
   * Scope syntax:
   *   `file:read:<path-prefix>`   — allow reading files whose absolute path starts with prefix
   *   `file:read:*`               — allow reading any file
   *   `file:write:<path-prefix>`  — allow writing files whose absolute path starts with prefix
   *   `file:write:*`              — allow writing any file
   *   `shell:<command-name>`      — allow running a specific command via requestShell
   *   `shell:*`                   — allow running any command
   *
   * Example: `["file:read:/home/user/docs", "file:write:/tmp/bfrost-output", "shell:ffmpeg"]`
   */
  permissions?: string[];
  /**
   * Optional per-item summarizer for the assistant. When a worker produces Item Bus items
   * it may implement this to give the assistant a richer, friendlier description than the
   * generic `shortDesc + url` output. Receives a raw queue item and returns a one-line
   * plain-English summary (e.g. "Tech article: 'AI benchmark released' — 3 min read").
   *
   * The `core.items.query` tool calls this when available so "what's in my queue?" gives
   * titled, readable results instead of raw field dumps.
   */
  summarizeForAssistant?: (item: Record<string, unknown>) => string;
  /**
   * Optional library of one-click outcome presets. A recipe wires this and other workers
   * into a named workflow and declares exactly what the user must provide before it can run.
   * Core collects all recipes via the registry and applies them generically — no worker IDs
   * appear in core code, only in the manifest where they are declared.
   */
  /**
   * Optional sample items published by `/api/admin/seed-sample-data` on first boot.
   * Core iterates all workers' sample items generically — no worker ids appear in core code.
   */
  sampleItems?: WorkerSampleItem[];
  recipes?: WorkerRecipe[];
}

export interface WorkerSampleItem {
  itemType: string;
  title: string;
  shortDesc: string;
  url: string;
  tags?: string[];
  state?: string;
}

/** How a recipe input's value is persisted when the recipe is applied. */
export type RecipeInputStorage =
  | {
      /** Merge into a JSON object stored under a per-worker KV key. */
      type: 'worker-kv';
      workerId: string;
      kvKey: string;
      kvField: string;
    }
  | {
      /** Push a string value onto a string array in the global KV store. */
      type: 'global-kv-array';
      kvKey: string;
      arrayField: string;
    };

/** A single field the user must fill before a recipe can be applied. */
export interface WorkerRecipeInput {
  /** Stable key used in the apply payload (e.g. `"botToken"`). */
  key: string;
  /** Human-readable label shown in the UI (e.g. `"Telegram Bot Token"`). */
  label: string;
  /** One-line hint shown beneath the input (e.g. `"From @BotFather on Telegram"`). */
  helpText?: string;
  /** `'password'` renders the input as masked. Defaults to `'text'`. */
  inputType?: 'text' | 'password';
  /** Where the collected value is persisted when the recipe is applied. */
  storage: RecipeInputStorage;
}

/** One worker this recipe enables as part of the outcome pipeline. */
export interface WorkerRecipeStep {
  workerId: string;
}

/** A one-click outcome preset declared by a worker in its manifest. */
export interface WorkerRecipe {
  /** Stable, URL-safe id unique across all recipes (e.g. `"morning-digest-telegram"`). */
  id: string;
  /** Short display name shown on the recipe card (e.g. `"Morning digest on Telegram"`). */
  label: string;
  /** One-sentence description of the outcome, written for a non-developer reader. */
  description: string;
  /** Workers this recipe will enable, in pipeline order. */
  steps: WorkerRecipeStep[];
  /** Inputs the user must supply before the recipe can be applied. */
  requiredInputs?: WorkerRecipeInput[];
  /** Platform-level settings to configure when applying the recipe. */
  platformSettings?: {
    /** Channel worker ID to designate as the primary operator notification channel. */
    primaryChannelId?: string;
  };
}

export interface WorkerChatPromptExample {
  label: string;
  description: string;
  prompt: string;
}

/**
 * A first-run call-to-action a worker contributes to the platform's onboarding surfaces.
 * Worker-agnostic by design: the core reads these off the registry and renders them, so a
 * worker can offer a "run me now" moment without the core referencing it.
 *
 * Activation calls one of two targets the surface POSTs to and then shows the result inline:
 *   - `endpoint` — a worker-owned API route (`apiRoutes`) that does the work directly and
 *     returns an optional `{ summary }`. This is the zero-config path: it bypasses the job
 *     runner entirely, so it needs no configured model provider.
 *   - `runJob` — the name of a scheduled job to trigger via `POST /api/cron-jobs/:name`.
 *     Goes through the model-failover runner, so it requires a configured provider.
 * Prefer `endpoint` for a true no-setup demo; use `runJob` to showcase a real scheduled job.
 */
export interface WorkerOnboardingAction {
  /** Stable id, unique within the worker. */
  id: string;
  /** Button/headline text, e.g. "▶ Try the live demo — no setup". */
  title: string;
  /** One-line explanation shown beneath the title. */
  description: string;
  /** Worker-owned POST API route to call; may return `{ summary }`. Bypasses the job runner. */
  endpoint?: string;
  /** Name of a job belonging to this worker to trigger when the CTA is activated. */
  runJob?: string;
  /** Lower sorts first across all workers' actions. Defaults to 100 when unset. */
  priority?: number;
}

/**
 * Declares a model provider (chat / embeddings / vision) the worker owns. Concrete
 * adapters live in the worker's backend module. A provider may also expose a local
 * runtime lifecycle (e.g. LM Studio's server start/stop) — see ProviderAdapter.
 */
export interface WorkerProviderManifest {
  id: string;
  workerId: string;
  label: string;
  description: string;
  capabilities: WorkerProviderCapabilities;
  defaultModels?: WorkerProviderDefaultModel[];
}

export interface WorkerProviderDefaultModel {
  alias?: string;
  id: string;
  label?: string;
}

export interface WorkerProviderCapabilities {
  chat: boolean;
  embeddings: boolean;
  vision: boolean;
  /** True if the provider runs a local process that needs lifecycle management. */
  localRuntime: boolean;
}

/**
 * Declares an LLM-callable tool the worker exposes to the assistant agent.
 *
 * Tools are invoked synchronously, per conversation turn, by the assistant. They are
 * NOT the way workers talk to each other (that's the Item Bus for async work and the
 * dedicated services contract — when introduced — for sync function calls). Keep the
 * tool catalog curated: only expose what the model should call directly.
 */
export interface WorkerToolManifest {
  id: string;
  workerId: string;
  /** Camel-cased, used as the function name presented to the model (e.g. `webSearch`). */
  name: string;
  description: string;
  /** JSON Schema or Zod schema describing the tool's input. */
  inputSchema: unknown;
  /** Optional permission scopes; the runtime gates execution on these when W5 lands. */
  permissions?: string[];
  /** True when the tool is enabled by default for agents that don't opt-in explicitly. */
  defaultEnabled?: boolean;
  /** Executes the tool. Receives validated input and returns a string for the model. */
  execute: (input: any) => Promise<string>;
}

/**
 * Declares an assistant channel the worker provides (e.g. a Telegram bot, a Discord adapter,
 * the local dashboard chat). The actual adapter lifecycle is provided by the worker's backend
 * module (see `BackendWorkerModule.channelAdapters`).
 */
export interface WorkerChannelManifest {
  id: string;
  workerId: string;
  label: string;
  description: string;
  capabilities: WorkerChannelCapabilities;
}

export interface WorkerChannelCapabilities {
  text: boolean;
  image: boolean;
  audio: boolean;
  files: boolean;
  markdown: boolean;
  buttons: boolean;
}

export interface WorkerHealthRequirement {
  key: string;
  label: string;
  settingsTarget?: string;
}

export interface WorkerOwnedSetting {
  key: string;
  label: string;
  description: string;
  scope: 'job' | 'worker' | 'global';
  storageKey: string;
  dashboardTarget?: string;
}

export interface WorkerDashboardManifest {
  settings?: WorkerDashboardSurface[];
  routes?: WorkerDashboardSurface[];
}

export interface WorkerDashboardSurface {
  id: string;
  label: string;
  description: string;
  path?: string;
  tab?: string;
  fieldGroups?: WorkerDashboardFieldGroup[];
  fields?: WorkerJobDashboardField[];
}

export interface WorkerDashboardFieldGroup {
  id: string;
  label: string;
  description?: string;
}

export interface WorkerJobManifest {
  id: string;
  workerId: string;
  label: string;
  description: string;
  defaultEnabled: boolean;
  defaultCron: string;
  defaultModelAlias: string;
  approvalRequiredDefault: boolean;
  approvalRequiredEditable: boolean;
  defaultPrompt: string;
  prompt: WorkerJobPromptManifest;
  paramsSchema: z.ZodTypeAny;
  defaultParams?: Record<string, unknown>;
  dashboardFields: WorkerJobDashboardField[];
  /**
   * Optional scheduler retry policy. When omitted, scheduled/manual executions use the
   * platform default retry budget. Set `maxRetries: 0` for jobs that must fail fast.
   */
  retryPolicy?: WorkerJobRetryPolicy;
  /**
   * Optional library of one-click recipes the dashboard surfaces above the job edit form.
   * Each preset is a friendly snapshot of cron + params for a common use case ("Tech news
   * weekday mornings", "Quiet weekly digest", …). Applying a preset updates the draft
   * before the user clicks Save — nothing persists until they confirm.
   */
  presets?: WorkerJobPreset[];
  /**
   * Optional lightweight eligibility check used by the scheduler before it prepares
   * a model runtime. Producers can omit this and keep cron as their external beat;
   * consumers can return true when their input queue has work ready.
   */
  hasWork?: (params?: Record<string, unknown>) => boolean | Promise<boolean>;
  /**
   * Item types that wake this job immediately after publication. Wakes are debounced
   * and still pass through enabled/running/hasWork guards; the periodic pipeline tick
   * remains the recovery path for missed in-process events.
   */
  wakeOn?: string[];
  run: (modelId: string, params?: Record<string, unknown>) => Promise<WorkerJobRunResult>;
}

export interface WorkerJobRetryPolicy {
  /** Number of retries after the first failed attempt. Defaults to the platform policy. */
  maxRetries?: number;
  /** Delay before the first retry. Later retries use exponential backoff. */
  initialBackoffMs?: number;
  /** Upper bound for any retry delay. */
  maxBackoffMs?: number;
  /** Random +/- ratio applied to each delay. Use 0 for deterministic jobs/tests. */
  jitterRatio?: number;
}

export interface WorkerJobPreset {
  id: string;
  label: string;
  description: string;
  cron?: string;
  params?: Record<string, unknown>;
}

export interface WorkerJobPromptExample {
  label: string;
  description: string;
  value: string;
}

export interface WorkerJobPromptManifest {
  editable: boolean;
  helpText?: string;
  /** One-click example prompts rendered as chips in the advanced-prompt editor. */
  examples?: WorkerJobPromptExample[];
}

export type WorkerJobDashboardField =
  | WorkerJobTextField
  | WorkerJobTextareaField
  | WorkerJobNumberField
  | WorkerJobBooleanField
  | WorkerJobSelectField
  | WorkerJobStringListField
  | WorkerJobSecretReferenceField
  | WorkerJobModelAliasField
  | WorkerJobActionField;

interface WorkerJobBaseField {
  key: string;
  label: string;
  group?: string;
  helpText?: string;
  /**
   * Optional dotted path into the dashboard's `workerData` bag. When present, the
   * schema-driven form seeds the field with the value at this path (e.g. the worker's
   * current `core.news.sourceRules.minScore`) instead of the static `defaultValue`.
   */
  seedPath?: string;
}

export interface WorkerJobTextField extends WorkerJobBaseField {
  type: 'text';
  defaultValue: string;
  placeholder?: string;
}

export interface WorkerJobTextareaField extends WorkerJobBaseField {
  type: 'textarea';
  defaultValue: string;
  rows?: number;
  placeholder?: string;
}

export interface WorkerJobNumberField extends WorkerJobBaseField {
  type: 'number';
  defaultValue: number;
  min?: number;
  max?: number;
  step?: number;
}

export interface WorkerJobBooleanField extends WorkerJobBaseField {
  type: 'boolean';
  defaultValue: boolean;
}

export interface WorkerJobSelectField extends WorkerJobBaseField {
  type: 'select';
  defaultValue: string;
  options: Array<{ label: string; value: string }>;
}

export interface WorkerJobStringListField extends WorkerJobBaseField {
  type: 'string-list';
  defaultValue: string[];
  rows?: number;
  /**
   * Optional suggested values the dashboard can render as one-click choices
   * while still allowing the user to add custom entries.
   */
  suggestions?: string[];
  placeholder?: string;
}

export interface WorkerJobSecretReferenceField extends WorkerJobBaseField {
  type: 'secret-reference';
  defaultValue: string;
  placeholder?: string;
}

export interface WorkerJobModelAliasField extends WorkerJobBaseField {
  type: 'model-alias';
  defaultValue: string;
  /** Scheduler job whose model override this field edits. */
  targetJob: string;
}

export interface WorkerJobActionField extends WorkerJobBaseField {
  type: 'action';
  actionPath: string;
  method?: 'POST' | 'GET';
  buttonLabel?: string;
  openInPopup?: boolean;
  enabledWhen?: WorkerDashboardFieldCondition;
  disabled?: boolean;
  disabledReason?: string;
}

export interface WorkerDashboardFieldCondition {
  field: string;
  equals: string;
}

export interface WorkerJobRunResult {
  summary: string;
  itemCount?: number;
}

export interface RegisteredWorkerJob {
  worker: WorkerManifest;
  job: WorkerJobManifest;
}
