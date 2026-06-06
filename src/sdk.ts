/**
 * Public worker SDK surface — what a local BFrost worker can import from `bfrost`.
 *
 * Workers authored in TypeScript bundle their source with esbuild (see
 * `src/workers/build.ts`); `bfrost` and `node:*` are kept external. At runtime,
 * `registerBfrostRuntimeModule()` in `sdk-runtime.ts` registers this object as the
 * exports of a synthetic `bfrost` module, so `import { openWorkerKv } from 'bfrost'`
 * inside a local worker resolves to the host's implementations rather than bundling
 * a private copy.
 *
 * Anti-goal: this file MUST NOT re-export internals workers shouldn't touch (the
 * scheduler runner, the live registry mutators, the admin server, etc.). Treat every
 * new export as a public API commitment.
 */
import { openWorkerKv } from './workers/storage';
import { openWorkerDb } from './workers/db';
import { requestFileRead, requestFileWrite } from './actions/primitives';
import {
  publishItem,
  listItemsForConsumer,
  filterItemsForConsumer,
  applyConsumerSuccess,
  applyConsumerFailure,
  setConsumerMetadata,
  readConsumerMetadata,
} from './jobs/item-bus';
import { loadQueue, saveQueue, withQueueLock } from './jobs/queue';
import { recordEventSafe } from './event-log';
import { getChatModel, isModelProviderConfigured } from './llm';
import { findModel, getDefaultModel } from './config';
import { embedText } from './embeddings';
import { getActiveChatContext } from './chat-context';
import { listProjects, listProjectIds } from './projects';
import { BadRequestError } from './admin-route';
import { loadKvJson } from './sqlite';

const ADMIN_SETTINGS_STORE_KEY = 'admin.settings';

interface StoredAdminSettings {
  jobs?: Record<string, { prompt?: string }>;
}

/**
 * Read the operator-edited prompt for a job from the Jobs panel. This exposes
 * the generic job settings contract to local workers without exposing admin
 * internals or any worker-specific ids.
 */
export async function getJobPrompt(jobId: string, fallback = ''): Promise<string> {
  const stored = await loadKvJson<StoredAdminSettings>(ADMIN_SETTINGS_STORE_KEY);
  const prompt = stored?.jobs?.[jobId]?.prompt;
  return typeof prompt === 'string' && prompt.trim() ? prompt : fallback;
}

/**
 * Broadcast a message to every configured operator-notification channel
 * (Telegram / Discord / email / …). This is a *generic* core capability — it
 * iterates the registered channels and references no specific worker — so it is
 * safe to expose. Lazily resolved to avoid importing the registry module (a
 * live-mutator surface) at SDK load; only this one broadcast helper is exposed,
 * not the registry itself.
 */
export function notifyOperatorChannels(text: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('./workers/registry') as typeof import('./workers/registry')).notifyOperatorChannels(text);
}

export const bfrostSdk = {
  // Per-worker private storage
  openWorkerKv,
  openWorkerDb,
  // Permissioned action primitives (Workstream 5)
  requestFileRead,
  requestFileWrite,
  // Item Bus (cross-worker producer/consumer queue)
  publishItem,
  listItemsForConsumer,
  filterItemsForConsumer,
  applyConsumerSuccess,
  applyConsumerFailure,
  setConsumerMetadata,
  readConsumerMetadata,
  // Queue mutation primitives — required to complete the consumer pattern
  // (load → mutate → save under a lock).
  loadQueue,
  saveQueue,
  withQueueLock,
  // Model resolution. `findModel` resolves an alias or id to a `ModelOption`;
  // `getChatModel(option)` returns a LanguageModel handle that works with the
  // AI SDK's `generateText`/`streamText`. Local workers should `import { generateText } from 'ai'`
  // themselves — esbuild bundles that into the worker.
  findModel,
  getDefaultModel,
  getChatModel,
  isModelProviderConfigured,
  embedText,
  getJobPrompt,
  // Ambient chat-turn context. `getActiveChatContext()` returns the active
  // conversation/project for the current turn (empty outside a chat turn), so a
  // worker tool can scope itself. `listProjects`/`listProjectIds` expose the
  // generic project grouping for reconciliation of worker-owned resources.
  getActiveChatContext,
  listProjects,
  listProjectIds,
  // Operator notifications (broadcast to all configured channels)
  notifyOperatorChannels,
  // Errors that admin routes can throw to produce a 400
  BadRequestError,
  // Observability
  recordEventSafe,
};

export { requestFileRead, requestFileWrite };

export type BfrostSdk = typeof bfrostSdk;

// Public re-exports so a worker can both call the API and type its own callbacks
// against the SDK contract.
export {
  openWorkerKv,
  openWorkerDb,
  publishItem,
  listItemsForConsumer,
  filterItemsForConsumer,
  applyConsumerSuccess,
  applyConsumerFailure,
  setConsumerMetadata,
  readConsumerMetadata,
  loadQueue,
  saveQueue,
  withQueueLock,
  findModel,
  getDefaultModel,
  getChatModel,
  isModelProviderConfigured,
  embedText,
  recordEventSafe,
  getActiveChatContext,
  listProjects,
  listProjectIds,
};

export type { ChatContext } from './chat-context';
export type { Project } from './projects';
export type { ActionClass, ActionState, ActionRequest, ActionResult } from './actions/types';
export type { EmbeddingResult } from './embeddings';
export type { ModelOption } from './config';
export type { QueueItem, QueueItemState } from './jobs/queue';
export type { WorkerKvStore } from './workers/storage';
export type {
  WorkerDb,
  WorkerTableHandle,
  WorkerTableSchema,
  WorkerColumnDef,
  WorkerIndexDef,
  WorkerTableFindOptions,
  WorkerColumnType,
} from './workers/db';
export type {
  AdminApiRoute,
  AdminRouteContext,
  AdminJsonResponse,
} from './admin-route';
export { BadRequestError } from './admin-route';
export type {
  BackendWorkerModule,
  WorkerLifecycleHooks,
  WorkerLifecycleContext,
  WorkerMigrationContext,
  ChannelAdapter,
  ChannelAdapterFactory,
  ProviderAdapter,
  ProviderAdapterFactory,
} from './workers/module';
export type {
  WorkerManifest,
  WorkerJobManifest,
  WorkerChannelManifest,
  WorkerToolManifest,
  WorkerProviderManifest,
} from './workers/types';
