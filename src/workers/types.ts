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
  id: string;
  name: string;
  version: string;
  description: string;
  owner?: string;
  builtIn: boolean;
  kind?: WorkerKind;
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
  fields?: WorkerJobDashboardField[];
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
  run: (modelId: string, params?: Record<string, unknown>) => Promise<WorkerJobRunResult>;
}

export interface WorkerJobPromptManifest {
  editable: boolean;
  helpText?: string;
}

export type WorkerJobDashboardField =
  | WorkerJobTextField
  | WorkerJobTextareaField
  | WorkerJobNumberField
  | WorkerJobBooleanField
  | WorkerJobSelectField
  | WorkerJobStringListField
  | WorkerJobSecretReferenceField;

interface WorkerJobBaseField {
  key: string;
  label: string;
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
}

export interface WorkerJobTextareaField extends WorkerJobBaseField {
  type: 'textarea';
  defaultValue: string;
  rows?: number;
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
}

export interface WorkerJobSecretReferenceField extends WorkerJobBaseField {
  type: 'secret-reference';
  defaultValue: string;
  placeholder?: string;
}

export interface WorkerJobRunResult {
  summary: string;
  itemCount?: number;
}

export interface RegisteredWorkerJob {
  worker: WorkerManifest;
  job: WorkerJobManifest;
}
