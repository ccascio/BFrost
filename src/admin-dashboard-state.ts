// Dashboard-state assembly: the full dashboard payload plus the per-section builders,
// worker summaries, and health derivation. Extracted from admin-server.ts (CODE_ROADMAP 1.1).
import { promises as fs, existsSync } from 'fs';
import path from 'path';
import os from 'os';
import http, { IncomingMessage, Server, ServerResponse } from 'http';
import { randomBytes, timingSafeEqual } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import {
  config,
  availableModels,
  getDefaultModel,
  setCloudApiKeys,
  setDefaultModel,
  setEmbeddingSettings,
  setAdminPassword,
  setLocalWorkerCodeEnabled,
  setAdminSessionTtlHours,
  setJobLlmTimeoutMs,
} from './config';
import { refreshActiveLocalProviderModels, refreshCloudProviderModels } from './model-discovery';
import { upsertEnvValue } from './env-file';
import {
  collectRecipes,
  getActiveLocalProvider,
  getRegisteredProvider,
  listRegisteredApiRoutes,
  listRegisteredChannels,
  listRegisteredProviders,
} from './workers/registry';
import { updatePlatformSettings } from './admin-config';
import { HttpRouter } from './http/router';
import { readJsonBody, readRawBody, sendJson } from './http/responses';
import type { ProviderAdapter } from './workers/module';
import { getSchedulerSnapshot, reloadSchedulerSchedules, triggerJobNow, updateSchedulerJob } from './scheduler';
import { isJobName, pinAndLoadModel, unpinAndUnloadModel } from './job-runner';
import { getPinnedModelId } from './local-model-pin';
import { listWorkers, setHiddenBuiltInIds } from './workers/registry';
import { builtInWorkers } from './workers/builtin';
import { discoverLocalWorkerResult, discoverLocalWorkers, type DiscoveredLocalWorker } from './workers/local';
import { compileLocalWorkerDashboard } from './workers/build';
import {
  normalizeScaffoldSpec,
  specFromModelOutput,
  writeWorkerScaffold,
  workerSlug,
  type WorkerScaffoldSpec,
} from './workers/scaffold';
import {
  forgetWorker,
  isWorkerEnabled,
  loadWorkerState,
  rememberSeenWorkers,
  setWorkerEnabled,
  setWorkerHidden,
  type WorkerStateStore,
} from './workers/state';
import { activateLocalWorker, deactivateLocalWorker } from './workers/bootstrap';
import { WorkerLoadError } from './workers/loader';
import type { WorkerManifest } from './workers/types';
import { getAppHealthSnapshot } from './health';
import type { AppHealthSnapshot, HealthStatus } from './health';
import { listRecentEventsSafe, recordEventSafe } from './event-log';
import { loadQueueSnapshot, updateDashboardQueueItem } from './jobs/queue-service';
import { loadRegisteredWorkerDashboardData } from './workers/dashboard-data';
import {
  AdminLoginBodySchema,
  AutoBackupSettingsSchema,
  BackupsSectionSchema,
  ChatMessageBodySchema,
  GenerateWorkerBodySchema,
  ChatThreadUpdateBodySchema,
  ProjectCreateBodySchema,
  ProjectRenameBodySchema,
  CloudApiKeysBodySchema,
  CoreSettingsBodySchema,
  EmbeddingSettingsBodySchema,
  FactoryResetBodySchema,
  PlatformSettingsBodySchema,
  CronJobUpdateBodySchema,
  CronRunsSectionSchema,
  DashboardStateSchema,
  DefaultModelBodySchema,
  EventsSectionSchema,
  LmStudioActionBodySchema,
  LmStudioModelsSectionSchema,
  LocalEmbeddingModelsSectionSchema,
  type LocalEmbeddingModelsSection,
  StoreInstallBodySchema,
  WorkerDataSectionSchema,
  WorkerUpdateBodySchema,
  QueueItemActionBodySchema,
  QueueSectionSchema,
  ActionDecisionBodySchema,
  JobMetricsResponseSchema,
  RecipeApplyBodySchema,
  type BackupsSection,
  type CronRunsSection,
  type DashboardState,
  type EventsSection,
  type LmStudioModelsSection,
  type WorkerDataSection,
  type QueueSection,
  type JobMetricsResponse,
} from './admin-api';
import {
  listPendingActionRequests,
  listActionRequests,
  approveActionRequest,
  rejectActionRequest,
} from './actions';
import { BadRequestError } from './admin-route';
import { listSchedulerRuns } from './scheduler-runs';
import {
  createAppBackup,
  getAutoBackupSettings,
  listAppBackups,
  restartAutoBackup,
  saveAutoBackupSettings,
  scheduleRestoreOnNextBoot,
  cancelPendingRestore,
} from './app-backup';
import { processChannelMessage } from './channel';
import { getFullHistory } from './conversation';
import {
  listThreads,
  getThread,
  renameThread,
  assignThreadProject,
  clearProjectFromThreads,
  deleteThread,
} from './chat-threads';
import {
  listProjects,
  getProject,
  createProject,
  renameProject,
  deleteProject,
} from './projects';
import { createHash } from 'crypto';
import { loadKvJson, saveKvJson } from './sqlite';
import { openWorkerKv } from './workers/storage';
import { generateText } from 'ai';
import { getChatModel } from './llm';
import { publishItem } from './jobs/item-bus';
import { builtInWorkerIds, syncHiddenBuiltIns, workerCatalog, type CatalogWorker } from './admin-worker-ops';

