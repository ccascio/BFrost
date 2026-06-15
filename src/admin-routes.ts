// Core HTTP route table. Every admin endpoint registers here into the shared
// HttpRouter; worker apiRoutes register the same way (see admin-server).
// Extracted from admin-server.ts (CODE_ROADMAP 1.1).
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
import {
  buildDashboardState, buildQueueSection, buildCronRunsSection, buildEventsSection,
  buildBackupsSection, buildWorkerDataSection, buildLmStudioModelsSection,
  buildLocalEmbeddingModelsSection, buildJobMetricsSection,
} from './admin-dashboard-state';
import {
  workerCatalog, uploadLocalWorkerZip, generateWorkerFromDescription, installWorkerFromStore,
  serveWorkerDashboardBundle, deleteLocalWorkerFiles, withLocalProvider, syncHiddenBuiltIns,
} from './admin-worker-ops';
import { sessions } from './admin-auth';

export function extractTurnText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === 'object' && 'text' in part ? String((part as { text: unknown }).text) : '',
      )
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

export function registerCoreRoutes(router: HttpRouter): void {
  router.add('GET', '/api/dashboard', async (_req, res) => {
    return sendJson(res, 200, await buildDashboardState());
  });
  router.add('GET', '/api/dashboard/queue', async (_req, res) => {
    return sendJson(res, 200, await buildQueueSection());
  });
  router.add('GET', '/api/dashboard/cron-runs', async (_req, res) => {
    return sendJson(res, 200, await buildCronRunsSection());
  });
  router.add('GET', '/api/dashboard/events', async (_req, res) => {
    return sendJson(res, 200, await buildEventsSection());
  });
  router.add('GET', '/api/dashboard/backups', async (_req, res) => {
    return sendJson(res, 200, await buildBackupsSection());
  });
  router.add('GET', '/api/dashboard/worker-data', async (_req, res) => {
    return sendJson(res, 200, await buildWorkerDataSection());
  });
  router.add('GET', '/api/dashboard/lmstudio-models', async (_req, res) => {
    return sendJson(res, 200, await buildLmStudioModelsSection());
  });
  router.add('GET', '/api/dashboard/local-embedding-models', async (_req, res) => {
    return sendJson(res, 200, await buildLocalEmbeddingModelsSection());
  });
  router.add('GET', '/api/dashboard/job-metrics', async (_req, res) => {
    return sendJson(res, 200, await buildJobMetricsSection());
  });

  router.add('GET', '/api/workers/:id/dashboard.js', async (req, res, { params }) => {
    return serveWorkerDashboardBundle(params.id, req, res);
  });

  router.add('POST', '/api/workers/rescan', async (_req, res) => {
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
  });

  router.add('POST', '/api/workers/upload', async (req, res) => {
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
  });

  router.add('POST', '/api/workers/generate', async (req, res) => {
    const body = await readJsonBody(req, GenerateWorkerBodySchema);
    const result = await generateWorkerFromDescription(body.description);
    await recordEventSafe({
      category: 'worker',
      action: 'worker_generated',
      summary: `Generated ${result.spec.role} worker "${result.spec.displayName}" from a description.`,
      metadata: { workerId: result.spec.id, role: result.spec.role, enabled: result.enabled },
    });
    return sendJson(res, 200, {
      worker: { id: result.spec.id, displayName: result.spec.displayName, role: result.spec.role },
      spec: result.spec,
      enabled: result.enabled,
      note: result.note,
      dashboard: await buildDashboardState(),
    });
  });

  router.add('POST', '/api/chat', async (req, res) => {
    const body = await readJsonBody(req, ChatMessageBodySchema);
    const response = await processChannelMessage({
      channel: 'dashboard',
      conversationId: body.conversationId ?? 'dashboard-admin',
      userId: 'admin',
      username: 'dashboard',
      text: body.message,
      projectId: body.projectId,
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
  });

  router.add('POST', '/api/provider-ping', async (_req, res) => {
    const models = availableModels.filter((m) => m.provider !== 'demo');
    if (models.length === 0) {
      return sendJson(res, 400, { error: 'No real model provider configured.' });
    }
    const model = models[0];
    try {
      const result = await generateText({
        model: getChatModel(model),
        messages: [{ role: 'user', content: 'Say hello and tell me your name in one short sentence.' }],
      });
      return sendJson(res, 200, { ok: true, model: model.label, response: result.text.trim() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return sendJson(res, 200, { ok: false, error: msg });
    }
  });

  router.add('GET', '/api/chats', async (_req, res) => {
    return sendJson(res, 200, { threads: listThreads('dashboard') });
  });

  router.add('GET', '/api/chats/:id', async (_req, res, { params }) => {
    const conversationId = params.id;
    const thread = getThread(conversationId);
    if (!thread) return sendJson(res, 404, { error: 'Chat not found' });
    const turns = getFullHistory(thread.chatId)
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map((message) => ({ role: message.role, text: extractTurnText(message.content) }))
      .filter((turn) => turn.text.length > 0);
    return sendJson(res, 200, { thread, turns });
  });
  router.add('PATCH', '/api/chats/:id', async (req, res, { params }) => {
    const conversationId = params.id;
    const body = await readJsonBody(req, ChatThreadUpdateBodySchema);
    if (!getThread(conversationId)) return sendJson(res, 404, { error: 'Chat not found' });
    if (body.title !== undefined) renameThread(conversationId, body.title);
    const updated =
      body.projectId !== undefined
        ? assignThreadProject(conversationId, body.projectId)
        : getThread(conversationId);
    return sendJson(res, 200, { thread: updated });
  });
  router.add('DELETE', '/api/chats/:id', async (_req, res, { params }) => {
    if (!deleteThread(params.id)) return sendJson(res, 404, { error: 'Chat not found' });
    return sendJson(res, 200, { ok: true });
  });

  router.add('GET', '/api/projects', async (_req, res) => {
    return sendJson(res, 200, { projects: listProjects() });
  });
  router.add('POST', '/api/projects', async (req, res) => {
    const body = await readJsonBody(req, ProjectCreateBodySchema);
    const project = createProject(body.name);
    return sendJson(res, 201, { project });
  });
  router.add('PATCH', '/api/projects/:id', async (req, res, { params }) => {
    const body = await readJsonBody(req, ProjectRenameBodySchema);
    const updated = renameProject(params.id, body.name);
    if (!updated) return sendJson(res, 404, { error: 'Project not found' });
    return sendJson(res, 200, { project: updated });
  });
  router.add('DELETE', '/api/projects/:id', async (_req, res, { params }) => {
    const projectId = params.id;
    if (!getProject(projectId)) return sendJson(res, 404, { error: 'Project not found' });
    deleteProject(projectId);
    // Detach threads so the chat UI doesn't carry a dangling project id.
    clearProjectFromThreads(projectId);
    return sendJson(res, 200, { ok: true });
  });

  router.add('POST', '/api/default-model', async (req, res) => {
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
  });

  router.add('POST', '/api/cloud-api-keys', async (req, res) => {
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
  });

  router.add('POST', '/api/platform-settings', async (req, res) => {
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
  });

  router.add('POST', '/api/embedding-settings', async (req, res) => {
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
  });

  router.add('POST', '/api/core-settings', async (req, res) => {
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
  });

  // cron-jobs accepts `/api/cron-jobs/:job` and `/api/cron-jobs/:job/:action`.
  const handleCronJob = async (
    req: IncomingMessage,
    res: ServerResponse,
    jobName: string,
    action: string,
  ): Promise<void> => {
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
  };
  router.add('POST', '/api/cron-jobs/:job', async (req, res, { params }) => {
    return handleCronJob(req, res, params.job, '');
  });
  router.add('POST', '/api/cron-jobs/:job/:action', async (req, res, { params }) => {
    return handleCronJob(req, res, params.job, params.action);
  });

  router.add('POST', '/api/workers/:id', async (req, res, { params }) => {
    const workerId = params.id;
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
  });

  router.add('DELETE', '/api/workers/:id', async (_req, res, { params }) => {
    const workerId = params.id;
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
  });

  router.add('POST', '/api/queue-item', async (req, res) => {
    const body = await readJsonBody(req, QueueItemActionBodySchema);

    await updateDashboardQueueItem(body.id, body.action);
    return sendJson(res, 200, await buildDashboardState());
  });

  router.add('POST', '/api/backups', async (_req, res) => {
    const backup = await createAppBackup();
    await recordEventSafe({
      category: 'admin',
      action: 'backup_created',
      summary: `SQLite backup created: ${backup.file}`,
      metadata: { file: backup.file, path: backup.path, sizeBytes: backup.sizeBytes },
    });
    return sendJson(res, 200, { ok: true });
  });

  // Auto-backup settings
  router.add('GET', '/api/backups/settings', async (_req, res) => {
    const settings = await getAutoBackupSettings();
    return sendJson(res, 200, settings);
  });

  router.add('PATCH', '/api/backups/settings', async (req, res) => {
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
  });

  // Restore from backup (marks pending; applied on next startup)
  router.add('POST', '/api/backups/:file/restore', async (_req, res, { params }) => {
    const file = params.file;
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
  });

  // Cancel a pending restore
  router.add('POST', '/api/backups/restore-cancel', async (_req, res) => {
    await cancelPendingRestore();
    return sendJson(res, 200, { ok: true });
  });

  // Factory reset — wipes selected categories of state, then exits for restart
  router.add('POST', '/api/admin/factory-reset', async (req, res) => {
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
  });

  // Disable all workers (safe-mode boot helper)
  router.add('POST', '/api/admin/disable-all-workers', async (_req, res) => {
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
  });

  // Seed the dashboard with sample data for first-time users
  router.add('POST', '/api/admin/seed-sample-data', async (_req, res) => {
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
  });

  // Install a worker from the community store
  router.add('POST', '/api/store/install', async (req, res) => {
    const body = await readJsonBody(req, StoreInstallBodySchema);
    const result = await installWorkerFromStore(body.id, body.bundleUrl, body.bundleSha256);
    await recordEventSafe({
      category: 'admin',
      action: 'worker_installed_from_store',
      summary: `Worker "${result.manifest.name}" (${result.manifest.id}) installed from the store.`,
      metadata: { workerId: result.manifest.id, sourcePath: result.sourcePath },
    });
    return sendJson(res, 200, { ok: true, workerId: result.manifest.id });
  });

  router.add('POST', '/api/lmstudio', async (req, res) => {
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
  });

  // -----------------------------------------------------------------------
  // Action runtime (Workstream 5)
  // -----------------------------------------------------------------------

  router.add('GET', '/api/actions/pending', async (_req, res) => {
    const pending = await listPendingActionRequests();
    return sendJson(res, 200, { pendingActions: pending });
  });

  router.add('GET', '/api/actions', async (_req, res, { url }) => {
    const workerId = url.searchParams.get('workerId') ?? undefined;
    const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
    const actions = await listActionRequests({ workerId, limit });
    return sendJson(res, 200, { actions });
  });

  // ── Wizard state ─────────────────────────────────────────────────────────
  router.add('GET', '/api/wizard/state', async (_req, res) => {
    const state = await loadKvJson<{ step?: number; completed?: boolean }>('wizard.state') ?? {};
    const envExists = await fs.access(path.join(process.cwd(), '.env')).then(() => true, () => false);
    const completed = envExists ? (state.completed ?? false) : false;
    return sendJson(res, 200, { step: state.step ?? 0, completed });
  });

  router.add('POST', '/api/recipes/apply', async (req, res) => {
    const body = await readJsonBody(req, RecipeApplyBodySchema);
    const recipes = collectRecipes();
    const recipe = recipes.find((r) => r.id === body.recipeId);
    if (!recipe) {
      return sendJson(res, 404, { error: `Recipe "${body.recipeId}" not found.` });
    }

    // Enable each step's worker (builtins only; local workers are not recipe targets).
    for (const step of recipe.steps) {
      await setWorkerEnabled(step.workerId, true, { builtIn: true });
    }
    await reloadSchedulerSchedules();

    // Apply provided inputs to their storage targets.
    const inputs = body.inputs ?? {};
    const missing: string[] = [];
    for (const input of recipe.requiredInputs ?? []) {
      const value = inputs[input.key];
      if (!value?.trim()) {
        missing.push(input.key);
        continue;
      }
      if (input.storage.type === 'worker-kv') {
        const kv = openWorkerKv(input.storage.workerId);
        const current = (await kv.get<Record<string, string>>(input.storage.kvKey)) ?? {};
        await kv.set(input.storage.kvKey, { ...current, [input.storage.kvField]: value.trim() });
      } else if (input.storage.type === 'global-kv-array') {
        const stored = await loadKvJson<Record<string, unknown>>(input.storage.kvKey) ?? {};
        const arr = Array.isArray(stored[input.storage.arrayField]) ? stored[input.storage.arrayField] as string[] : [];
        if (!arr.includes(value.trim())) arr.push(value.trim());
        await saveKvJson(input.storage.kvKey, { ...stored, [input.storage.arrayField]: arr });
      }
    }

    // Apply any platform-level settings.
    if (recipe.platformSettings?.primaryChannelId) {
      await updatePlatformSettings({ primaryChannelId: recipe.platformSettings.primaryChannelId });
    }

    return sendJson(res, 200, {
      ok: true,
      applied: missing.length === 0,
      missing,
      dashboard: await buildDashboardState(),
    });
  });

  router.add('POST', '/api/wizard/state', async (req, res) => {
    const body = await readJsonBody(req, z.object({
      step: z.number().int().min(0).max(5).optional(),
      completed: z.boolean().optional(),
    }).strict());
    const prev = await loadKvJson<{ step?: number; completed?: boolean }>('wizard.state') ?? {};
    const next = { ...prev, ...body };
    await saveKvJson('wizard.state', next);
    return sendJson(res, 200, { ok: true, ...next });
  });

  router.add('POST', '/api/actions/:id/:decision', async (req, res, { params }) => {
    const requestId = params.id;
    const decision = params.decision;
    if (decision !== 'approve' && decision !== 'reject') {
      return sendJson(res, 404, { error: 'Not found' });
    }
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
  });
}
