import path from 'path';
import { XCredentialsBodySchema } from '../../../admin-api';
import { BadRequestError, type AdminApiRoute } from '../../../admin-route';
import { setXCredentials } from '../../../config';
import { upsertEnvValue } from '../../../env-file';
import { recordEventSafe } from '../../../event-log';
import { updateSchedulerJob } from '../../../scheduler';
import { TweetPostParamsSchema } from './job';
import { setStoredXCredentials } from './x-client';

export const xPublisherApiRoutes: AdminApiRoute[] = [
  {
    method: 'POST',
    path: '/api/x-credentials',
    workerIds: ['core.publisher.x'],
    async handle({ req, readJsonBody }) {
      const body = await readJsonBody(req, XCredentialsBodySchema);
      const envPath = path.join(process.cwd(), '.env');
      const updates: Parameters<typeof setXCredentials>[0] = {};

      const fields: Array<[keyof typeof updates, string]> = [
        ['xConsumerKey', 'X_CONSUMER_KEY'],
        ['xConsumerSecret', 'X_CONSUMER_SECRET'],
        ['xAccessToken', 'X_ACCESS_TOKEN'],
        ['xAccessTokenSecret', 'X_ACCESS_TOKEN_SECRET'],
        ['xUsername', 'X_USERNAME'],
      ];

      for (const [key, envKey] of fields) {
        const value = body[key];
        if (value !== undefined && value.trim()) {
          (updates as Record<string, string>)[key] = value.trim();
          await upsertEnvValue(envPath, envKey, value.trim());
        }
      }

      if (Object.keys(updates).length === 0) {
        throw new BadRequestError('Provide at least one X credential to save.');
      }

      // Mirror Google Search: worker KV is the source of truth, .env stays in sync
      // for first-boot bootstrap and legacy scripts that still read it directly.
      await setStoredXCredentials(updates);
      setXCredentials(updates);
      await recordEventSafe({
        category: 'admin',
        action: 'x_credentials_updated',
        summary: 'X (Twitter) credentials updated.',
        metadata: {
          workerId: 'core.publisher.x',
          workerName: 'X Publisher',
          fields: Object.keys(updates),
        },
      });
      return { status: 200, body: { ok: true } };
    },
  },
  {
    method: 'POST',
    path: '/api/workers/publisher-x/params',
    workerIds: ['core.publisher.x'],
    async handle({ req, readJsonBody }) {
      const raw = await readJsonBody(req, TweetPostParamsSchema);
      await updateSchedulerJob('tweet-post', { params: raw });
      return { status: 200, body: { ok: true } };
    },
  },
];

