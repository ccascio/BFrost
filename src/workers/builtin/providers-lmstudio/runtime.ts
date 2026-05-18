import { execFile, type ExecFileOptions } from 'child_process';
import { promisify } from 'util';
import { config } from '../../../config';

const execFileAsync = promisify(execFile);
const LOAD_MODEL_TIMEOUT_MS = 20 * 60 * 1000;
const LOAD_SETTLE_TIMEOUT_MS = 60 * 1000;
const UNLOAD_SETTLE_TIMEOUT_MS = 15000;
const UNLOAD_SETTLE_INTERVAL_MS = 500;

export interface LoadedLmStudioModel {
  modelKey?: string;
  identifier?: string;
}

interface AvailableLmStudioModel {
  modelKey?: string;
  displayName?: string;
  path?: string;
  type?: string;
}

async function lms(...args: string[]): Promise<string> {
  return runLms(args);
}

async function runLms(args: string[], options: ExecFileOptions = {}): Promise<string> {
  const { stdout } = await execFileAsync(config.lmStudioBin, args, options);
  return stdout.toString().trim();
}

async function isServerRunning(): Promise<boolean> {
  try {
    const status = await lms('server', 'status');
    return status.toLowerCase().includes('running');
  } catch {
    return false;
  }
}

export async function startServer(): Promise<boolean> {
  if (await isServerRunning()) {
    console.log('[LMStudio] Server already running.');
    return false;
  }

  console.log('[LMStudio] Starting server...');
  await lms('server', 'start');
  console.log('[LMStudio] Server started.');
  return true;
}

export async function stopServer(): Promise<void> {
  console.log('[LMStudio] Stopping server...');
  try {
    await lms('server', 'stop');
    console.log('[LMStudio] Server stopped.');
  } catch {
    console.log('[LMStudio] Server was already stopped.');
  }
}

export async function getServerStatus(): Promise<boolean> {
  return isServerRunning();
}

export async function listLoadedModels(): Promise<LoadedLmStudioModel[]> {
  try {
    const out = await lms('ps', '--json');
    return JSON.parse(out) as LoadedLmStudioModel[];
  } catch {
    return [];
  }
}

export async function listAvailableModels(): Promise<Array<{ id: string; label?: string; alias?: string }>> {
  const out = await lms('ls', '--llm', '--json');
  const parsed = JSON.parse(out) as AvailableLmStudioModel[];
  return parsed
    .map((model) => {
      const id = model.modelKey?.trim();
      if (!id) return null;
      return {
        id,
        alias: id,
        label: model.displayName?.trim() || model.path?.trim() || id,
      };
    })
    .filter((model): model is { id: string; label: string; alias: string } => Boolean(model));
}

export async function listEmbeddingModels(): Promise<Array<{ id: string; label?: string; alias?: string }>> {
  try {
    const out = await lms('ls', '--json');
    const parsed = JSON.parse(out) as AvailableLmStudioModel[];
    return parsed
      .filter((model) => model.type?.toLowerCase().includes('embed'))
      .map((model) => {
        const id = model.modelKey?.trim();
        if (!id) return null;
        return {
          id,
          alias: id,
          label: model.displayName?.trim() || model.path?.trim() || id,
        };
      })
      .filter((model): model is { id: string; label: string; alias: string } => Boolean(model));
  } catch {
    return [];
  }
}

export async function isModelLoaded(modelKey: string): Promise<boolean> {
  try {
    const loaded = await listLoadedModels();
    return loaded.some((model) => isLoadedModelMatch(modelKey, model));
  } catch {
    return false;
  }
}

export async function loadModel(modelKey: string): Promise<void> {
  console.log(`[LMStudio] Loading model ${modelKey}...`);
  await runLms(getLoadArgsForModel(modelKey), { timeout: LOAD_MODEL_TIMEOUT_MS });
  await waitForModelToLoad(modelKey);
  console.log(`[LMStudio] Model ${modelKey} loaded.`);
}

export async function unloadModel(modelKey: string): Promise<void> {
  console.log(`[LMStudio] Unloading model ${modelKey}...`);

  const loaded = await listLoadedModels();
  const unloadIdentifiers = getUnloadIdentifiersForModel(modelKey, loaded);
  if (unloadIdentifiers.length === 0) {
    console.log(`[LMStudio] Model ${modelKey} was not loaded.`);
    return;
  }

  try {
    for (const identifier of unloadIdentifiers) {
      await lms('unload', identifier);
    }
    await waitForModelToUnload(modelKey);
    console.log(`[LMStudio] Model ${modelKey} unloaded.`);
  } catch (err) {
    console.error('[LMStudio] Unload command FAILED:', err instanceof Error ? err.message : err);
    throw err;
  }

  await purgeMemory();
}

