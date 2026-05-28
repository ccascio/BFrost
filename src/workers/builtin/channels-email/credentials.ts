import { openWorkerKv } from '../../storage';

const CREDS_KV_KEY = 'credentials';

export interface StoredEmailCredentials {
  emailAddress?: string;
  notifyAddress?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPassword?: string;
  smtpSecure?: boolean;
  imapHost?: string;
  imapPort?: number;
  imapUser?: string;
  imapPassword?: string;
  imapMailbox?: string;
}

const kv = openWorkerKv('core.channels.email');

export async function getStoredEmailCredentials(): Promise<StoredEmailCredentials> {
  return (await kv.get<StoredEmailCredentials>(CREDS_KV_KEY)) ?? {};
}

export async function setStoredEmailCredentials(patch: Partial<StoredEmailCredentials>): Promise<void> {
  const current = await getStoredEmailCredentials();
  await kv.set(CREDS_KV_KEY, { ...current, ...patch });
}