export const WORKER_HEALTH_STATE_STORE_KEY = 'worker.health.state';

export async function buildDashboardState(): Promise<DashboardState> {
  // Sync hidden built-ins BEFORE any listWorkers() call so soft-deleted plugin
  // workers are excluded from the registry and scheduler view.
  await syncHiddenBuiltIns();

  const localProvider = getActiveLocalProvider();
  const [scheduler, lmStudioRunning, loadedCount, health, localResult, pinnedModelId] = await Promise.all([
    getSchedulerSnapshot(),
    localProvider?.getRuntimeStatus ? localProvider.getRuntimeStatus() : Promise.resolve(false),
    countLoadedModels(localProvider),
    getAppHealthSnapshot(),
    discoverLocalWorkerResult(),
    getPinnedModelId(),
  ]);
  await refreshActiveLocalProviderModels();

  const defaultModel = getDefaultModel();
  const localWorkers = localResult.workers;
  const workerState = await rememberSeenWorkers([
    ...listWorkers().map((worker) => ({ id: worker.id, builtIn: true })),
    ...localWorkers.map((worker) => ({
      id: worker.manifest.id,
      builtIn: false,
      sourcePath: worker.sourcePath,
    })),
  ]);
  const workerSummaries = listWorkerSummaries(scheduler.jobs, health, localWorkers, workerState);
  await recordWorkerHealthEvents(workerSummaries);

  return DashboardStateSchema.parse({
    app: {
      name: 'BFrost Control Room',
      adminUrl: `http://${config.adminHost}:${config.adminPort}`,
      timezone: scheduler.timezone,
      now: new Date().toISOString(),
      pid: process.pid,
    },
    models: availableModels,
    defaultModel,
    lmStudio: {
      running: lmStudioRunning,
      loadedCount,
      pinnedModelId,
    },
    cron: { timezone: scheduler.timezone, jobs: scheduler.jobs },
    workers: workerSummaries,
    workerIssues: localResult.issues,
    platform: {
      activeLocalProviderId: config.activeLocalProviderId,
      primaryChannelId: config.primaryChannelId,
      embeddingProvider: config.embeddingProvider,
      embeddingModel: config.embeddingModel,
      adminPasswordSet: config.adminPassword.trim().length > 0,
      localWorkerCodeEnabled: config.localWorkerCodeEnabled,
      adminSessionTtlHours: config.adminSessionTtlHours,
      jobLlmTimeoutMs: config.jobLlmTimeoutMs,
      adminHost: config.adminHost,
      adminPort: config.adminPort,
    },
    availableLocalProviders: listRegisteredProviders()
      .filter((p) => p.manifest.capabilities.localRuntime)
      .map((p) => ({
        id: p.manifest.id,
        label: p.manifest.label,
        workerId: p.worker.id,
        workerName: p.worker.name,
      })),
    availableChannels: listRegisteredChannels().map((c) => ({
      id: c.manifest.id,
      label: c.manifest.label,
      workerId: c.worker.id,
      workerName: c.worker.name,
    })),
    integrations: health.integrations,
    dependencies: health.dependencies,
    workerData: {},
    recipes: collectRecipes(),
  });
}

