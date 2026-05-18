import path from 'path';
import { z } from 'zod';
import { BadRequestError, type AdminApiRoute } from '../../../admin-route';
import { setAllowedUserId } from '../../../config';
import { upsertEnvValue } from '../../../env-file';
import { recordEventSafe } from '../../../event-log';
import { setStoredTelegramBotToken } from './credentials';

const TelegramSettingsBodySchema = z.object({
  telegramBotToken: z.string().optional(),
  allowedUserId: z.string().optional(),
}).strict();

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
];
