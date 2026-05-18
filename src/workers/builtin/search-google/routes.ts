import path from 'path';
import { z } from 'zod';
import { BadRequestError, type AdminApiRoute } from '../../../admin-route';
import { setGoogleCredentials } from '../../../config';
import { upsertEnvValue } from '../../../env-file';
import { recordEventSafe } from '../../../event-log';
import { setStoredGoogleCredentials } from './client';

const GoogleCredentialsBodySchema = z.object({
  googleApiKey: z.string().optional(),
  googleSearchEngineId: z.string().optional(),
}).strict();

export const googleSearchApiRoutes: AdminApiRoute[] = [
  {
    method: 'POST',
    path: '/api/google-credentials',
    workerIds: ['core.search.google'],
    async handle({ req, readJsonBody }) {
      const body = await readJsonBody(req, GoogleCredentialsBodySchema);
      const envPath = path.join(process.cwd(), '.env');
      const updates: Parameters<typeof setGoogleCredentials>[0] = {};

      if (body.googleApiKey !== undefined && body.googleApiKey.trim()) {
        updates.googleApiKey = body.googleApiKey.trim();
        await upsertEnvValue(envPath, 'GOOGLE_API_KEY', updates.googleApiKey);
      }
      if (body.googleSearchEngineId !== undefined && body.googleSearchEngineId.trim()) {
        updates.googleSearchEngineId = body.googleSearchEngineId.trim();
        await upsertEnvValue(envPath, 'GOOGLE_SEARCH_ENGINE_ID', updates.googleSearchEngineId);
      }

      if (Object.keys(updates).length === 0) {
        throw new BadRequestError('Provide at least one Google credential to save.');
      }

      // Dashboard is the source of truth — persist into the worker's KV namespace so
      // values survive restarts independently of `.env`. We also update the in-memory
      // config and the `.env` file as conveniences for processes that still read them
      // (e.g. legacy scripts), but the worker KV wins on the next searchGoogle() call.
      await setStoredGoogleCredentials(updates);
      setGoogleCredentials(updates);
      await recordEventSafe({
        category: 'admin',
        action: 'google_credentials_updated',
        summary: 'Google API credentials updated.',
        metadata: {
          workerId: 'core.search.google',
          workerName: 'Google Search',
          fields: Object.keys(updates),
        },
      });
      return { status: 200, body: { ok: true } };
    },
  },
];
