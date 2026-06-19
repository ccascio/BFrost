import { config, findModel, getDefaultModelAlias, type ModelOption } from './config';
import { runAgent } from './agent';
import { isModelProviderConfigured } from './llm';
import { refreshActiveLocalProviderModels } from './model-discovery';
import {
  getActiveLocalProvider,
  getWorkerJob,
  type JobName,
} from './workers/registry';
import type { ProviderAdapter } from './workers/module';
import { getPinnedModelId, getPinnedModelIdSync, setPinnedModelId } from './local-model-pin';

export { isJobName, jobLabels, knownJobs, type JobName } from './workers/registry';

let localRuntimeRunQueue: Promise<void> = Promise.resolve();

export interface JobRunResult {
  job: JobName;
  modelAlias: string;
  modelId: string;
  modelLabel: string;
  summary: string;
  itemCount?: number;
}

export interface TaskRunResult {
  modelAlias: string;
  modelId: string;
  modelLabel: string;
  summary: string;
}

async function invokeJob(job: JobName, modelId: string, params?: Record<string, unknown>) {
  return getWorkerJob(job).run(modelId, params);
}

export interface RunModelOptions {
  /**
   * When true, the runner does NOT unload the model or stop the local runtime
   * after the work completes. Use for short-lived flows (chat turns) where back-to-back
   * invocations would otherwise pay multi-second load costs each time.
   */
  keepLoaded?: boolean;
}

export async function runNamedJob(job: JobName, modelAlias?: string, params?: Record<string, unknown>): Promise<JobRunResult> {
  const requestedModel = await resolveRequestedModelAlias(modelAlias);
  const primaryModel = findModel(requestedModel);
  if (!primaryModel) {
    throw new Error(`Unknown model alias: ${requestedModel}`);
  }

  return runWithModelFailover(primaryModel, async (model) => {
    const result = await invokeJob(job, model.id, params);
    return {
      job,
      modelAlias: model.alias,
      modelId: model.id,
      modelLabel: model.label,
      summary: result.summary,
      itemCount: result.itemCount,
    };
  });
}

/**
 * Run an interactive chat turn against the chosen model. Routes through the same
 * local-runtime exclusive queue as cron jobs so chat and jobs never race for the GPU.
 *
 * The model stays loaded between turns only if the user has explicitly pinned it
 * from the dashboard (see setPinnedModelId). Otherwise it is unloaded after the
 * turn, mirroring the cron-job lifecycle.
 */
export async function runChatTurn(
  modelAlias: string,
  fn: (model: ModelOption) => Promise<string>,
): Promise<{ text: string; model: ModelOption }> {
  const primaryModel = await resolveModel(modelAlias);
  if (!primaryModel) {
    throw new Error(`Unknown model alias: ${modelAlias}`);
  }

  // Ensure pin state is hydrated so the local-runtime prep step can read it synchronously.
  await getPinnedModelId();

  return runWithModelFailover(primaryModel, async (model) => {
    const text = await fn(model);
    return { text, model };
  });
}

/**
 * Pin a model and ensure it's loaded. The pin is sticky: subsequent jobs/chats that
 * use a different model will still unload that model when they finish, but the prep
 * machinery restores the pinned model so it stays resident afterward.
 */
export async function pinAndLoadModel(modelAlias: string): Promise<void> {
  const model = await resolveModel(modelAlias);
  if (!model) throw new Error(`Unknown model alias: ${modelAlias}`);
  const provider = requireLocalProviderForModel(model);
  await runWithLocalRuntimeExclusive(async () => {
    if (provider.startRuntime) await provider.startRuntime();
    if (provider.unloadAllModels) await provider.unloadAllModels();
    if (provider.loadModel) await provider.loadModel(model.id);
  });
  await setPinnedModelId(model.id);
}

/** Clear the pin and unload everything currently loaded. */
export async function unpinAndUnloadModel(): Promise<void> {
  await setPinnedModelId(null);
  const provider = getActiveLocalProvider();
  if (!provider) return;
  await runWithLocalRuntimeExclusive(async () => {
    if (provider.unloadAllModels) await provider.unloadAllModels();
  });
}

export async function runFreeformTask(
  task: string,
  modelAlias?: string,
): Promise<TaskRunResult> {
  const requestedModel = await resolveRequestedModelAlias(modelAlias);
  const primaryModel = findModel(requestedModel);
  if (!primaryModel) {
    throw new Error(`Unknown model alias: ${requestedModel}`);
  }

  return runWithModelFailover(primaryModel, async (model) => {
    const summary = await runAgent([{ role: 'user', content: task }], model.id);
    return {
      modelAlias: model.alias,
      modelId: model.id,
      modelLabel: model.label,
      summary,
    };
  });
}

class LocalModelUnavailableError extends Error {
  readonly originalError: unknown;

  constructor(model: ModelOption, originalError: unknown) {
    super(`Local model ${model.alias} is unavailable: ${originalError instanceof Error ? originalError.message : String(originalError)}`);
    this.originalError = originalError;
  }
}

