import path from 'path';
import { z } from 'zod';
import { BadRequestError, type AdminApiRoute } from '../../../admin-route';
import { upsertEnvValue } from '../../../env-file';
import { refreshCloudProviderModels } from '../../../model-discovery';
import { recordEventSafe } from '../../../event-log';
import { setAnthropicApiKey } from './credentials';

const WORKER_ID = 'core.providers.anthropic';

const AnthropicCredentialsBodySchema = z.object({
  apiKey: z.string().min(1),
}).strict();

export const anthropicProviderApiRoutes: AdminApiRoute[] = [
  {
    method: 'POST',
    path: '/api/workers/providers-anthropic/credentials',
    workerIds: [WORKER_ID],
    async handle({ req, readJsonBody }) {
      const body = await readJsonBody(req, AnthropicCredentialsBodySchema);
      const key = body.apiKey.trim();
      if (!key) {
        throw new BadRequestError('apiKey must not be empty.');
      }

      await upsertEnvValue(path.join(process.cwd(), '.env'), 'ANTHROPIC_API_KEY', key);
      setAnthropicApiKey(key);
      await refreshCloudProviderModels();

      await recordEventSafe({
        category: 'admin',
        action: 'cloud_api_keys_updated',
        summary: 'Anthropic API key updated.',
        metadata: { workerId: WORKER_ID, openaiUpdated: false, anthropicUpdated: true },
      });

      return { status: 200, body: { ok: true } };
    },
  },
];