export async function unloadAllModels(): Promise<void> {
  const loaded = await listLoadedModels();
  console.log('[LMStudio] Unloading all loaded models...', { loadedCount: loaded.length, models: loaded.map(m => m.modelKey || m.identifier) });

  let unloadOutput = '';
  try {
    unloadOutput = await lms('unload', '--all');
    console.log('[LMStudio] Unload command output:', unloadOutput);
    console.log('[LMStudio] All loaded models unloaded.');
  } catch (err) {
    console.error('[LMStudio] Unload command FAILED:', err instanceof Error ? err.message : err);
    throw err;
  }

  const loadedAfter = await listLoadedModels();
  console.log('[LMStudio] Models still loaded after unload:', { count: loadedAfter.length, models: loadedAfter.map(m => m.modelKey || m.identifier) });

  await waitForNoLoadedModels();

  // Force memory cleanup by restarting server (LM Studio has a memory leak on unload)
  console.log('[LMStudio] Restarting server to force memory reclamation...');
  try {
    await stopServer();
    await delay(1000);
    await startServer();
    console.log('[LMStudio] Server restarted for memory cleanup.');
  } catch (err) {
    console.log('[LMStudio] Server restart for cleanup failed:', err);
  }
  await purgeMemory();
}

export async function waitForNoLoadedModels(timeoutMs = UNLOAD_SETTLE_TIMEOUT_MS): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const loaded = await listLoadedModels();
    if (loaded.length === 0) {
      return;
    }
    await delay(UNLOAD_SETTLE_INTERVAL_MS);
  }

  const loaded = await listLoadedModels();
  const labels = loaded
    .map((model) => model.modelKey ?? model.identifier)
    .filter(Boolean)
    .join(', ');
  throw new Error(`Timed out waiting for LM Studio models to unload${labels ? `: ${labels}` : ''}.`);
}

export function getUnloadIdentifiersForModel(modelKey: string, loaded: LoadedLmStudioModel[]): string[] {
  return loaded
    .filter((model) => isLoadedModelMatch(modelKey, model))
    .map((model) => model.identifier ?? model.modelKey)
    .filter((identifier): identifier is string => Boolean(identifier));
}

export function getLoadArgsForModel(modelKey: string): string[] {
  return ['load', modelKey, '--identifier', modelKey, '--yes', '--context-length', String(config.lmStudioContextLength)];
}

function isLoadedModelMatch(modelKey: string, model: LoadedLmStudioModel): boolean {
  return model.modelKey === modelKey || model.identifier === modelKey;
}

async function waitForModelToLoad(modelKey: string, timeoutMs = LOAD_SETTLE_TIMEOUT_MS): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isModelLoaded(modelKey)) {
      return;
    }
    await delay(UNLOAD_SETTLE_INTERVAL_MS);
  }

  const loaded = await listLoadedModels();
  const labels = loaded
    .map((model) => model.modelKey ?? model.identifier)
    .filter(Boolean)
    .join(', ');
  throw new Error(`Timed out waiting for LM Studio model to load: ${modelKey}${labels ? ` (loaded: ${labels})` : ''}.`);
}

async function waitForModelToUnload(modelKey: string, timeoutMs = UNLOAD_SETTLE_TIMEOUT_MS): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const loaded = await listLoadedModels();
    if (getUnloadIdentifiersForModel(modelKey, loaded).length === 0) {
      return;
    }
    await delay(UNLOAD_SETTLE_INTERVAL_MS);
  }

  const loaded = await listLoadedModels();
  const labels = getUnloadIdentifiersForModel(modelKey, loaded).join(', ');
  throw new Error(`Timed out waiting for LM Studio model to unload${labels ? `: ${labels}` : `: ${modelKey}`}.`);
}

// Requires passwordless sudo for /usr/sbin/purge in /etc/sudoers, e.g.:
//   youruser ALL=(ALL) NOPASSWD: /usr/sbin/purge
async function purgeMemory(): Promise<void> {
  console.log('[LMStudio] Purging RAM...');
  try {
    await execFileAsync('sudo', ['purge']);
    console.log('[LMStudio] RAM purged.');
  } catch (err) {
    console.log('[LMStudio] RAM purge failed (sudo access may be required):', err instanceof Error ? err.message : err);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
