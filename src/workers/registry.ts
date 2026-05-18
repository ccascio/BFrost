import { config } from '../config';
import { builtInWorkers, builtInWorkerModules } from './builtin';
import type {
  BackendWorkerModule,
  ChannelAdapterFactory,
  ProviderAdapter,
  ProviderAdapterFactory,
} from './module';
import type {
  WorkerChannelManifest,
  WorkerJobManifest,
  WorkerManifest,
  WorkerProviderManifest,
  WorkerToolManifest,
  RegisteredWorkerJob,
} from './types';

export interface RegisteredChannelAdapter {
  worker: WorkerManifest;
  manifest: WorkerChannelManifest;
  factory: ChannelAdapterFactory;
}

export interface RegisteredWorkerTool {
  worker: WorkerManifest;
  manifest: WorkerToolManifest;
}

export interface RegisteredWorkerProvider {
  worker: WorkerManifest;
  manifest: WorkerProviderManifest;
  factory: ProviderAdapterFactory;
}

export type JobName = string;

/**
 * Indexes are built lazily on first access. This sidesteps a CJS circular-import edge case
 * where the channels-telegram worker reaches back into the assistant agent (and thus the
 * registry) before `./builtin` has finished initializing.
 */
interface RegistryIndexes {
  jobs: Map<string, RegisteredWorkerJob>;
  channels: Map<string, RegisteredChannelAdapter>;
  tools: Map<string, RegisteredWorkerTool>;
  providers: Map<string, RegisteredWorkerProvider>;
}

let cachedIndexes: RegistryIndexes | null = null;
const localModules = new Map<string, { module: BackendWorkerModule; workerDir?: string }>();

export function registerLoadedLocalModule(module: BackendWorkerModule, workerDir?: string): void {
  const id = module.manifest.id;
  if (localModules.has(id)) {
    throw new Error(`Local worker module ${id} is already registered.`);
  }
  if (builtInWorkers.some((worker) => worker.id === id)) {
    throw new Error(`Local worker id ${id} conflicts with a built-in worker.`);
  }
  localModules.set(id, { module, workerDir });
  cachedIndexes = null;
  providerAdapterInstances.clear();
}

export function unregisterLocalWorkerModule(id: string): void {
  if (!localModules.delete(id)) return;
  cachedIndexes = null;
  providerAdapterInstances.clear();
}

export function listLocalWorkerModules(): BackendWorkerModule[] {
  return Array.from(localModules.values()).map((entry) => entry.module);
}

function allModules(): BackendWorkerModule[] {
  return [...builtInWorkerModules, ...listLocalWorkerModules()];
}

function allManifests(): WorkerManifest[] {
  return allModules().map((module) => module.manifest);
}

function buildIndexes(): RegistryIndexes {
  const manifests = allManifests();
  const modules = allModules();

  const jobs = new Map<string, RegisteredWorkerJob>();
  for (const worker of manifests) {
    for (const job of worker.jobs) {
      if (jobs.has(job.id)) {
        throw new Error(`Duplicate worker job id: ${job.id}`);
      }
      jobs.set(job.id, { worker, job });
    }
  }

  const channels = new Map<string, RegisteredChannelAdapter>();
  for (const module of modules) {
    const declared = module.manifest.channels ?? [];
    const factories = module.channelAdapters ?? [];
    for (const factory of factories) {
      const manifest = declared.find((channel) => channel.id === factory.channelId);
      if (!manifest) {
        throw new Error(
          `Channel adapter ${factory.channelId} is not declared in manifest for worker ${module.manifest.id}`,
        );
      }
      if (channels.has(manifest.id)) {
        throw new Error(`Duplicate channel id across workers: ${manifest.id}`);
      }
      channels.set(manifest.id, { worker: module.manifest, manifest, factory });
    }
  }

  const tools = new Map<string, RegisteredWorkerTool>();
  for (const worker of manifests) {
    for (const toolManifest of worker.tools ?? []) {
      if (toolManifest.workerId !== worker.id) {
        throw new Error(
          `Tool ${toolManifest.id} declares workerId ${toolManifest.workerId}, expected ${worker.id}`,
        );
      }
      if (tools.has(toolManifest.name)) {
        throw new Error(`Duplicate tool name across workers: ${toolManifest.name}`);
      }
      tools.set(toolManifest.name, { worker, manifest: toolManifest });
    }
  }

  const providers = new Map<string, RegisteredWorkerProvider>();
  for (const module of modules) {
    const declared = module.manifest.providers ?? [];
    const factories = module.providerAdapters ?? [];
    for (const factory of factories) {
      const providerManifest = declared.find((provider) => provider.id === factory.providerId);
      if (!providerManifest) {
        throw new Error(
          `Provider adapter ${factory.providerId} is not declared in manifest for worker ${module.manifest.id}`,
        );
      }
      if (providers.has(providerManifest.id)) {
        throw new Error(`Duplicate provider id across workers: ${providerManifest.id}`);
      }
      providers.set(providerManifest.id, {
        worker: module.manifest,
        manifest: providerManifest,
        factory,
      });
    }
  }

  return { jobs, channels, tools, providers };
}

