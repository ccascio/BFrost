import { promises as fs } from 'fs';
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
  getActiveLocalProvider,
  getRegisteredProvider,
  listRegisteredApiRoutes,
  listRegisteredChannels,
  listRegisteredProviders,
} from './workers/registry';
import { updatePlatformSettings } from './admin-config';
import type { ProviderAdapter } from './workers/module';

async function withLocalProvider<T>(action: (provider: ProviderAdapter) => Promise<T>): Promise<T> {
  const provider = getActiveLocalProvider();
  if (!provider) {
    throw new BadRequestError('No local provider worker is configured.');
  }
  return action(provider);
}
import { getSchedulerSnapshot, reloadSchedulerSchedules, triggerJobNow, updateSchedulerJob } from './scheduler';
import { isJobName, pinAndLoadModel, unpinAndUnloadModel } from './job-runner';
import { getPinnedModelId } from './local-model-pin';
import { listWorkers, setHiddenBuiltInIds } from './workers/registry';
import { builtInWorkers } from './workers/builtin';
import { discoverLocalWorkerResult, discoverLocalWorkers, type DiscoveredLocalWorker } from './workers/local';
import { compileLocalWorkerDashboard } from './workers/build';
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
import { createHash } from 'crypto';
import { loadKvJson, saveKvJson } from './sqlite';
import { publishItem } from './jobs/item-bus';

let server: Server | null = null;
const sessions = new Map<string, number>();

// Set of ids that exist as built-in worker modules (checked without loading state).
const builtInWorkerIds: ReadonlySet<string> = new Set(builtInWorkers.map((w) => w.id));

/**
 * Read the current worker state and push any hidden built-in ids into the
 * registry so `allModules()` / `listWorkers()` stays in sync with persistent
 * operator decisions across the full request cycle.
 *
 * We match against the static built-in catalog rather than the `builtIn` flag
 * in state, because the flag is set to `false` when a reinstalled local copy
 * overwrites the state entry while the original built-in is still hidden.
 */
async function syncHiddenBuiltIns(state?: WorkerStateStore): Promise<void> {
  const s = state ?? await loadWorkerState();
  const ids = new Set(
    Object.entries(s.workers)
      .filter(([id, r]) => r.hidden === true && builtInWorkerIds.has(id))
      .map(([id]) => id),
  );
  setHiddenBuiltInIds(ids);
}
const SESSION_COOKIE = 'bfrost_admin_session';
const WORKER_HEALTH_STATE_STORE_KEY = 'worker.health.state';
const MAX_WORKER_UPLOAD_BYTES = 25 * 1024 * 1024;
const execFileAsync = promisify(execFile);

type CatalogWorker = WorkerManifest & { sourcePath?: string };

