import path from 'path';
import { z } from 'zod';
import { BadRequestError, type AdminApiRoute } from '../../../admin-route';
import { config, setAllowedUserId } from '../../../config';
import { upsertEnvValue } from '../../../env-file';
import { recordEventSafe } from '../../../event-log';
import { resolveTelegramBotToken, setStoredTelegramBotToken } from './credentials';

const TelegramSettingsBodySchema = z.object({
  telegramBotToken: z.string().optional(),
  allowedUserId: z.string().optional(),
}).strict();

const TelegramVerifyBodySchema = z.object({
  // Optional override — if absent, the stored token is used.
  telegramBotToken: z.string().optional(),
}).strict();

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

async function callTelegramApi<T>(token: string, method: string, body?: Record<string, unknown>): Promise<TelegramApiResponse<T>> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return (await response.json()) as TelegramApiResponse<T>;
}

interface TelegramBotIdentity {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export const telegramChannelApiRoutes: AdminApiRoute[] = [
  {
    method: 'POST',
    path: '/api/telegram-settings',
    workerIds: ['core.channels.telegram'],
    async handle({ req, readJsonBody }) {
      const body = await readJsonBody(req, TelegramSettingsBodySchema);
      const envPath = path.join(process.cwd(), '.env');
      const changedFields: string[] = [];

      if (body.telegramBotToken !== undefined && body.telegramBotToken.trim()) {
        const token = body.telegramBotToken.trim();
        await setStoredTelegramBotToken(token);
        await upsertEnvValue(envPath, 'TELEGRAM_BOT_TOKEN', token);
        changedFields.push('telegramBotToken');
      }
      if (body.allowedUserId !== undefined && body.allowedUserId.trim()) {
        const parsed = Number(body.allowedUserId.trim());
        if (!Number.isInteger(parsed) || parsed <= 0) {
          throw new BadRequestError('allowedUserId must be a positive integer.');
        }
        setAllowedUserId(parsed);
        await upsertEnvValue(envPath, 'ALLOWED_USER_ID', String(parsed));
        changedFields.push('allowedUserId');
      }

      if (changedFields.length === 0) {
        throw new BadRequestError('Provide at least one Telegram setting to save.');
      }

      await recordEventSafe({
        category: 'admin',
        action: 'telegram_settings_updated',
        summary: 'Telegram settings updated.',
        metadata: {
          workerId: 'core.channels.telegram',
          workerName: 'Telegram Channel',
          fields: changedFields,
        },
      });
      return { status: 200, body: { ok: true } };
    },
  },
  {
    method: 'POST',
    path: '/api/workers/telegram/verify-token',
    workerIds: ['core.channels.telegram'],
    async handle({ req, readJsonBody }) {
      const body = await readJsonBody(req, TelegramVerifyBodySchema);
      const token = (body.telegramBotToken?.trim() || (await resolveTelegramBotToken())).trim();
      if (!token) {
        return { status: 200, body: { ok: false, errorMessage: 'No bot token configured yet.', bot: null } };
      }
      try {
        const response = await callTelegramApi<TelegramBotIdentity>(token, 'getMe');
        if (!response.ok || !response.result) {
          return {
            status: 200,
            body: {
              ok: false,
              errorMessage: response.description ?? 'Telegram rejected the token.',
              bot: null,
            },
          };
        }
        return {
          status: 200,
          body: {
            ok: true,
            errorMessage: null,
            bot: {
              id: response.result.id,
              firstName: response.result.first_name,
              username: response.result.username ?? null,
            },
          },
        };
      } catch (err) {
        return {
          status: 200,
          body: {
            ok: false,
            errorMessage: err instanceof Error ? err.message : String(err),
            bot: null,
          },
        };
      }
    },
  },
  {
    method: 'GET',
    path: '/api/workers/telegram/status',
    workerIds: ['core.channels.telegram'],
    async handle() {
      const token = (await resolveTelegramBotToken()).trim();
      const allowedUserId = config.allowedUserId || null;
      if (!token) {
        return {
          status: 200,
          body: {
            tokenConfigured: false,
            allowedUserConfigured: Boolean(allowedUserId),
            allowedUserId,
            bot: null,
            errorMessage: null,
          },
        };
      }
      try {
        const response = await callTelegramApi<TelegramBotIdentity>(token, 'getMe');
        if (!response.ok || !response.result) {
          return {
            status: 200,
            body: {
              tokenConfigured: true,
              allowedUserConfigured: Boolean(allowedUserId),
              allowedUserId,
              bot: null,
              errorMessage: response.description ?? 'Telegram rejected the stored token.',
            },
          };
        }
        return {
          status: 200,
          body: {
            tokenConfigured: true,
            allowedUserConfigured: Boolean(allowedUserId),
            allowedUserId,
            bot: {
              id: response.result.id,
              firstName: response.result.first_name,
              username: response.result.username ?? null,
            },
            errorMessage: null,
          },
        };
      } catch (err) {
        return {
          status: 200,
          body: {
            tokenConfigured: true,
            allowedUserConfigured: Boolean(allowedUserId),
            allowedUserId,
            bot: null,
            errorMessage: err instanceof Error ? err.message : String(err),
          },
        };
      }
    },
  },
  {
    method: 'POST',
    path: '/api/workers/telegram/test-message',
    workerIds: ['core.channels.telegram'],
    async handle() {
      const token = (await resolveTelegramBotToken()).trim();
      if (!token) {
        return { status: 200, body: { ok: false, errorMessage: 'No bot token configured yet.' } };
      }
      const allowedUserId = config.allowedUserId;
      if (!allowedUserId) {
        return { status: 200, body: { ok: false, errorMessage: 'No allowed user ID configured yet.' } };
      }
      try {
        const response = await callTelegramApi(token, 'sendMessage', {
          chat_id: allowedUserId,
          text: 'BFrost test message — your Telegram channel is connected and reachable. ✅',
        });
        if (!response.ok) {
          return {
            status: 200,
            body: {
              ok: false,
              errorMessage:
                response.description ??
                'Telegram returned an error. Make sure you have started a chat with the bot (send /start to it once).',
            },
          };
        }
        return { status: 200, body: { ok: true, errorMessage: null } };
      } catch (err) {
        return {
          status: 200,
          body: { ok: false, errorMessage: err instanceof Error ? err.message : String(err) },
        };
      }
    },
  },
];