export async function countLoadedModels(localProvider: ProviderAdapter | null | undefined): Promise<number> {
  if (!localProvider?.listLoadedModels) return 0;
  try {
    const models = await localProvider.listLoadedModels();
    return models.length;
  } catch {
    return 0;
  }
}

export async function buildQueueSection(): Promise<QueueSection> {
  const queue = await loadQueueSnapshot();
  return QueueSectionSchema.parse({ queue });
}

export async function buildCronRunsSection(): Promise<CronRunsSection> {
  const runs = await listSchedulerRuns(100);
  return CronRunsSectionSchema.parse({ runs });
}

export async function buildEventsSection(): Promise<EventsSection> {
  const events = await listRecentEventsSafe(50);
  return EventsSectionSchema.parse({ events });
}

export async function buildBackupsSection(): Promise<BackupsSection> {
  const backups = await listAppBackups(20);
  return BackupsSectionSchema.parse({ backups });
}

export async function buildWorkerDataSection(): Promise<WorkerDataSection> {
  const workerDashboardData = await loadRegisteredWorkerDashboardData();
  return WorkerDataSectionSchema.parse({ workerData: workerDashboardData });
}

export async function buildLocalEmbeddingModelsSection(): Promise<LocalEmbeddingModelsSection> {
  const localProvider = getActiveLocalProvider();

  // Prefer the provider's own type-filtered list (LM Studio knows the model type).
  if (localProvider?.listEmbeddingModels) {
    const models = await localProvider.listEmbeddingModels();
    if (models.length > 0) {
      return LocalEmbeddingModelsSectionSchema.parse({
        models: models.map((m) => ({ id: m.id, label: m.label ?? m.id })),
      });
    }
  }

  // Fallback: query the OpenAI-compatible /v1/models and filter by "embed" in the id.
  try {
    const base = config.ollamaBaseUrl.replace(/\/+$/, '');
    const response = await fetch(`${base}/models`, { signal: AbortSignal.timeout(5000) });
    if (response.ok) {
      const data = await response.json() as { data?: Array<{ id?: string }> };
      const all = Array.isArray(data.data) ? data.data : [];
      const embedding = all
        .map((m) => (typeof m.id === 'string' ? m.id.trim() : ''))
        .filter((id) => id && id.toLowerCase().includes('embed'));
      return LocalEmbeddingModelsSectionSchema.parse({
        models: embedding.map((id) => ({ id, label: id })),
      });
    }
  } catch {
    // server not running or not reachable
  }

  return LocalEmbeddingModelsSectionSchema.parse({ models: [] });
}

export async function buildLmStudioModelsSection(): Promise<LmStudioModelsSection> {
  const localProvider = getActiveLocalProvider();
  if (!localProvider?.listLoadedModels) {
    return LmStudioModelsSectionSchema.parse({ loadedModels: [] });
  }
  const loaded = await localProvider.listLoadedModels();
  return LmStudioModelsSectionSchema.parse({
    loadedModels: loaded.map((item) => item.modelKey || item.identifier || 'unknown'),
  });
}

/** Compute percentile (0–100) of a sorted numeric array. Returns null if empty. */
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.min(idx, sorted.length - 1)];
}