export async function startAdminServer(): Promise<void> {
  if (server) {
    return;
  }

  server = http.createServer((req, res) => {
    void handleRequest(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(config.adminPort, config.adminHost, () => {
      server!.off('error', reject);
      console.log(`[Admin] Dashboard available at http://${config.adminHost}:${config.adminPort}`);
      resolve();
    });
  });
}

export async function stopAdminServer(): Promise<void> {
  if (!server) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server!.close((err) => {
      if (err) {
        reject(err);
        return;
      }
      resolve();
    });
  });

  server = null;
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const authEnabled = isAdminAuthEnabled();

    if (url.pathname === '/api/auth/session' && req.method === 'GET') {
      return sendJson(res, 200, {
        authenticated: authEnabled ? isAuthenticated(req) : true,
        authEnabled,
      });
    }

    if (url.pathname === '/api/auth/login' && req.method === 'POST') {
      if (!authEnabled) {
        return sendJson(res, 200, { authenticated: true, authEnabled: false });
      }

      const body = await readJsonBody(req, AdminLoginBodySchema);

      if (!isPasswordValid(body.password)) {
        return sendJson(res, 401, { error: 'Invalid password' });
      }

      createSession(res);
      return sendJson(res, 200, { authenticated: true, authEnabled: true });
    }

    if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
      destroySession(req, res);
      return sendJson(res, 200, { authenticated: false, authEnabled });
    }

    if (authEnabled && url.pathname.startsWith('/api/') && !isAuthenticated(req)) {
      return sendJson(res, 401, { error: 'Authentication required', authRequired: true });
    }

    if (url.pathname === '/api/dashboard' && req.method === 'GET') {
      return sendJson(res, 200, await buildDashboardState());
    }

    if (url.pathname === '/api/dashboard/queue' && req.method === 'GET') {
      return sendJson(res, 200, await buildQueueSection());
    }
    if (url.pathname === '/api/dashboard/cron-runs' && req.method === 'GET') {
      return sendJson(res, 200, await buildCronRunsSection());
    }
    if (url.pathname === '/api/dashboard/events' && req.method === 'GET') {
      return sendJson(res, 200, await buildEventsSection());
    }
    if (url.pathname === '/api/dashboard/backups' && req.method === 'GET') {
      return sendJson(res, 200, await buildBackupsSection());
    }
    if (url.pathname === '/api/dashboard/worker-data' && req.method === 'GET') {
      return sendJson(res, 200, await buildWorkerDataSection());
    }
    if (url.pathname === '/api/dashboard/lmstudio-models' && req.method === 'GET') {
      return sendJson(res, 200, await buildLmStudioModelsSection());
    }
    if (url.pathname === '/api/dashboard/local-embedding-models' && req.method === 'GET') {
      return sendJson(res, 200, await buildLocalEmbeddingModelsSection());
    }
    if (url.pathname === '/api/dashboard/job-metrics' && req.method === 'GET') {
      return sendJson(res, 200, await buildJobMetricsSection());
    }

    {
      const match = url.pathname.match(/^\/api\/workers\/([^/]+)\/dashboard\.js$/);
      if (match && req.method === 'GET') {
        const workerId = decodeURIComponent(match[1]);
        return serveWorkerDashboardBundle(workerId, req, res);
      }
    }

    if (url.pathname === '/api/workers/rescan' && req.method === 'POST') {
      const localResult = await discoverLocalWorkerResult();
      const localWorkers = localResult.workers;
      await rememberSeenWorkers([
        ...listWorkers().map((worker) => ({ id: worker.id, builtIn: true })),
        ...localWorkers.map((worker) => ({
          id: worker.manifest.id,
          builtIn: false,
          sourcePath: worker.sourcePath,
        })),
      ]);
      await recordEventSafe({
        category: 'worker',
        action: 'workers_rescanned',
        summary: `Local workers rescanned (${localWorkers.length} found).`,
        metadata: {
          workerCount: localWorkers.length,
          issueCount: localResult.issues.length,
          paths: localWorkers.map((worker) => worker.sourcePath),
        },
      });
      return sendJson(res, 200, await buildDashboardState());
    }

    if (url.pathname === '/api/workers/upload' && req.method === 'POST') {
      const uploaded = await uploadLocalWorkerZip(req);
      await recordEventSafe({
        category: 'worker',
        action: 'worker_uploaded',
        summary: `${uploaded.manifest.name} worker uploaded.`,
        metadata: {
          workerId: uploaded.manifest.id,
          sourcePath: uploaded.sourcePath,
        },
      });
      return sendJson(res, 200, await buildDashboardState());
    }

    if (url.pathname === '/api/chat' && req.method === 'POST') {
      const body = await readJsonBody(req, ChatMessageBodySchema);
      const response = await processChannelMessage({
        channel: 'dashboard',
        conversationId: body.conversationId ?? 'dashboard-admin',
        userId: 'admin',
        username: 'dashboard',
        text: body.message,
      });
      await recordEventSafe({
        category: 'chat',
        action: 'dashboard_message',
        summary: 'Dashboard chat message processed.',
        metadata: {
          conversationId: body.conversationId ?? 'dashboard-admin',
          messageLength: body.message.length,
          responseLength: response.text.length,
        },
      });
      return sendJson(res, 200, { response: response.text, dashboard: await buildDashboardState() });
    }

    const workerRoute = listRegisteredApiRoutes().find((route) =>
      route.method === req.method && route.path === url.pathname,
    );
    if (workerRoute) {
      const response = await workerRoute.handle({
        req,
        url,
        readJsonBody,
        getDashboardState: buildDashboardState,
      });
      return sendJson(res, response.status, response.body);
    }

    if (url.pathname === '/api/default-model' && req.method === 'POST') {
      const body = await readJsonBody(req, DefaultModelBodySchema);

      await refreshActiveLocalProviderModels();
      const model = setDefaultModel(body.alias);
      await upsertEnvValue(path.join(process.cwd(), '.env'), 'OLLAMA_MODEL', model.id);
      await recordEventSafe({
        category: 'admin',
        action: 'default_model_updated',
        summary: `Default model updated to ${model.alias}.`,
        metadata: { modelAlias: model.alias, modelId: model.id },
      });
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname === '/api/cloud-api-keys' && req.method === 'POST') {
      const body = await readJsonBody(req, CloudApiKeysBodySchema);
      const updates: { openaiApiKey?: string; anthropicApiKey?: string } = {};

      if (body.openaiApiKey !== undefined && body.openaiApiKey.trim()) {
        updates.openaiApiKey = body.openaiApiKey.trim();
        await upsertEnvValue(path.join(process.cwd(), '.env'), 'OPENAI_API_KEY', updates.openaiApiKey);
      }
      if (body.anthropicApiKey !== undefined && body.anthropicApiKey.trim()) {
        updates.anthropicApiKey = body.anthropicApiKey.trim();
        await upsertEnvValue(path.join(process.cwd(), '.env'), 'ANTHROPIC_API_KEY', updates.anthropicApiKey);
      }

      if (Object.keys(updates).length === 0) {
        throw new BadRequestError('Provide at least one API key to save.');
      }

      setCloudApiKeys(updates);
      await refreshCloudProviderModels();
      await recordEventSafe({
        category: 'admin',
        action: 'cloud_api_keys_updated',
        summary: 'Cloud model API keys updated.',
        metadata: {
          openaiUpdated: updates.openaiApiKey !== undefined,
          anthropicUpdated: updates.anthropicApiKey !== undefined,
        },
      });
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname === '/api/platform-settings' && req.method === 'POST') {
      const body = await readJsonBody(req, PlatformSettingsBodySchema);
      const patch: { activeLocalProviderId?: string; primaryChannelId?: string } = {};

      if (body.activeLocalProviderId !== undefined && body.activeLocalProviderId.trim()) {
        const id = body.activeLocalProviderId.trim();
        const registered = getRegisteredProvider(id);
        if (!registered || !registered.manifest.capabilities.localRuntime) {
          throw new BadRequestError(`Unknown local-runtime provider: ${id}`);
        }
        patch.activeLocalProviderId = id;
      }
      if (body.primaryChannelId !== undefined && body.primaryChannelId.trim()) {
        const id = body.primaryChannelId.trim();
        const channels = listRegisteredChannels();
        if (!channels.some((c) => c.manifest.id === id)) {
          throw new BadRequestError(`Unknown channel: ${id}`);
        }
        patch.primaryChannelId = id;
      }
      if (Object.keys(patch).length === 0) {
        throw new BadRequestError('Provide at least one platform setting to update.');
      }

      await updatePlatformSettings(patch);
      if (patch.activeLocalProviderId) {
        await refreshActiveLocalProviderModels();
      }
      await recordEventSafe({
        category: 'admin',
        action: 'platform_settings_updated',
        summary: 'Platform routing updated.',
        metadata: patch,
      });
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname === '/api/embedding-settings' && req.method === 'POST') {
      const body = await readJsonBody(req, EmbeddingSettingsBodySchema);
      if (!body.provider && !body.model) {
        throw new BadRequestError('Provide at least one field to update (provider or model).');
      }
      const updates: { provider?: 'local' | 'openai'; model?: string } = {};
      if (body.provider) {
        updates.provider = body.provider;
        await upsertEnvValue(path.join(process.cwd(), '.env'), 'EMBEDDING_PROVIDER', body.provider);
      }
      if (body.model?.trim()) {
        updates.model = body.model.trim();
        await upsertEnvValue(path.join(process.cwd(), '.env'), 'EMBEDDING_MODEL', updates.model);
      }
      setEmbeddingSettings(updates);
      await recordEventSafe({
        category: 'admin',
        action: 'embedding_settings_updated',
        summary: 'Embedding model settings updated.',
        metadata: updates,
      });
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname === '/api/core-settings' && req.method === 'POST') {
      const body = await readJsonBody(req, CoreSettingsBodySchema);
      const envPath = path.join(process.cwd(), '.env');
      // Audit metadata records which fields changed — never the password value itself.
      const changed: string[] = [];
      let passwordChanged = false;

      if (body.adminPassword !== undefined) {
        const next = body.adminPassword;
        // Reject whitespace-only or trivially short passwords; the empty string is allowed and
        // intentionally disables auth (documented localhost-only default).
        if (next.length > 0 && next.trim().length < 4) {
          throw new BadRequestError('Admin password must be at least 4 characters, or empty to disable auth.');
        }
        await upsertEnvValue(envPath, 'ADMIN_PASSWORD', next);
        setAdminPassword(next);
        passwordChanged = true;
        changed.push('adminPassword');
      }

      if (body.localWorkerCodeEnabled !== undefined) {
        await upsertEnvValue(envPath, 'BFROST_ENABLE_LOCAL_WORKER_CODE', body.localWorkerCodeEnabled ? 'true' : 'false');
        setLocalWorkerCodeEnabled(body.localWorkerCodeEnabled);
        changed.push('localWorkerCodeEnabled');
      }

      if (body.adminSessionTtlHours !== undefined) {
        await upsertEnvValue(envPath, 'ADMIN_SESSION_TTL_HOURS', String(body.adminSessionTtlHours));
        setAdminSessionTtlHours(body.adminSessionTtlHours);
        changed.push('adminSessionTtlHours');
      }

      if (body.jobLlmTimeoutMs !== undefined) {
        await upsertEnvValue(envPath, 'JOB_LLM_TIMEOUT_MS', String(body.jobLlmTimeoutMs));
        setJobLlmTimeoutMs(body.jobLlmTimeoutMs);
        changed.push('jobLlmTimeoutMs');
      }

      if (changed.length === 0) {
        throw new BadRequestError('Provide at least one platform setting to update.');
      }

      // Changing the password invalidates every existing session so a stale cookie cannot
      // outlive a credential rotation. The operator (and any other client) must re-authenticate.
      if (passwordChanged) {
        sessions.clear();
      }

      await recordEventSafe({
        category: 'admin',
        action: 'core_settings_updated',
        summary: `Platform & security settings updated: ${changed.join(', ')}.`,
        metadata: { changed },
      });
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname.startsWith('/api/cron-jobs/') && req.method === 'POST') {
      const parts = url.pathname.split('/').filter(Boolean);
      const jobName = parts[2];
      const action = parts[3] || '';
      if (!isJobName(jobName)) {
        return sendJson(res, 404, { error: 'Unknown job' });
      }

      if (action === 'run') {
        const jobState = await triggerJobNow(jobName);
        return sendJson(res, 200, { started: true, job: jobState });
      }

      const body = await readJsonBody(req, CronJobUpdateBodySchema);
      if (body.modelAlias) {
        await refreshActiveLocalProviderModels();
      }
      await updateSchedulerJob(jobName, {
        enabled: body.enabled,
        cron: body.cron,
        modelAlias: body.modelAlias,
        approvalRequired: body.approvalRequired,
        prompt: body.prompt,
        params: body.params,
      });
      return sendJson(res, 200, { ok: true });
    }

    if (url.pathname.startsWith('/api/workers/') && req.method === 'POST') {
      const workerId = decodeURIComponent(url.pathname.split('/').filter(Boolean)[2] ?? '');
      const body = await readJsonBody(req, WorkerUpdateBodySchema);
      const localWorkers = await discoverLocalWorkers();
      const catalog = workerCatalog(localWorkers);
      const worker = catalog.get(workerId);
      const stored = await loadWorkerState();
      const storedWorker = stored.workers[workerId];
      if (!worker && !storedWorker) {
        return sendJson(res, 404, { error: 'Unknown worker' });
      }
      if (!worker && body.enabled) {
        throw new BadRequestError('Cannot enable a missing worker. Restore the local manifest and rescan first.');
      }

      // Hot lifecycle for local workers — compile + load + onEnable before flipping the
      // flag on enable, and onDisable + unregister after flipping it off on disable. No
      // process restart required.
      const discovered = worker && !worker.builtIn
        ? localWorkers.find((entry) => entry.manifest.id === workerId)
        : undefined;
      if (body.enabled && discovered) {
        try {
          const previousVersion = stored.workers[workerId]?.installedVersion ?? null;
          await activateLocalWorker(discovered, { previousVersion });
        } catch (err) {
          const message = err instanceof WorkerLoadError ? err.message : err instanceof Error ? err.message : String(err);
          throw new BadRequestError(`Worker failed to load: ${message}`);
        }
      }

      await setWorkerEnabled(workerId, body.enabled, {
        builtIn: worker?.builtIn ?? storedWorker?.builtIn ?? false,
        sourcePath: worker?.sourcePath ?? storedWorker?.sourcePath,
      });

      if (!body.enabled && worker && !worker.builtIn) {
        await deactivateLocalWorker(workerId);
      }

      await reloadSchedulerSchedules();
      await recordEventSafe({
        category: 'worker',
        action: body.enabled ? 'worker_enabled' : 'worker_disabled',
        summary: `${worker?.name ?? workerId} worker ${body.enabled ? 'enabled' : 'disabled'}.`,
        metadata: { workerId, builtIn: worker?.builtIn ?? storedWorker?.builtIn ?? false },
      });
      return sendJson(res, 200, await buildDashboardState());
    }

    if (url.pathname.startsWith('/api/workers/') && req.method === 'DELETE') {
      const workerId = decodeURIComponent(url.pathname.split('/').filter(Boolean)[2] ?? '');
      const localWorkers = await discoverLocalWorkers();
      const catalog = workerCatalog(localWorkers);
      const worker = catalog.get(workerId);
      const stored = await loadWorkerState();
      const storedWorker = stored.workers[workerId];
      if (!worker && !storedWorker) {
        return sendJson(res, 404, { error: 'Unknown worker' });
      }
      if (worker?.builtIn || storedWorker?.builtIn) {
        // Deletable built-ins (plugin workers) can be soft-deleted. All other
        // built-ins (channels, providers, infrastructure) cannot be removed.
        if (!worker?.deletable) {
          throw new BadRequestError('Built-in workers cannot be deleted.');
        }
        // Soft-delete: mark hidden so the registry and scheduler stop seeing it.
        const updatedState = await setWorkerHidden(workerId, true, { builtIn: true });
        await syncHiddenBuiltIns(updatedState);
        await reloadSchedulerSchedules();
        await recordEventSafe({
          category: 'worker',
          action: 'worker_deleted',
          summary: `${worker?.name ?? workerId} built-in worker removed. It can be restored from the store.`,
          metadata: { workerId, builtIn: true },
        });
        return sendJson(res, 200, await buildDashboardState());
      }

      const sourcePath = worker?.sourcePath ?? storedWorker?.sourcePath;
      if (sourcePath) {
        await deleteLocalWorkerFiles(sourcePath);
      }
      await forgetWorker(workerId);
      await reloadSchedulerSchedules();
      await recordEventSafe({
        category: 'worker',
        action: 'worker_deleted',
        summary: `${worker?.name ?? workerId} worker deleted.`,
        metadata: { workerId, sourcePath: sourcePath ?? null },
      });
      return sendJson(res, 200, await buildDashboardState());
    }

    if (url.pathname === '/api/queue-item' && req.method === 'POST') {
      const body = await readJsonBody(req, QueueItemActionBodySchema);

      await updateDashboardQueueItem(body.id, body.action);
      return sendJson(res, 200, await buildDashboardState());
    }

    if (url.pathname === '/api/backups' && req.method === 'POST') {
      const backup = await createAppBackup();
      await recordEventSafe({
        category: 'admin',
        action: 'backup_created',
        summary: `SQLite backup created: ${backup.file}`,
        metadata: { file: backup.file, path: backup.path, sizeBytes: backup.sizeBytes },
      });
      return sendJson(res, 200, { ok: true });
    }

    // Auto-backup settings
    if (url.pathname === '/api/backups/settings' && req.method === 'GET') {
      const settings = await getAutoBackupSettings();
      return sendJson(res, 200, settings);
    }

    if (url.pathname === '/api/backups/settings' && req.method === 'PATCH') {
      const body = await readJsonBody(req, AutoBackupSettingsSchema.partial());
      const updated = await saveAutoBackupSettings(body);
      await restartAutoBackup();
      await recordEventSafe({
        category: 'admin',
        action: 'auto_backup_settings_updated',
        summary: `Auto-backup ${updated.enabled ? 'enabled' : 'disabled'} (retention: ${updated.retentionDays} days).`,
        metadata: updated as unknown as Record<string, unknown>,
      });
      return sendJson(res, 200, updated);
    }

    // Restore from backup (marks pending; applied on next startup)
    const restoreMatch = url.pathname.match(/^\/api\/backups\/([^/]+)\/restore$/);
    if (restoreMatch && req.method === 'POST') {
      const file = decodeURIComponent(restoreMatch[1]);
      if (!file.endsWith('.sqlite') || file.includes('/') || file.includes('..')) {
        throw new BadRequestError('Invalid backup filename.');
      }
      await scheduleRestoreOnNextBoot(file);
      await recordEventSafe({
        category: 'admin',
        action: 'backup_restore_scheduled',
        summary: `Restore from ${file} scheduled for next startup.`,
        metadata: { file },
      });
      return sendJson(res, 200, { ok: true, message: 'Restart BFrost to apply this backup.' });
    }

    // Cancel a pending restore
    if (url.pathname === '/api/backups/restore-cancel' && req.method === 'POST') {
      await cancelPendingRestore();
      return sendJson(res, 200, { ok: true });
    }

    // Factory reset — wipes selected categories of state, then exits for restart
    if (url.pathname === '/api/admin/factory-reset' && req.method === 'POST') {
      const body = await readJsonBody(req, FactoryResetBodySchema);
      if (!body.wipeWorkerState && !body.wipeCredentials && !body.wipeBackups) {
        throw new BadRequestError('Select at least one category to reset.');
      }
      await recordEventSafe({
        category: 'admin',
        action: 'factory_reset',
        summary: `Factory reset initiated (workerState=${body.wipeWorkerState}, credentials=${body.wipeCredentials}, backups=${body.wipeBackups}).`,
        metadata: body as unknown as Record<string, unknown>,
      });
      // Send the response before performing destructive operations so the client gets it.
      sendJson(res, 200, { ok: true, message: 'Reset in progress. BFrost will exit and must be restarted.' });
      // Perform reset asynchronously after a brief delay so the HTTP response flushes.
      setTimeout(async () => {
        if (body.wipeBackups) {
          const backupDir = path.join(config.adminStoreDir, 'backups');
          await fs.rm(backupDir, { recursive: true, force: true }).catch(() => undefined);
        }
        if (body.wipeCredentials) {
          const envPath = path.join(process.cwd(), '.env');
          // Strip known credential keys but keep structural lines (comments, blank lines)
          const CREDENTIAL_KEYS = [
            'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'TELEGRAM_BOT_TOKEN', 'DISCORD_BOT_TOKEN',
            'X_CONSUMER_KEY', 'X_CONSUMER_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_TOKEN_SECRET',
            'GOOGLE_API_KEY', 'GOOGLE_SEARCH_ENGINE_ID',
          ];
          try {
            const content = await fs.readFile(envPath, 'utf8');
            const filtered = content.split('\n').filter((line) => {
              const key = line.split('=')[0]?.trim();
              return !key || !CREDENTIAL_KEYS.includes(key);
            }).join('\n');
            await fs.writeFile(envPath, filtered, 'utf8');
          } catch { /* no .env — nothing to clear */ }
        }
        if (body.wipeWorkerState) {
          // Close the DB and delete the SQLite file. A fresh DB is created on next boot.
          const { closeDb } = await import('./sqlite');
          closeDb();
          await fs.rm(config.appDbPath, { force: true }).catch(() => undefined);
        }
        process.exit(0);
      }, 200);
      return; // response already sent above
    }

    // Disable all workers (safe-mode boot helper)
    if (url.pathname === '/api/admin/disable-all-workers' && req.method === 'POST') {
      const allWorkers = listWorkers();
      const workerState = await loadWorkerState();
      const disabledIds: string[] = [];
      for (const worker of allWorkers) {
        if (isWorkerEnabled(worker.id, workerState)) {
          await setWorkerEnabled(worker.id, false, { builtIn: worker.builtIn });
          await deactivateLocalWorker(worker.id);
          disabledIds.push(worker.id);
        }
      }
      await recordEventSafe({ category: 'admin', action: 'safe_mode_activated', summary: `Safe mode: ${disabledIds.length} worker(s) disabled.`, metadata: { disabledIds } });
      return sendJson(res, 200, { ok: true, disabledCount: disabledIds.length });
    }

    // Seed the dashboard with sample data for first-time users
    if (url.pathname === '/api/admin/seed-sample-data' && req.method === 'POST') {
      const SAMPLE_NEWS = [
        { title: 'AI researchers unveil new language model benchmark', url: 'https://example.com/ai-benchmark', shortDesc: 'A new benchmark suite tests reasoning, code, and multi-step planning across 20 open-source models.' },
        { title: 'Open-source robotics platform gains momentum', url: 'https://example.com/robotics', shortDesc: 'Community contributions double in six months as developers build affordable home automation robots.' },
        { title: 'Privacy-first browser extension hits 1M installs', url: 'https://example.com/privacy-ext', shortDesc: 'The extension blocks 99% of trackers with no configuration needed and is fully open-source.' },
        { title: 'Local AI inference now possible on mid-range laptops', url: 'https://example.com/local-ai', shortDesc: 'Optimised runtimes let 7B-parameter models run at usable speeds on hardware costing under $800.' },
        { title: 'Decentralised social network reaches 10 million users', url: 'https://example.com/decentralised', shortDesc: 'Federated protocol lets users own their data while still connecting across platforms.' },
      ];
      const SAMPLE_RESEARCH = [
        { title: 'Research Note: Local AI Trends 2026', url: 'https://example.com/research/local-ai', shortDesc: 'An analysis of on-device model inference improvements over the past 12 months.' },
        { title: 'Research Note: Privacy-preserving Architectures', url: 'https://example.com/research/privacy', shortDesc: 'Survey of approaches that minimise data leaving the device without sacrificing capability.' },
      ];
      for (const item of SAMPLE_NEWS) {
        await publishItem({ producerWorkerId: 'core.news', itemType: 'news.article', title: item.title, shortDesc: item.shortDesc, url: item.url, tags: ['sample'], state: 'queued' });
      }
      for (const item of SAMPLE_RESEARCH) {
        await publishItem({ producerWorkerId: 'core.research', itemType: 'research.note', title: item.title, shortDesc: item.shortDesc, url: item.url, tags: ['sample'], state: 'queued' });
      }
      await recordEventSafe({ category: 'admin', action: 'sample_data_seeded', summary: 'Sample data seeded for demo purposes.', metadata: { newsCount: SAMPLE_NEWS.length, researchCount: SAMPLE_RESEARCH.length } });
      return sendJson(res, 200, { ok: true, seeded: SAMPLE_NEWS.length + SAMPLE_RESEARCH.length });
    }

    // Install a worker from the community store
    if (url.pathname === '/api/store/install' && req.method === 'POST') {
      const body = await readJsonBody(req, StoreInstallBodySchema);
      const result = await installWorkerFromStore(body.id, body.bundleUrl, body.bundleSha256);
      await recordEventSafe({
        category: 'admin',
        action: 'worker_installed_from_store',
        summary: `Worker "${result.manifest.name}" (${result.manifest.id}) installed from the store.`,
        metadata: { workerId: result.manifest.id, sourcePath: result.sourcePath },
      });
      return sendJson(res, 200, { ok: true, workerId: result.manifest.id });
    }

    if (url.pathname === '/api/lmstudio' && req.method === 'POST') {
      const body = await readJsonBody(req, LmStudioActionBodySchema);
      const action = body.action;
      await refreshActiveLocalProviderModels();
      const defaultModel = getDefaultModel();

      if (action === 'pin-load') {
        const alias = body.alias?.trim() || defaultModel.alias;
        await pinAndLoadModel(alias);
        await recordEventSafe({
          category: 'admin',
          action: 'lmstudio_model_pinned',
          summary: `LM Studio model pinned and loaded: ${alias}`,
          metadata: { alias },
        });
        return sendJson(res, 200, { ok: true });
      }

      if (action === 'pin-unload') {
        await unpinAndUnloadModel();
        await recordEventSafe({
          category: 'admin',
          action: 'lmstudio_model_unpinned',
          summary: 'LM Studio pin cleared and all models unloaded.',
        });
        return sendJson(res, 200, { ok: true });
      }

      await withLocalProvider(async (provider) => {
        if (action === 'start' && provider.startRuntime) {
          await provider.startRuntime();
        } else if (action === 'stop' && provider.stopRuntime) {
          await provider.stopRuntime();
        } else if (action === 'load-default' && provider.loadModel) {
          if (defaultModel.provider !== provider.providerId) {
            throw new BadRequestError(`Default model ${defaultModel.alias} is not served by the active local provider.`);
          }
          if (provider.startRuntime) await provider.startRuntime();
          await provider.loadModel(defaultModel.id);
        } else if (action === 'unload-default' && provider.unloadModel) {
          if (defaultModel.provider !== provider.providerId) {
            throw new BadRequestError(`Default model ${defaultModel.alias} is not served by the active local provider.`);
          }
          await provider.unloadModel(defaultModel.id);
        } else if (action === 'unload-all' && provider.unloadAllModels) {
          await provider.unloadAllModels();
        }
      });

      return sendJson(res, 200, { ok: true });
    }

    // -----------------------------------------------------------------------
    // Action runtime (Workstream 5)
    // -----------------------------------------------------------------------

    if (url.pathname === '/api/actions/pending' && req.method === 'GET') {
      const pending = await listPendingActionRequests();
      return sendJson(res, 200, { pendingActions: pending });
    }

    if (url.pathname === '/api/actions' && req.method === 'GET') {
      const workerId = url.searchParams.get('workerId') ?? undefined;
      const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
      const actions = await listActionRequests({ workerId, limit });
      return sendJson(res, 200, { actions });
    }

    // ── Wizard state ─────────────────────────────────────────────────────────
    if (url.pathname === '/api/wizard/state' && req.method === 'GET') {
      const state = await loadKvJson<{ step?: number; completed?: boolean }>('wizard.state') ?? {};
      const envExists = await fs.access(path.join(process.cwd(), '.env')).then(() => true, () => false);
      const completed = envExists ? (state.completed ?? false) : false;
      return sendJson(res, 200, { step: state.step ?? 0, completed });
    }

    if (url.pathname === '/api/wizard/state' && req.method === 'POST') {
      const body = await readJsonBody(req, z.object({
        step: z.number().int().min(0).max(5).optional(),
        completed: z.boolean().optional(),
      }).strict());
      const prev = await loadKvJson<{ step?: number; completed?: boolean }>('wizard.state') ?? {};
      const next = { ...prev, ...body };
      await saveKvJson('wizard.state', next);
      return sendJson(res, 200, { ok: true, ...next });
    }

    const actionDecideMatch = url.pathname.match(/^\/api\/actions\/([^/]+)\/(approve|reject)$/);
    if (actionDecideMatch && req.method === 'POST') {
      const requestId = decodeURIComponent(actionDecideMatch[1]);
      const decision = actionDecideMatch[2] as 'approve' | 'reject';
      await readJsonBody(req, ActionDecisionBodySchema).catch(() => ({}));
      const updated = decision === 'approve'
        ? await approveActionRequest(requestId)
        : await rejectActionRequest(requestId);
      if (!updated) {
        return sendJson(res, 404, { error: 'Action request not found or already decided.' });
      }
      await recordEventSafe({
        category: 'actions',
        action: `action-${decision}d`,
        severity: 'info',
        summary: `Action request ${requestId} ${decision}d by operator.`,
        metadata: { requestId, workerId: updated.workerId, label: updated.label },
      });
      return sendJson(res, 200, { ok: true, action: updated });
    }

    if (req.method === 'GET') {
      return serveStatic(url.pathname, res);
    }

    return sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof BadRequestError) {
      return sendJson(res, err.statusCode, { error: message });
    }
    console.error('[Admin] Request failed:', err);
    return sendJson(res, 500, { error: message });
  }
}

