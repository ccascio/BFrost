import { z } from 'zod';
import { BadRequestError, type AdminApiRoute } from '../../../admin-route';
import { recordEventSafe } from '../../../event-log';
import {
  resolveDiscordBotToken,
  resolveDiscordChannelId,
  setStoredDiscordBotToken,
  setStoredDiscordChannelId,
} from './credentials';

const WORKER_ID = 'core.channels.discord';
const DISCORD_API = 'https://discord.com/api/v10';

const DiscordSettingsBodySchema = z.object({
  discordBotToken: z.string().optional(),
  discordChannelId: z.string().optional(),
}).strict();

const DiscordVerifyBodySchema = z.object({
  discordBotToken: z.string().optional(),
}).strict();

interface DiscordBotIdentity {
  id: string;
  username: string;
  discriminator?: string;
  global_name?: string | null;
}

async function callDiscord<T>(
  token: string,
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
): Promise<{ ok: true; data: T } | { ok: false; status: number; message: string }> {
  const response = await fetch(`${DISCORD_API}${path}`, {
    method,
    headers: {
      Authorization: `Bot ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    return { ok: false, status: response.status, message: text || response.statusText };
  }
  const data = (await response.json()) as T;
  return { ok: true, data };
}

async function buildStatus() {
  const [token, channelId] = await Promise.all([
    resolveDiscordBotToken(),
    resolveDiscordChannelId(),
  ]);
  if (!token) {
    return {
      tokenConfigured: false,
      channelConfigured: Boolean(channelId),
      channelId: channelId || null,
      bot: null,
      errorMessage: null,
    };
  }
  const me = await callDiscord<DiscordBotIdentity>(token, 'GET', '/users/@me');
  if (!me.ok) {
    return {
      tokenConfigured: true,
      channelConfigured: Boolean(channelId),
      channelId: channelId || null,
      bot: null,
      errorMessage: `Discord rejected the stored token (HTTP ${me.status}).`,
    };
  }
  return {
    tokenConfigured: true,
    channelConfigured: Boolean(channelId),
    channelId: channelId || null,
    bot: {
      id: me.data.id,
      username: me.data.username,
      globalName: me.data.global_name ?? null,
    },
    errorMessage: null,
  };
}

export const discordChannelApiRoutes: AdminApiRoute[] = [
  {
    method: 'POST',
    path: '/api/workers/discord/settings',
    workerIds: [WORKER_ID],
    async handle({ req, readJsonBody }) {
      const body = await readJsonBody(req, DiscordSettingsBodySchema);
      const changedFields: string[] = [];

      if (body.discordBotToken !== undefined && body.discordBotToken.trim()) {
        await setStoredDiscordBotToken(body.discordBotToken.trim());
        changedFields.push('discordBotToken');
      }
      if (body.discordChannelId !== undefined && body.discordChannelId.trim()) {
        const candidate = body.discordChannelId.trim();
        if (!/^\d{5,30}$/.test(candidate)) {
          throw new BadRequestError('discordChannelId must be a numeric Discord channel ID.');
        }
        await setStoredDiscordChannelId(candidate);
        changedFields.push('discordChannelId');
      }

      if (changedFields.length === 0) {
        throw new BadRequestError('Provide at least one Discord setting to save.');
      }

      await recordEventSafe({
        category: 'admin',
        action: 'discord_settings_updated',
        summary: 'Discord settings updated.',
        metadata: { workerId: WORKER_ID, workerName: 'Discord Channel', fields: changedFields },
      });
      return { status: 200, body: { ok: true } };
    },
  },
  {
    method: 'POST',
    path: '/api/workers/discord/verify-token',
    workerIds: [WORKER_ID],
    async handle({ req, readJsonBody }) {
      const body = await readJsonBody(req, DiscordVerifyBodySchema);
      const token = (body.discordBotToken?.trim() || (await resolveDiscordBotToken())).trim();
      if (!token) {
        return { status: 200, body: { ok: false, errorMessage: 'No bot token configured yet.', bot: null } };
      }
      const me = await callDiscord<DiscordBotIdentity>(token, 'GET', '/users/@me');
      if (!me.ok) {
        return {
          status: 200,
          body: {
            ok: false,
            errorMessage: `Discord rejected the token (HTTP ${me.status}).`,
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
            id: me.data.id,
            username: me.data.username,
            globalName: me.data.global_name ?? null,
          },
        },
      };
    },
  },
  {
    method: 'GET',
    path: '/api/workers/discord/status',
    workerIds: [WORKER_ID],
    async handle() {
      return { status: 200, body: await buildStatus() };
    },
  },
  {
    method: 'POST',
    path: '/api/workers/discord/test-message',
    workerIds: [WORKER_ID],
    async handle() {
      const [token, channelId] = await Promise.all([
        resolveDiscordBotToken(),
        resolveDiscordChannelId(),
      ]);
      if (!token) {
        return { status: 200, body: { ok: false, errorMessage: 'No bot token configured yet.' } };
      }
      if (!channelId) {
        return { status: 200, body: { ok: false, errorMessage: 'No channel ID configured yet.' } };
      }
      const result = await callDiscord(token, 'POST', `/channels/${channelId}/messages`, {
        content: 'BFrost test message — your Discord channel is connected and reachable. ✅',
      });
      if (!result.ok) {
        return {
          status: 200,
          body: {
            ok: false,
            errorMessage:
              result.status === 403
                ? 'Discord refused (HTTP 403). Make sure the bot is invited to the server and has Send Messages permission on this channel.'
                : result.status === 404
                  ? 'Discord could not find that channel (HTTP 404). Double-check the channel ID and that the bot can see the channel.'
                  : `Discord returned HTTP ${result.status}. ${result.message}`.trim(),
          },
        };
      }
      return { status: 200, body: { ok: true, errorMessage: null } };
    },
  },
];
