import { openWorkerKv } from '../../storage';

const CREDS_KV_KEY = 'credentials';

interface StoredTelegramCredentials {
  botToken?: string;
}

const kv = openWorkerKv('core.channels.telegram');

export async function resolveTelegramBotToken(): Promise<string> {
  const stored = (await kv.get<StoredTelegramCredentials>(CREDS_KV_KEY)) ?? {};
  return stored.botToken?.trim() || (process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
}

export async function setStoredTelegramBotToken(value: string): Promise<void> {
  const current = (await kv.get<StoredTelegramCredentials>(CREDS_KV_KEY)) ?? {};
  await kv.set(CREDS_KV_KEY, { ...current, botToken: value });
}