/**
 * Build the dashboard "shell" — the minimum payload needed to render the tab bar,
 * overview header, worker list, and integrations health. Heavy sections (queue,
 * cron runs, events, backups, worker dashboard data, loaded models) are fetched
 * lazily by per-tab endpoints below. Keeping this fast is what makes the console
 * snappy to open.
 */
async function buildDashboardState(): Promise<DashboardState> {
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
  });
}

async function countLoadedModels(localProvider: ProviderAdapter | null | undefined): Promise<number> {
  if (!localProvider?.listLoadedModels) return 0;
  try {
    const models = await localProvider.listLoadedModels();
    return models.length;
  } catch {
    return 0;
  }
}

async function buildQueueSection(): Promise<QueueSection> {
  const queue = await loadQueueSnapshot();
  return QueueSectionSchema.parse({ queue });
}

async function buildCronRunsSection(): Promise<CronRunsSection> {
  const runs = await listSchedulerRuns(100);
  return CronRunsSectionSchema.parse({ runs });
}

async function buildEventsSection(): Promise<EventsSection> {
  const events = await listRecentEventsSafe(50);
  return EventsSectionSchema.parse({ events });
}

async function buildBackupsSection(): Promise<BackupsSection> {
  const backups = await listAppBackups(20);
  return BackupsSectionSchema.parse({ backups });
}

