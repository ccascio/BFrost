import { openWorkerKv } from '../../storage';

const CREDS_KV_KEY = 'credentials';

interface StoredDiscordCredentials {
  botToken?: string;
  channelId?: string;
}

const kv = openWorkerKv('core.channels.discord');

export async function resolveDiscordBotToken(): Promise<string> {
  const stored = (await kv.get<StoredDiscordCredentials>(CREDS_KV_KEY)) ?? {};
  return stored.botToken?.trim() || (process.env.DISCORD_BOT_TOKEN ?? '').trim();
}

export async function resolveDiscordChannelId(): Promise<string> {
  const stored = (await kv.get<StoredDiscordCredentials>(CREDS_KV_KEY)) ?? {};
  return stored.channelId?.trim() || (process.env.DISCORD_CHANNEL_ID ?? '').trim();
}

export async function setStoredDiscordBotToken(value: string): Promise<void> {
  const current = (await kv.get<StoredDiscordCredentials>(CREDS_KV_KEY)) ?? {};
  await kv.set(CREDS_KV_KEY, { ...current, botToken: value });
}

export async function setStoredDiscordChannelId(value: string): Promise<void> {
  const current = (await kv.get<StoredDiscordCredentials>(CREDS_KV_KEY)) ?? {};
  await kv.set(CREDS_KV_KEY, { ...current, channelId: value });
}