async function runWithModelFailover<T>(
  primaryModel: ModelOption,
  run: (model: ModelOption) => Promise<T>,
  options: RunModelOptions = {},
): Promise<T> {
  const candidates = buildFailoverCandidates(primaryModel);
  let lastLocalError: LocalModelUnavailableError | null = null;

  for (const model of candidates) {
    if (!isModelProviderConfigured(model)) {
      console.warn(`[Model] Skipping ${model.alias}; provider "${model.provider}" is not configured.`);
      continue;
    }

    try {
      return await runWithPreparedModel(model, run, options);
    } catch (err) {
      if (err instanceof LocalModelUnavailableError) {
        lastLocalError = err;
        console.warn(`[Model] ${err.message}`);
        continue;
      }
      throw err;
    }
  }

  if (lastLocalError) {
    throw lastLocalError.originalError instanceof Error ? lastLocalError.originalError : lastLocalError;
  }

  throw new Error(`No configured model providers are available for ${primaryModel.alias}.`);
}

function buildFailoverCandidates(primaryModel: ModelOption): ModelOption[] {
  const seen = new Set<string>();
  const candidates: ModelOption[] = [];
  for (const alias of [primaryModel.alias, ...config.modelFallbackAliases]) {
    const model = findModel(alias);
    if (model && !seen.has(model.alias)) {
      seen.add(model.alias);
      candidates.push(model);
    }
  }
  return candidates;
}

async function resolveModel(aliasOrId: string): Promise<ModelOption | undefined> {
  let model = findModel(aliasOrId);
  if (model) return model;
  await refreshActiveLocalProviderModels();
  return findModel(aliasOrId);
}

async function resolveRequestedModelAlias(modelAlias?: string): Promise<string> {
  await refreshActiveLocalProviderModels();
  return modelAlias ?? getDefaultModelAlias();
}

async function runWithPreparedModel<T>(
  model: ModelOption,
  run: (model: ModelOption) => Promise<T>,
  options: RunModelOptions = {},
): Promise<T> {
  if (!isActiveLocalRuntimeModel(model)) {
    return run(model);
  }

  return runWithLocalRuntimeExclusive(() => runWithPreparedLocalRuntimeModel(model, run, options));
}

function requireLocalProviderForModel(model: ModelOption): ProviderAdapter {
  const provider = getActiveLocalProvider();
  if (!provider) {
    throw new LocalModelUnavailableError(
      model,
      new Error('No local provider worker is configured to serve this model.'),
    );
  }
  if (provider.providerId !== model.provider) {
    throw new LocalModelUnavailableError(
      model,
      new Error(`Active local provider "${provider.providerId}" cannot serve provider "${model.provider}".`),
    );
  }
  return provider;
}

async function runWithPreparedLocalRuntimeModel<T>(
  model: ModelOption,
  run: (model: ModelOption) => Promise<T>,
  options: RunModelOptions = {},
): Promise<T> {
  const provider = requireLocalProviderForModel(model);
  const pinnedModelId = getPinnedModelIdSync();
  const isPinnedModel = pinnedModelId !== null && pinnedModelId === model.id;
  const keepRunningModel = options.keepLoaded || isPinnedModel;
  let weStartedServer = false;
  let alreadyLoadedOnlyModel = false;
  let modelPrepared = false;

  try {
    if (provider.startRuntime) {
      weStartedServer = await provider.startRuntime();
    }
    const loadedModels = provider.listLoadedModels ? await provider.listLoadedModels() : [];
    alreadyLoadedOnlyModel =
      loadedModels.length === 1 &&
      loadedModels.some((loaded) => loaded.modelKey === model.id || loaded.identifier === model.id);

    if (!alreadyLoadedOnlyModel) {
      if (provider.unloadAllModels) await provider.unloadAllModels();
      if (provider.loadModel) await provider.loadModel(model.id);
    }

    modelPrepared = true;
    return await run(model);
  } catch (err) {
    if (!modelPrepared) {
      throw new LocalModelUnavailableError(model, err);
    }
    throw err;
  } finally {
    // Unload the model we just ran, unless we want to keep it (chat with keepLoaded,
    // or this IS the pinned model the user wants resident).
    if (!keepRunningModel && modelPrepared && !alreadyLoadedOnlyModel && provider.unloadModel) {
      await provider.unloadModel(model.id);
    }
    // If a different model is pinned, restore it now so it stays resident across jobs.
    if (!isPinnedModel && pinnedModelId && provider.loadModel) {
      try {
        await provider.loadModel(pinnedModelId);
      } catch (err) {
        console.warn(`[Model] Failed to restore pinned model ${pinnedModelId}:`, err);
      }
    }
    // Leave the runtime up if anything is meant to stay loaded.
    const someoneNeedsServer = keepRunningModel || pinnedModelId !== null;
    if (!someoneNeedsServer && weStartedServer && provider.stopRuntime) {
      await provider.stopRuntime();
    }
  }
}

async function runWithLocalRuntimeExclusive<T>(run: () => Promise<T>): Promise<T> {
  const previous = localRuntimeRunQueue;
  let release: () => void = () => undefined;
  localRuntimeRunQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous.catch((err) => {
    console.warn('[Model] Previous local-runtime queue step failed:', err);
  });
  try {
    return await run();
  } finally {
    release();
  }
}

function isActiveLocalRuntimeModel(model: ModelOption): boolean {
  const provider = getActiveLocalProvider();
  return Boolean(provider && provider.providerId === model.provider);
}