export async function buildJobMetricsSection(): Promise<JobMetricsResponse> {
  const [runs, snapshot] = await Promise.all([
    listSchedulerRuns(200),
    getSchedulerSnapshot(),
  ]);

  // Build a map: jobName → { workerId, workerName } from the current scheduler state.
  // Falls back to a synthetic "unknown" worker for runs whose job no longer exists.
  const jobWorkerMap = new Map<string, { workerId: string; workerName: string }>(
    snapshot.jobs.map((j) => [j.name, { workerId: j.workerId, workerName: j.workerName }]),
  );

  // Group runs by job name, preserving insertion order (runs are newest-first from storage).
  const byJob = new Map<string, typeof runs>();
  for (const run of runs) {
    const bucket = byJob.get(run.job) ?? [];
    bucket.push(run);
    byJob.set(run.job, bucket);
  }

  // Compute per-job metrics.
  type JobEntry = {
    jobName: string;
    jobLabel: string;
    workerId: string;
    workerName: string;
    totalRuns: number;
    successCount: number;
    errorCount: number;
    skippedCount: number;
    successRate: number | null;
    p50Ms: number | null;
    p95Ms: number | null;
    avgItemCount: number | null;
    lastFailureReason: string | null;
    recentStatuses: Array<'success' | 'error' | 'skipped'>;
  };

  const jobEntries: JobEntry[] = [];

  for (const [jobName, jobRuns] of byJob) {
    const workerInfo = jobWorkerMap.get(jobName) ?? { workerId: 'unknown', workerName: 'Unknown' };
    // jobRuns are newest-first from storage
    const completed = jobRuns.filter((r) => r.status === 'success' || r.status === 'error');
    const successCount = completed.filter((r) => r.status === 'success').length;
    const errorCount = completed.filter((r) => r.status === 'error').length;
    const skippedCount = jobRuns.filter((r) => r.status === 'skipped').length;
    const totalRuns = jobRuns.length;

    const successRate = completed.length >= 1 ? successCount / completed.length : null;

    // Durations only for completed runs with both timestamps
    const durations = completed
      .filter((r) => r.finishedAt !== null)
      .map((r) => Date.parse(r.finishedAt as string) - Date.parse(r.startedAt))
      .filter((d) => d >= 0)
      .sort((a, b) => a - b);

    const p50Ms = durations.length >= 5 ? percentile(durations, 50) : null;
    const p95Ms = durations.length >= 5 ? percentile(durations, 95) : null;

    // Average item count for runs that reported one
    const withItems = completed.filter((r) => r.itemCount !== null);
    const avgItemCount = withItems.length > 0
      ? withItems.reduce((s, r) => s + (r.itemCount as number), 0) / withItems.length
      : null;

    // Most recent error message (runs are newest-first)
    const lastError = jobRuns.find((r) => r.status === 'error');
    const lastFailureReason = lastError?.error ?? null;

    // Last ≤20 non-running statuses for sparkline (newest-first, reversed for display)
    const recentStatuses = jobRuns
      .filter((r): r is typeof r & { status: 'success' | 'error' | 'skipped' } =>
        r.status === 'success' || r.status === 'error' || r.status === 'skipped',
      )
      .slice(0, 20)
      .reverse()
      .map((r) => r.status as 'success' | 'error' | 'skipped');

    // label: use the first run's label as a stable display name
    const jobLabel = jobRuns[0]?.label ?? jobName;

    jobEntries.push({
      jobName,
      jobLabel,
      workerId: workerInfo.workerId,
      workerName: workerInfo.workerName,
      totalRuns,
      successCount,
      errorCount,
      skippedCount,
      successRate,
      p50Ms,
      p95Ms,
      avgItemCount,
      lastFailureReason,
      recentStatuses,
    });
  }

  // Group job entries by worker.
  const byWorker = new Map<string, { workerName: string; jobs: JobEntry[] }>();
  for (const entry of jobEntries) {
    const bucket = byWorker.get(entry.workerId) ?? { workerName: entry.workerName, jobs: [] };
    bucket.jobs.push(entry);
    byWorker.set(entry.workerId, bucket);
  }

  // Aggregate worker-level metrics.
  const workers = Array.from(byWorker.entries()).map(([workerId, { workerName, jobs }]) => {
    const totalSuccess = jobs.reduce((s, j) => s + j.successCount, 0);
    const totalCompleted = jobs.reduce((s, j) => s + j.successCount + j.errorCount, 0);
    const successRate = totalCompleted >= 1 ? totalSuccess / totalCompleted : null;

    // Worker-level p50/p95: collect all completed-run durations across every job in this worker,
    // sort them together, and compute percentiles directly (same ≥5 guard as per-job).
    const workerDurations: number[] = [];
    for (const j of jobs) {
      for (const r of byJob.get(j.jobName) ?? []) {
        if ((r.status === 'success' || r.status === 'error') && r.finishedAt !== null) {
          const d = Date.parse(r.finishedAt) - Date.parse(r.startedAt);
          if (d >= 0) workerDurations.push(d);
        }
      }
    }
    workerDurations.sort((a, b) => a - b);
    const p50Ms = workerDurations.length >= 5 ? percentile(workerDurations, 50) : null;
    const p95Ms = workerDurations.length >= 5 ? percentile(workerDurations, 95) : null;

    // Most recent error reason across all jobs (runs are newest-first per job).
    let lastFailureReason: string | null = null;
    let lastFailureAt = 0;
    for (const j of jobs) {
      const firstError = (byJob.get(j.jobName) ?? []).find((r) => r.status === 'error');
      if (firstError) {
        const t = Date.parse(firstError.startedAt);
        if (t > lastFailureAt) {
          lastFailureAt = t;
          lastFailureReason = firstError.error ?? null;
        }
      }
    }

    const totalRuns = jobs.reduce((s, j) => s + j.totalRuns, 0);

    return {
      workerId,
      workerName,
      totalRuns,
      successRate,
      p50Ms,
      p95Ms,
      lastFailureReason,
      jobs: jobs.map(({ workerId: _wid, workerName: _wn, ...rest }) => ({ ...rest, workerId: _wid })),
    };
  });

  // Sort workers: most runs first, then alphabetically
  workers.sort((a, b) => b.totalRuns - a.totalRuns || a.workerName.localeCompare(b.workerName));

  return JobMetricsResponseSchema.parse({
    workers,
    windowRuns: runs.length,
    computedAt: new Date().toISOString(),
  });
}