function indexes(): RegistryIndexes {
  if (!cachedIndexes) {
    cachedIndexes = buildIndexes();
  }
  return cachedIndexes;
}

export function listWorkers(): WorkerManifest[] {
  return allManifests();
}

export function listBuiltInWorkers(): WorkerManifest[] {
  return builtInWorkers;
}

export function listWorkerJobs(): WorkerJobManifest[] {
  return Array.from(indexes().jobs.values()).map((entry) => entry.job);
}

export function knownJobs(): JobName[] {
  return listWorkerJobs().map((job) => job.id);
}

export function isJobName(value: string): value is JobName {
  return indexes().jobs.has(value);
}

export function getWorkerJob(id: JobName): WorkerJobManifest {
  const entry = indexes().jobs.get(id);
  if (!entry) {
    throw new Error(`Unknown job: ${id}`);
  }
  return entry.job;
}

export function getRegisteredWorkerJob(id: JobName): RegisteredWorkerJob {
  const entry = indexes().jobs.get(id);
  if (!entry) {
    throw new Error(`Unknown job: ${id}`);
  }
  return entry;
}

export function jobLabels(): Record<JobName, string> {
  return Object.fromEntries(listWorkerJobs().map((job) => [job.id, job.label]));
}

export function listRegisteredChannels(): RegisteredChannelAdapter[] {
  return Array.from(indexes().channels.values());
}

export function listRegisteredTools(): RegisteredWorkerTool[] {
  return Array.from(indexes().tools.values());
}

export function getRegisteredTool(name: string): RegisteredWorkerTool | undefined {
  return indexes().tools.get(name);
}

export function listRegisteredProviders(): RegisteredWorkerProvider[] {
  return Array.from(indexes().providers.values());
}

export function getRegisteredProvider(id: string): RegisteredWorkerProvider | undefined {
  return indexes().providers.get(id);
}

/**
 * Cache adapter instances so callers (admin-server, llm.ts, index.ts, job-runner) share
 * a single instance per provider id. This keeps local-runtime state coherent.
 */
const providerAdapterInstances = new Map<string, ProviderAdapter>();

export function getProviderAdapter(id: string): ProviderAdapter | undefined {
  let adapter = providerAdapterInstances.get(id);
  if (adapter) return adapter;
  const registered = getRegisteredProvider(id);
  if (!registered) return undefined;
  adapter = registered.factory.create();
  providerAdapterInstances.set(id, adapter);
  return adapter;
}

/**
 * Return the local-runtime provider selected as the active runtime. Prefer the user's
 * configured choice (`config.activeLocalProviderId`); fall back to the first configured
 * local-runtime provider so a fresh install without any persisted choice still works.
 */
export function getActiveLocalProvider(): ProviderAdapter | undefined {
  const preferred = config.activeLocalProviderId?.trim();
  if (preferred) {
    const registered = getRegisteredProvider(preferred);
    if (registered?.manifest.capabilities.localRuntime) {
      const adapter = getProviderAdapter(preferred);
      if (adapter && adapter.isConfigured()) return adapter;
    }
  }
  for (const registered of listRegisteredProviders()) {
    if (!registered.manifest.capabilities.localRuntime) continue;
    const adapter = getProviderAdapter(registered.manifest.id);
    if (adapter && adapter.isConfigured()) return adapter;
  }
  return undefined;
}

/**
 * Deliver an operator notification (e.g. cron run outcome) through the configured primary
 * channel. Falls back to the first configured channel that opts into proactive delivery so
 * notifications still flow on a fresh install. Silent no-op when no channel can deliver.
 *
 * Note: only outbound operator notifications are funneled through the primary channel.
 * Inbound user messages still flow through every started channel adapter independently.
 */
export async function notifyOperatorChannels(text: string): Promise<void> {
  const primaryId = config.primaryChannelId?.trim();
  const channels = listRegisteredChannels();
  const candidates: typeof channels = [];
  if (primaryId) {
    const primary = channels.find((c) => c.manifest.id === primaryId);
    if (primary) candidates.push(primary);
  }
  if (candidates.length === 0) candidates.push(...channels);

  for (const channel of candidates) {
    const adapter = channel.factory.create();
    if (!adapter.notifyOperator) continue;
    if (!(await adapter.isConfigured())) continue;
    try {
      await adapter.notifyOperator(text);
      return;
    } catch (err) {
      console.warn(`[Channels] ${channel.manifest.id} operator notification failed:`, err);
    }
  }
}
