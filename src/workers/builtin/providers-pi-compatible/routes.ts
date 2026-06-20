import path from 'path';
import { z } from 'zod';
import { BadRequestError, type AdminApiRoute } from '../../../admin-route';
import { upsertEnvValue } from '../../../env-file';
import { recordEventSafe } from '../../../event-log';
import { refreshCloudProviderModels } from '../../../model-discovery';
import {
  setAnthropicApiKey,
  setAnthropicAuthMode,
  setAnthropicSubscriptionModel,
} from '../providers-anthropic/credentials';
import {
  setOpenAIApiKey,
  setOpenAIAuthMode,
  setOpenAICodexCliModel,
} from '../providers-openai/credentials';
import { PI_COMPATIBLE_PROVIDERS, PI_COMPATIBLE_WORKER_ID } from './catalog';
import { setCloudflareAccountId, setPiProviderApiKey } from './credentials';

const credentialShape = PI_COMPATIBLE_PROVIDERS.reduce<Record<string, z.ZodOptional<z.ZodString>>>(
  (shape, provider) => {
    shape[provider.apiKeySettingKey] = z.string().optional();
    return shape;
  },
  {},
);

const PiCompatibleCredentialsBodySchema = z.object({
  ...credentialShape,
  anthropicApiKey: z.string().optional(),
  anthropicAuthMode: z.enum(['api', 'subscription']).optional(),
  anthropicSubscriptionModel: z.string().optional(),
  cloudflareAccountId: z.string().optional(),
  openaiApiKey: z.string().optional(),
  openaiAuthMode: z.enum(['api', 'subscription']).optional(),
  openaiSubscriptionModel: z.string().optional(),
}).strict();

export const piCompatibleProviderApiRoutes: AdminApiRoute[] = [
  {
    method: 'POST',
    path: '/api/workers/providers-pi-compatible/credentials',
    workerIds: [PI_COMPATIBLE_WORKER_ID],
    async handle({ req, readJsonBody }) {
      const body = await readJsonBody(req, PiCompatibleCredentialsBodySchema);
      const values = body as Record<string, string | undefined>;
      const envPath = path.join(process.cwd(), '.env');
      const providersUpdated: string[] = [];
      let firstPartyUpdated = false;

      for (const provider of PI_COMPATIBLE_PROVIDERS) {
        const rawValue = values[provider.apiKeySettingKey];
        if (rawValue === undefined) continue;
        const key = rawValue.trim();
        if (!key) continue;
        await upsertEnvValue(envPath, provider.envVar, key);
        setPiProviderApiKey(provider.id, key);
        providersUpdated.push(provider.id);
      }

      if (body.openaiAuthMode !== undefined) {
        await upsertEnvValue(envPath, 'BFROST_OPENAI_AUTH_MODE', body.openaiAuthMode);
        setOpenAIAuthMode(body.openaiAuthMode);
        providersUpdated.push('openai');
        firstPartyUpdated = true;
      }
      const openaiApiKey = body.openaiApiKey?.trim() ?? '';
      if (openaiApiKey) {
        await upsertEnvValue(envPath, 'OPENAI_API_KEY', openaiApiKey);
        setOpenAIApiKey(openaiApiKey);
        if (!providersUpdated.includes('openai')) providersUpdated.push('openai');
        firstPartyUpdated = true;
      }
      const openaiSubscriptionModel = body.openaiSubscriptionModel?.trim() ?? '';
      if (openaiSubscriptionModel) {
        await upsertEnvValue(envPath, 'BFROST_OPENAI_CODEX_MODEL', openaiSubscriptionModel);
        setOpenAICodexCliModel(openaiSubscriptionModel);
        if (!providersUpdated.includes('openai')) providersUpdated.push('openai');
        firstPartyUpdated = true;
      }

      if (body.anthropicAuthMode !== undefined) {
        await upsertEnvValue(envPath, 'BFROST_ANTHROPIC_AUTH_MODE', body.anthropicAuthMode);
        setAnthropicAuthMode(body.anthropicAuthMode);
        providersUpdated.push('anthropic');
        firstPartyUpdated = true;
      }
      const anthropicApiKey = body.anthropicApiKey?.trim() ?? '';
      if (anthropicApiKey) {
        await upsertEnvValue(envPath, 'ANTHROPIC_API_KEY', anthropicApiKey);
        setAnthropicApiKey(anthropicApiKey);
        if (!providersUpdated.includes('anthropic')) providersUpdated.push('anthropic');
        firstPartyUpdated = true;
      }
      const anthropicSubscriptionModel = body.anthropicSubscriptionModel?.trim() ?? '';
      if (anthropicSubscriptionModel) {
        await upsertEnvValue(envPath, 'BFROST_ANTHROPIC_SUBSCRIPTION_MODEL', anthropicSubscriptionModel);
        setAnthropicSubscriptionModel(anthropicSubscriptionModel);
        if (!providersUpdated.includes('anthropic')) providersUpdated.push('anthropic');
        firstPartyUpdated = true;
      }

      const accountId = body.cloudflareAccountId?.trim() ?? '';
      if (body.cloudflareAccountId !== undefined && !accountId) {
        throw new BadRequestError('cloudflareAccountId must not be empty when provided.');
      }
      if (accountId) {
        await upsertEnvValue(envPath, 'CLOUDFLARE_ACCOUNT_ID', accountId);
        setCloudflareAccountId(accountId);
      }

      if (providersUpdated.length === 0 && !accountId && !firstPartyUpdated) {
        throw new BadRequestError('Provide at least one provider credential to save.');
      }

      await refreshCloudProviderModels();
      await recordEventSafe({
        category: 'admin',
        action: 'cloud_api_keys_updated',
        summary: 'Additional LLM provider credentials updated.',
        metadata: {
          workerId: PI_COMPATIBLE_WORKER_ID,
          providersUpdated,
          cloudflareAccountIdUpdated: Boolean(accountId),
        },
      });

      return { status: 200, body: { ok: true } };
    },
  },
];