export async function recordWorkerHealthEvents(workers: DashboardState['workers']): Promise<void> {
  const previous = await loadKvJson<Record<string, string>>(WORKER_HEALTH_STATE_STORE_KEY) ?? {};
  const next = Object.fromEntries(workers.map((worker) => [worker.id, worker.healthState]));

  await Promise.all(
    workers.map(async (worker) => {
      const previousState = previous[worker.id];
      if (previousState === worker.healthState) {
        return;
      }
      if (worker.healthState === 'healthy' && previousState && previousState !== 'disabled') {
        await recordEventSafe({
          category: 'worker',
          action: 'health_recovered',
          summary: `${worker.name} worker health recovered.`,
          metadata: { workerId: worker.id, previousState, healthState: worker.healthState },
        });
        return;
      }
      // Only log health-attention events when a worker that was previously in a known
      // good/working state degrades — not on first boot where unconfigured optional
      // workers go straight from "unseen" to "missing_credentials". That first-boot
      // flood fills the Activity log with errors the user didn't cause.
      if (
        previousState !== undefined &&
        (worker.healthState === 'missing_credentials' ||
          worker.healthState === 'missing_dependency' ||
          worker.healthState === 'degraded')
      ) {
        await recordEventSafe({
          category: 'worker',
          action: 'health_attention',
          severity: worker.healthState === 'degraded' ? 'warning' : 'error',
          summary: `${worker.name} worker needs attention: ${worker.healthDetail}`,
          metadata: { workerId: worker.id, previousState: previousState ?? null, healthState: worker.healthState },
        });
      }
    }),
  );

  await saveKvJson(WORKER_HEALTH_STATE_STORE_KEY, next);
}

