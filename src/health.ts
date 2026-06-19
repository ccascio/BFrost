import { execFile } from 'child_process';
import { constants } from 'fs';
import { access } from 'fs/promises';
import { promisify } from 'util';
import { config } from './config';
import { embedText } from './embeddings';
import {
  getProviderAdapter,
  listRegisteredChannels,
  listRegisteredHealthChecks,
  listRegisteredProviders,
} from './workers/registry';

const execFileAsync = promisify(execFile);

export interface HealthStatus {
  ok: boolean;
  detail: string;
}

export interface AppHealthSnapshot {
  integrations: Record<string, HealthStatus>;
  dependencies: Record<string, HealthStatus>;
}

async function fileReadable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK | constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function fileExecutable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK | constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function commandAvailable(command: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(command, args, { timeout: 5000 });
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code !== 'ENOENT';
  }
}

function configured(ok: boolean, readyDetail: string, missingDetail: string): HealthStatus {
  return {
    ok,
    detail: ok ? readyDetail : missingDetail,
  };
}

async function embeddingModelReachable(): Promise<boolean> {
  try {
    await embedText('health check');
    return true;
  } catch {
    return false;
  }
}

async function collectAdapterHealth(): Promise<Record<string, HealthStatus>> {
  const entries: Array<[string, HealthStatus]> = [];

  for (const registered of listRegisteredProviders()) {
    const requirement = registered.worker.requiredCredentials?.[0];
    if (!requirement) continue;
    const adapter = getProviderAdapter(registered.manifest.id);
    const ok = Boolean(adapter?.isConfigured());
    entries.push([
      requirement.key,
      configured(
        ok,
        `${registered.manifest.label} provider is configured.`,
        `Configure ${registered.manifest.label} provider credentials in the worker settings.`,
      ),
    ]);
  }

  for (const registered of listRegisteredChannels()) {
    const requirement = registered.worker.requiredCredentials?.[0];
    if (!requirement) continue;
    const adapter = registered.factory.create();
    const ok = await adapter.isConfigured();
    entries.push([
      requirement.key,
      configured(
        Boolean(ok),
        `${registered.manifest.label} channel is configured.`,
        `Configure ${registered.manifest.label} channel credentials in the worker settings.`,
      ),
    ]);
  }

  return Object.fromEntries(entries);
}

async function collectWorkerHealth(): Promise<Pick<AppHealthSnapshot, 'integrations' | 'dependencies'>> {
  const integrations: Record<string, HealthStatus> = {};
  const dependencies: Record<string, HealthStatus> = {};

  await Promise.all(
    listRegisteredHealthChecks().map(async (check) => {
      const target = check.category === 'dependencies' ? dependencies : integrations;
      try {
        target[check.key] = await check.check();
      } catch (err) {
        target[check.key] = {
          ok: false,
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  return { integrations, dependencies };
}

export async function getAppHealthSnapshot(): Promise<AppHealthSnapshot> {
  const [adapterIntegrations, workerHealth, ffmpegOk, whisperCliOk, whisperModelOk, sqliteCliOk, embeddingModelOk] = await Promise.all([
    collectAdapterHealth(),
    collectWorkerHealth(),
    commandAvailable('ffmpeg', ['-version']),
    commandAvailable('whisper-cli', ['--help']),
    fileReadable(config.whisperModelPath),
    commandAvailable('sqlite3', ['-version']),
    embeddingModelReachable(),
  ]);

  return {
    integrations: {
      ...adapterIntegrations,
      ...workerHealth.integrations,
    },
    dependencies: {
      ffmpeg: configured(
        ffmpegOk,
        '`ffmpeg` is available in PATH.',
        '`ffmpeg` is missing from PATH. Voice transcription will fail.',
      ),
      whisperCli: configured(
        whisperCliOk,
        '`whisper-cli` is available in PATH.',
        '`whisper-cli` is missing from PATH. Voice transcription will fail.',
      ),
      whisperModel: configured(
        whisperModelOk,
        `Whisper model found at ${config.whisperModelPath}.`,
        `Whisper model file not found at ${config.whisperModelPath}.`,
      ),
      sqliteCli: configured(
        sqliteCliOk,
        '`sqlite3` is available in PATH.',
        '`sqlite3` is missing from PATH. Durable event history will fail.',
      ),
      embeddingModelReachable: configured(
        embeddingModelOk,
        `Embedding model ${config.embeddingModel} is reachable via ${config.embeddingProvider}.`,
        `Embedding model ${config.embeddingModel} is not reachable via ${config.embeddingProvider}. Configure an embedding-capable provider and model.`,
      ),
      ...workerHealth.dependencies,
    },
  };
}

export function logStartupHealthSummary(health: AppHealthSnapshot): void {
  const warnings = [
    ...Object.values(health.integrations),
    ...Object.values(health.dependencies).filter((item) => item.detail),
  ].filter((item) => !item.ok);

  if (warnings.length === 0) {
    console.log('[Health] Startup checks passed.');
    return;
  }

  console.warn('[Health] Startup warnings:');
  for (const warning of warnings) {
    console.warn(`- ${warning.detail}`);
  }
}