async function buildWorkerDataSection(): Promise<WorkerDataSection> {
  const workerDashboardData = await loadRegisteredWorkerDashboardData();
  return WorkerDataSectionSchema.parse({ workerData: workerDashboardData });
}

async function buildLocalEmbeddingModelsSection(): Promise<LocalEmbeddingModelsSection> {
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

async function buildLmStudioModelsSection(): Promise<LmStudioModelsSection> {
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
function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.min(idx, sorted.length - 1)];
}

async function buildJobMetricsSection(): Promise<JobMetricsResponse> {
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

async function recordWorkerHealthEvents(workers: DashboardState['workers']): Promise<void> {
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
      if (worker.healthState === 'missing_credentials' || worker.healthState === 'missing_dependency' || worker.healthState === 'degraded') {
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

function workerCatalog(localWorkers: DiscoveredLocalWorker[]): Map<string, CatalogWorker> {
  const catalog = new Map<string, CatalogWorker>();
  for (const worker of listWorkers()) {
    catalog.set(worker.id, worker);
  }
  for (const worker of localWorkers) {
    const loaded = catalog.get(worker.manifest.id);
    catalog.set(
      worker.manifest.id,
      loaded
        ? {
            ...loaded,
            chatPrompts: loaded.chatPrompts ?? worker.manifest.chatPrompts,
            sourcePath: worker.sourcePath,
          }
        : { ...worker.manifest, sourcePath: worker.sourcePath },
    );
  }
  return catalog;
}

async function uploadLocalWorkerZip(req: IncomingMessage): Promise<DiscoveredLocalWorker> {
  const filename = headerValue(req.headers['x-worker-filename']) || 'worker.zip';
  if (!filename.toLowerCase().endsWith('.zip')) {
    throw new BadRequestError('Upload must be a .zip file.');
  }

  const body = await readRawBody(req, MAX_WORKER_UPLOAD_BYTES);
  if (body.length === 0) {
    throw new BadRequestError('Uploaded worker zip is empty.');
  }

  const installRoot = path.resolve(config.workerPaths[0] || './workers/local');
  const targetName = safeWorkerFolderName(filename.replace(/\.zip$/i, ''));
  const targetDir = path.join(installRoot, targetName);
  if (!isPathInside(installRoot, targetDir) || targetDir === installRoot) {
    throw new BadRequestError('Invalid worker upload target.');
  }

  await fs.mkdir(installRoot, { recursive: true });
  if (await pathExists(targetDir)) {
    throw new BadRequestError(`A local worker folder named ${targetName} already exists.`);
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bfrost-worker-upload-'));
  const zipPath = path.join(tempRoot, 'worker.zip');
  const extractDir = path.join(tempRoot, 'extract');

  try {
    await fs.writeFile(zipPath, body);
    await fs.mkdir(extractDir, { recursive: true });
    await safeExtractZip(zipPath, extractDir);

    const result = await discoverLocalWorkerResult([extractDir]);
    if (result.workers.length !== 1) {
      const detail = result.issues[0]?.message ?? 'Zip must contain exactly one worker.json manifest.';
      throw new BadRequestError(detail);
    }

    const worker = result.workers[0];
    const existing = workerCatalog(await discoverLocalWorkers()).get(worker.manifest.id);
    if (existing) {
      throw new BadRequestError(`A worker with id ${worker.manifest.id} is already installed.`);
    }

    const workerDir = path.dirname(path.resolve(worker.sourcePath));
    if (!isPathInside(extractDir, workerDir)) {
      throw new BadRequestError('Worker manifest must stay inside the uploaded zip contents.');
    }

    await moveDirectory(workerDir, targetDir);
    const installed = await discoverLocalWorkers([targetDir]);
    const uploaded = installed.find((item) => item.manifest.id === worker.manifest.id);
    if (!uploaded) {
      throw new BadRequestError('Uploaded worker could not be discovered after installation.');
    }
    await rememberSeenWorkers([{ id: uploaded.manifest.id, builtIn: false, sourcePath: uploaded.sourcePath }]);
    return uploaded;
  } catch (err) {
    await fs.rm(targetDir, { recursive: true, force: true });
    if (err instanceof BadRequestError) {
      throw err;
    }
    throw new BadRequestError(`Worker upload failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

/**
 * Download a worker package from the community store, verify its SHA-256 hash,
 * extract the tarball, and install it into `workers/local/<id>/`.
 */
async function installWorkerFromStore(
  workerId: string,
  bundleUrl: string,
  expectedSha256: string,
): Promise<DiscoveredLocalWorker> {
  const MAX_BUNDLE_BYTES = 25 * 1024 * 1024;

  // Validate the worker id before touching the filesystem.
  const safeId = safeWorkerFolderName(workerId);
  if (!safeId) throw new BadRequestError('Invalid worker id.');

  const installRoot = path.resolve(config.workerPaths[0] || './workers/local');
  const targetDir = path.join(installRoot, safeId);
  if (!isPathInside(installRoot, targetDir) || targetDir === installRoot) {
    throw new BadRequestError('Invalid worker install path.');
  }

  if (await pathExists(targetDir)) {
    throw new BadRequestError(`Worker "${workerId}" is already installed.`);
  }

  // Download the bundle.
  let response: Response;
  try {
    response = await fetch(bundleUrl, { signal: AbortSignal.timeout(60_000) });
  } catch (err) {
    throw new BadRequestError(`Could not download worker bundle: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!response.ok) {
    throw new BadRequestError(`Bundle download failed: HTTP ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const body = Buffer.from(arrayBuffer);
  if (body.length === 0) throw new BadRequestError('Downloaded bundle is empty.');
  if (body.length > MAX_BUNDLE_BYTES) throw new BadRequestError('Bundle exceeds 25 MB limit.');

  // Verify SHA-256.
  const actualHash = createHash('sha256').update(body).digest('hex');
  if (actualHash.toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new BadRequestError(`Bundle SHA-256 mismatch. Expected ${expectedSha256}, got ${actualHash}.`);
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bfrost-store-install-'));
  try {
    const archivePath = path.join(tempRoot, 'bundle.tar.gz');
    const extractDir = path.join(tempRoot, 'extract');

    await fs.writeFile(archivePath, body);
    await fs.mkdir(extractDir, { recursive: true });

    // Extract with system tar, rejecting traversal and symlink entries first.
    try {
      await safeExtractTarGz(archivePath, extractDir);
    } catch (err) {
      if (err instanceof BadRequestError) throw err;
      throw new BadRequestError(`Failed to extract bundle: ${err instanceof Error ? (err as any).stderr || err.message : String(err)}`);
    }

    const result = await discoverLocalWorkerResult([extractDir]);
    if (result.workers.length !== 1) {
      const detail = result.issues[0]?.message ?? 'Bundle must contain exactly one worker manifest.';
      throw new BadRequestError(detail);
    }

    const worker = result.workers[0];
    if (worker.manifest.id !== workerId) {
      throw new BadRequestError(
        `Bundle contains worker id "${worker.manifest.id}" but expected "${workerId}".`,
      );
    }

    const existing = workerCatalog(await discoverLocalWorkers()).get(worker.manifest.id);
    if (existing) {
      throw new BadRequestError(`Worker "${worker.manifest.id}" is already installed.`);
    }

    const workerDir = path.dirname(path.resolve(worker.sourcePath));
    if (!isPathInside(extractDir, workerDir)) {
      throw new BadRequestError('Worker manifest must stay inside the bundle contents.');
    }

    await fs.mkdir(installRoot, { recursive: true });
    await moveDirectory(workerDir, targetDir);

    const installed = await discoverLocalWorkers([targetDir]);
    const found = installed.find((item) => item.manifest.id === workerId);
    if (!found) {
      throw new BadRequestError('Worker could not be discovered after installation.');
    }
    await rememberSeenWorkers([{ id: found.manifest.id, builtIn: false, sourcePath: found.sourcePath }]);
    return found;
  } catch (err) {
    await fs.rm(targetDir, { recursive: true, force: true });
    if (err instanceof BadRequestError) throw err;
    throw new BadRequestError(`Store install failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

async function serveWorkerDashboardBundle(
  workerId: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const localWorkers = await discoverLocalWorkers();
  const worker = localWorkers.find((entry) => entry.manifest.id === workerId);
  if (!worker || !(worker.dashboardEntrypoint || worker.dashboardSource)) {
    return sendJson(res, 404, { error: 'Worker has no dashboard bundle.' });
  }

  const workerDir = path.dirname(path.resolve(worker.sourcePath));
  const entrypoint = worker.dashboardEntrypoint ?? path.join('dist', 'dashboard.js');

  if (worker.dashboardSource) {
    try {
      await compileLocalWorkerDashboard({
        workerDir,
        source: worker.dashboardSource,
        output: entrypoint,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return sendJson(res, 500, { error: `Dashboard bundle compile failed: ${message}` });
    }
  }

  const bundlePath = path.resolve(workerDir, entrypoint);
  let stat;
  try {
    stat = await fs.stat(bundlePath);
  } catch {
    return sendJson(res, 404, { error: 'Dashboard bundle not found on disk.' });
  }

  // ETag derived from the compiled bundle's mtime — invalidates whenever esbuild
  // re-runs, so the browser stops serving a stale cached IIFE the moment a worker
  // author edits and reloads.
  const etag = `W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.statusCode = 304;
    res.end();
    return;
  }

  const body = await fs.readFile(bundlePath);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('ETag', etag);
  res.setHeader('Content-Length', String(body.length));
  res.end(body);
}

async function deleteLocalWorkerFiles(sourcePath: string): Promise<void> {
  const resolvedSource = path.resolve(sourcePath);
  const workerDir = path.dirname(resolvedSource);
  const roots = config.workerPaths.map((workerPath) => path.resolve(workerPath));
  const owningRoot = roots.find((root) => resolvedSource === root || isPathInside(root, resolvedSource));

  if (!owningRoot) {
    throw new BadRequestError('Local worker files are outside configured worker paths.');
  }

  if (workerDir === owningRoot) {
    await fs.rm(resolvedSource, { force: true });
    return;
  }

  if (!isPathInside(owningRoot, workerDir)) {
    throw new BadRequestError('Refusing to delete a path outside the configured worker directory.');
  }

  await fs.rm(workerDir, { recursive: true, force: true });
}

/**
 * Reject archive entry names that could escape the extraction directory: absolute paths
 * (`/etc/...`, `C:\...`) and parent-directory traversal (`../`). Run on the archive *listing*
 * before extraction so nothing dangerous is ever written to disk (zip-slip / tar-slip).
 */
export function assertSafeArchiveNames(names: string[]): void {
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const normalized = name.replace(/\\/g, '/');
    if (path.isAbsolute(normalized) || /^[a-zA-Z]:\//.test(normalized)) {
      throw new BadRequestError(`Archive contains an absolute path, which is not allowed: ${name}`);
    }
    if (normalized.split('/').some((segment) => segment === '..')) {
      throw new BadRequestError(`Archive contains a path-traversal entry, which is not allowed: ${name}`);
    }
  }
}

/**
 * Reject symlink entries in a verbose archive listing. A symlink whose target is absolute or
 * traverses upward lets a *later* entry be written through it to land outside the temp dir —
 * a name-only scan misses this because the symlink's own name is innocuous. Worker payloads
 * never legitimately contain symlinks. Both `tar -tvzf` and `unzip -Z` start each entry line
 * with a type/permission string whose first character is `l` for a symlink.
 */
export function assertNoSymlinkEntries(verboseListingLines: string[]): void {
  for (const line of verboseListingLines) {
    if (/^l/.test(line.trimStart())) {
      throw new BadRequestError('Archive contains a symbolic link, which is not allowed.');
    }
  }
}

/** Belt-and-suspenders: walk the extracted tree and reject if any entry is a symlink. */
async function assertNoSymlinksOnDisk(dir: string): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      throw new BadRequestError(`Extracted archive contains a symbolic link, which is not allowed: ${entry.name}`);
    }
    if (entry.isDirectory()) {
      await assertNoSymlinksOnDisk(path.join(dir, entry.name));
    }
  }
}

/** Safely extract a zip into `destDir`: vet entry names + symlinks before writing, walk after. */
async function safeExtractZip(zipPath: string, destDir: string): Promise<void> {
  const { stdout: names } = await execFileAsync('unzip', ['-Z1', zipPath]);
  assertSafeArchiveNames(names.split('\n'));
  const { stdout: verbose } = await execFileAsync('unzip', ['-Z', zipPath]);
  assertNoSymlinkEntries(verbose.split('\n'));
  await execFileAsync('unzip', ['-q', zipPath, '-d', destDir]);
  await assertNoSymlinksOnDisk(destDir);
}

/** Safely extract a .tar.gz into `destDir`: vet entry names + symlinks before writing, walk after. */
async function safeExtractTarGz(archivePath: string, destDir: string): Promise<void> {
  const { stdout: names } = await execFileAsync('tar', ['-tzf', archivePath]);
  assertSafeArchiveNames(names.split('\n'));
  const { stdout: verbose } = await execFileAsync('tar', ['-tvzf', archivePath]);
  assertNoSymlinkEntries(verbose.split('\n'));
  await execFileAsync('tar', ['-xzf', archivePath, '-C', destDir]);
  await assertNoSymlinksOnDisk(destDir);
}

async function moveDirectory(source: string, target: string): Promise<void> {
  try {
    await fs.rename(source, target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') {
      throw err;
    }
    await fs.cp(source, target, { recursive: true, errorOnExist: true });
    await fs.rm(source, { recursive: true, force: true });
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function safeWorkerFolderName(value: string): string {
  const safe = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return safe || `worker-${Date.now()}`;
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function listWorkerSummaries(
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
      bfrostEngineRange: worker.bfrostEngineRange,
      builtIn: worker.builtIn,
      deletable: worker.deletable ?? false,
      kind: deriveWorkerKind(worker),
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
function deriveWorkerKind(worker: WorkerManifest): 'feature' | 'channel' | 'provider' {
  if (worker.kind) return worker.kind;
  if (worker.providers && worker.providers.length > 0) return 'provider';
  if (worker.channels && worker.channels.length > 0) return 'channel';
  return 'feature';
}

function workerHealthRequirementStatus(
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

function workerHealthState(
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

function workerHealthDetail(
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

async function readJsonBody<TSchema extends z.ZodTypeAny>(
  req: IncomingMessage,
  schema: TSchema,
): Promise<z.infer<TSchema>> {
  const body = await readRawBody(req, 1024 * 1024);
  const raw = body.length === 0 ? {} : parseJson(body.toString('utf8'));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new BadRequestError(`Invalid request body: ${formatZodError(parsed.error)}`);
  }

  return parsed.data;
}

async function readRawBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      throw new BadRequestError(`Request body is too large; limit is ${Math.floor(maxBytes / 1024 / 1024)} MB.`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new BadRequestError(`Malformed JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
    .join('; ');
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function serveStatic(requestPath: string, res: ServerResponse): Promise<void> {
  const frontendDir = path.join(process.cwd(), 'web/dist');
  const assetPath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
  const normalized = path.normalize(assetPath);
  const resolved = path.resolve(frontendDir, normalized);

  if (!resolved.startsWith(path.resolve(frontendDir))) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  try {
    const stat = await fs.stat(resolved);
    if (stat.isFile()) {
      const body = await fs.readFile(resolved);
      res.writeHead(200, {
        'Content-Type': contentTypeFor(resolved),
        'Content-Length': body.length,
      });
      res.end(body);
      return;
    }
  } catch {
    // Fall through to index.html.
  }

  try {
    const indexHtml = await fs.readFile(path.join(frontendDir, 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(indexHtml);
  } catch {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Frontend not found. Run "npm run build" to generate the React dashboard.');
  }
}

function contentTypeFor(filePath: string): string {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

function isAdminAuthEnabled(): boolean {
  return config.adminPassword.trim().length > 0;
}

function isAuthenticated(req: IncomingMessage): boolean {
  pruneExpiredSessions();
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[SESSION_COOKIE];
  if (!token) {
    return false;
  }

  const expiresAt = sessions.get(token);
  if (!expiresAt || expiresAt <= Date.now()) {
    sessions.delete(token);
    return false;
  }

  return true;
}

function isPasswordValid(value: string): boolean {
  const expected = Buffer.from(config.adminPassword);
  const received = Buffer.from(value);
  if (expected.length === 0 || expected.length !== received.length) {
    return false;
  }
  return timingSafeEqual(expected, received);
}

function createSession(res: ServerResponse): void {
  pruneExpiredSessions();
  const token = randomBytes(24).toString('hex');
  const ttlMs = Math.max(config.adminSessionTtlHours, 1) * 60 * 60 * 1000;
  sessions.set(token, Date.now() + ttlMs);
  appendCookie(res, buildSessionCookie(token, ttlMs));
}

function destroySession(req: IncomingMessage, res: ServerResponse): void {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[SESSION_COOKIE];
  if (token) {
    sessions.delete(token);
  }
  appendCookie(res, `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function buildSessionCookie(token: string, ttlMs: number): string {
  const maxAge = Math.floor(ttlMs / 1000);
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

function appendCookie(res: ServerResponse, cookie: string): void {
  const current = res.getHeader('Set-Cookie');
  if (!current) {
    res.setHeader('Set-Cookie', cookie);
    return;
  }

  if (Array.isArray(current)) {
    res.setHeader('Set-Cookie', [...current, cookie]);
    return;
  }

  res.setHeader('Set-Cookie', [String(current), cookie]);
}

function parseCookies(header: string): Record<string, string> {
  const entries = header
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf('=');
      if (eq === -1) {
        return [part, ''] as const;
      }
      return [part.slice(0, eq), decodeURIComponent(part.slice(eq + 1))] as const;
    });

  return Object.fromEntries(entries);
}

function pruneExpiredSessions(): void {
  const now = Date.now();
  for (const [token, expiresAt] of sessions.entries()) {
    if (expiresAt <= now) {
      sessions.delete(token);
    }
  }
}
