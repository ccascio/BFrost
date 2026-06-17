import path from 'path';
import { type IncomingMessage, type ServerResponse } from 'http';
import { HttpRouter } from '../router';
import { readJsonBody, sendJson } from '../responses';
import {
  getDefaultModel,
  setDefaultModel,
  setEmbeddingSettings,
  setAdminPassword,
  setLocalWorkerCodeEnabled,
  setAdminSessionTtlHours,
  setJobLlmTimeoutMs,
} from '../../config';
import { refreshActiveLocalProviderModels } from '../../model-discovery';
import { upsertEnvValue } from '../../env-file';
import { getRegisteredProvider, listRegisteredChannels } from '../../workers/registry';
import { updatePlatformSettings } from '../../admin-config';
import { recordEventSafe } from '../../event-log';
import { getSchedulerSnapshot, reloadSchedulerSchedules, triggerJobNow, updateSchedulerJob } from '../../scheduler';
import { isJobName } from '../../job-runner';
import { sessions } from '../../admin-auth';
import { BadRequestError } from '../../admin-route';
import {
  DefaultModelBodySchema,
  PlatformSettingsBodySchema,
  EmbeddingSettingsBodySchema,
  CoreSettingsBodySchema,
  CronJobUpdateBodySchema,
} from '../../admin-api';

export function registerConfigRoutes(router: HttpRouter): void {
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
}