export function listWorkerSummaries(
  jobs: DashboardState['cron']['jobs'],
  health: AppHealthSnapshot,
  localWorkers: DiscoveredLocalWorker[],
  workerState: WorkerStateStore,
): DashboardState['workers'] {
  const catalog = workerCatalog(localWorkers);
  const dashboardBundleIndex = new Map<string, boolean>();
  for (const worker of localWorkers) {
    dashboardBundleIndex.set(
      worker.manifest.id,
      Boolean(worker.dashboardEntrypoint || worker.dashboardSource),
    );
  }
  for (const [workerId, stored] of Object.entries(workerState.workers)) {
    if (!catalog.has(workerId) && !stored.builtIn) {
      catalog.set(workerId, {
        id: workerId,
        name: workerId,
        version: 'missing',
        description: 'Local worker manifest is missing. Restore the worker files or keep it disabled for history.',
        builtIn: false,
        jobs: [],
        sourcePath: stored.sourcePath,
      });
    }
  }

  return Array.from(catalog.values()).map((worker) => {
    const workerJobs = jobs.filter((job) => job.workerId === worker.id);
    const enabled = isWorkerEnabled(worker.id, workerState);
    const missing = !worker.builtIn && !localWorkers.some((local) => local.manifest.id === worker.id);
    const dependencyStatuses: Record<string, HealthStatus> = {
      ...health.dependencies,
      ...health.integrations,
    };
    const healthRows = [
      ...(worker.requiredCredentials ?? []).map((requirement) =>
        workerHealthRequirementStatus('credential', true, requirement, health.integrations),
      ),
      ...(worker.optionalCredentials ?? []).map((requirement) =>
        workerHealthRequirementStatus('credential', false, requirement, health.integrations),
      ),
      ...(worker.requiredDependencies ?? []).map((requirement) =>
        workerHealthRequirementStatus('dependency', true, requirement, dependencyStatuses),
      ),
      ...(worker.optionalDependencies ?? []).map((requirement) =>
        workerHealthRequirementStatus('dependency', false, requirement, dependencyStatuses),
      ),
    ];
    const healthState = workerHealthState(healthRows);
    return {
      id: worker.id,
      name: worker.name,
      displayName: worker.displayName,
      version: worker.version,
      description: worker.description,
      tagline: worker.tagline,
      chatPrompts: worker.chatPrompts ?? [],
      onboarding: worker.onboarding,
      demoNotice: worker.demoNotice,
      bfrostEngineRange: worker.bfrostEngineRange,
      builtIn: worker.builtIn,
      deletable: worker.deletable ?? false,
      kind: deriveWorkerKind(worker),
      section: worker.section,
      enabled,
      missing,
      sourcePath: worker.sourcePath,
      hasDashboardBundle: dashboardBundleIndex.get(worker.id) === true,
      healthState: !enabled || missing ? 'disabled' : healthState,
      healthDetail: missing
        ? 'Local worker manifest is missing.'
        : !enabled
          ? 'Worker is disabled.'
          : workerHealthDetail(healthState, healthRows),
      jobCount: workerJobs.length,
      enabledJobCount: workerJobs.filter((job) => job.enabled).length,
      runningJobCount: workerJobs.filter((job) => job.running).length,
      health: healthRows,
      ownedSettings: worker.ownedSettings ?? [],
      dashboard: {
        settings: worker.dashboard?.settings ?? [],
        routes: worker.dashboard?.routes ?? [],
      },
      jobs: workerJobs.map((job) => ({
        id: job.name,
        label: job.label,
        description: job.description,
        enabled: job.enabled,
        running: job.running,
        lastStatus: job.lastStatus,
      })),
    };
  });
}

/**
 * Resolve the worker's primary kind. Honour an explicit manifest declaration first; otherwise
 * derive from what the manifest provides (providers[] → provider, channels[] → channel, else feature).
 * A worker that declares more than one surface still has a single primary kind — choose the
 * one that drives platform-level switching (provider > channel > feature).
 */
export function deriveWorkerKind(worker: WorkerManifest): 'feature' | 'channel' | 'provider' {
  if (worker.kind) return worker.kind;
  if (worker.providers && worker.providers.length > 0) return 'provider';
  if (worker.channels && worker.channels.length > 0) return 'channel';
  return 'feature';
}

export function workerHealthRequirementStatus(
  kind: 'credential' | 'dependency',
  required: boolean,
  requirement: { key: string; label: string; settingsTarget?: string },
  statuses: Record<string, HealthStatus>,
): DashboardState['workers'][number]['health'][number] {
  const status = statuses[requirement.key] ?? { ok: false, detail: `Unknown health key: ${requirement.key}.` };
  return {
    key: requirement.key,
    label: requirement.label,
    ok: status.ok,
    detail: status.detail,
    required,
    kind,
    settingsTarget: requirement.settingsTarget,
  };
}

export function workerHealthState(
  healthRows: DashboardState['workers'][number]['health'],
): DashboardState['workers'][number]['healthState'] {
  if (healthRows.some((row) => row.required && !row.ok && row.kind === 'credential')) {
    return 'missing_credentials';
  }
  if (healthRows.some((row) => row.required && !row.ok && row.kind === 'dependency')) {
    return 'missing_dependency';
  }
  if (healthRows.some((row) => !row.ok)) {
    return 'degraded';
  }
  return 'healthy';
}

export function workerHealthDetail(
  state: DashboardState['workers'][number]['healthState'],
  healthRows: DashboardState['workers'][number]['health'],
): string {
  const missingRequired = healthRows.filter((row) => row.required && !row.ok);
  const missingOptional = healthRows.filter((row) => !row.required && !row.ok);
  if (state === 'disabled') return 'Worker is disabled.';
  if (missingRequired.length > 0) {
    return `Missing ${missingRequired.map((row) => row.label).join(', ')}.`;
  }
  if (missingOptional.length > 0) {
    return `Optional checks need attention: ${missingOptional.map((row) => row.label).join(', ')}.`;
  }
  return 'All declared worker checks passed.';
}
