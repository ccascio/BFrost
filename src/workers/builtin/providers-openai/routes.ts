import path from 'path';
import { z } from 'zod';
import { BadRequestError, type AdminApiRoute } from '../../../admin-route';
import { upsertEnvValue } from '../../../env-file';
import { refreshCloudProviderModels } from '../../../model-discovery';
import { recordEventSafe } from '../../../event-log';
import { setOpenAIApiKey } from './credentials';

const WORKER_ID = 'core.providers.openai';

const OpenAICredentialsBodySchema = z.object({
  apiKey: z.string().min(1),
}).strict();

export const openaiProviderApiRoutes: AdminApiRoute[] = [
  {
    method: 'POST',
    path: '/api/workers/providers-openai/credentials',
    workerIds: [WORKER_ID],
    async handle({ req, readJsonBody }) {
      const body = await readJsonBody(req, OpenAICredentialsBodySchema);
      const key = body.apiKey.trim();
      if (!key) {
        throw new BadRequestError('apiKey must not be empty.');
      }

      await upsertEnvValue(path.join(process.cwd(), '.env'), 'OPENAI_API_KEY', key);
      setOpenAIApiKey(key);
      await refreshCloudProviderModels();

      await recordEventSafe({
        category: 'admin',
        action: 'cloud_api_keys_updated',
        summary: 'OpenAI API key updated.',
        metadata: { workerId: WORKER_ID, openaiUpdated: true, anthropicUpdated: false },
      });

      return { status: 200, body: { ok: true } };
    },
  },
];
