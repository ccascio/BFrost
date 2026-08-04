import { execFile } from 'child_process';
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
  label?: string;
  action?: {
    label: string;
    method: 'POST';
    path: string;
    successMessage: string;
  };
}

export interface AppHealthSnapshot {
  integrations: Record<string, HealthStatus>;
  dependencies: Record<string, HealthStatus>;
}

// The dashboard rebuilds on every worker/config event, and these probes are the only
// parts of a rebuild that spawn processes or hit the network. Uncached, a burst of job
// events turns into a subprocess storm. Both caches are invalidated explicitly by
// `invalidateHealthProbeCache()` on config changes, so staleness is bounded by intent
// rather than by luck.

/** PATH lookups. A binary appearing mid-process is rare enough to need an explicit reset. */
const commandAvailabilityCache = new Map<string, Promise<boolean>>();

/** Reachability is a live network probe, so it expires on its own as well. */
const EMBEDDING_PROBE_TTL_MS = 60_000;
let embeddingProbe: { key: string; at: number; result: Promise<boolean> } | null = null;

/**
 * Drop memoised health probes so the next snapshot re-measures. Call after anything that
 * could change the answer — provider/model configuration, worker install or enable.
 */
export function invalidateHealthProbeCache(): void {
  commandAvailabilityCache.clear();
  embeddingProbe = null;
}

async function commandAvailable(command: string, args: string[]): Promise<boolean> {
  const cacheKey = `${command} ${args.join(' ')}`;
  const cached = commandAvailabilityCache.get(cacheKey);
  if (cached) return cached;

  const probe = (async () => {
    try {
      await execFileAsync(command, args, { timeout: 5000 });
      return true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      return code !== 'ENOENT';
    }
  })();
  // Cache the promise, not the result, so concurrent callers share one spawn.
  commandAvailabilityCache.set(cacheKey, probe);
  return probe;
}

function configured(ok: boolean, readyDetail: string, missingDetail: string): HealthStatus {
  return {
    ok,
    detail: ok ? readyDetail : missingDetail,
  };
}

async function embeddingModelReachable(): Promise<boolean> {
  // Key on the config that determines the answer, so switching provider or model
  // re-probes immediately instead of serving the previous target's verdict.
  const key = `${config.embeddingProvider}:${config.embeddingModel}`;
  const now = Date.now();
  if (embeddingProbe && embeddingProbe.key === key && now - embeddingProbe.at < EMBEDDING_PROBE_TTL_MS) {
    return embeddingProbe.result;
  }

  const result = (async () => {
    try {
      await embedText('health check');
      return true;
    } catch {
      return false;
    }
  })();
  embeddingProbe = { key, at: now, result };
  return result;
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
        target[check.key] = { ...(await check.check()), label: check.label };
      } catch (err) {
        target[check.key] = {
          ok: false,
          detail: err instanceof Error ? err.message : String(err),
          label: check.label,
        };
      }
    }),
  );

  return { integrations, dependencies };
}

export async function getAppHealthSnapshot(): Promise<AppHealthSnapshot> {
  const [adapterIntegrations, workerHealth, ffmpegOk, sqliteCliOk, embeddingModelOk] = await Promise.all([
    collectAdapterHealth(),
    collectWorkerHealth(),
    commandAvailable('ffmpeg', ['-version']),
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
