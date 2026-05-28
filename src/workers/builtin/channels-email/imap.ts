import { ImapFlow } from 'imapflow';
import type { StoredEmailCredentials } from './credentials';

export interface LatestEmailSummary {
  subject: string | null;
  from: string | null;
  date: string | null;
  snippet: string | null;
}

/** Connects to IMAP, fetches the latest message from the configured mailbox, and disconnects. */
export async function fetchLatestEmail(creds: StoredEmailCredentials): Promise<LatestEmailSummary | null> {
  const client = new ImapFlow({
    host: creds.imapHost ?? '',
    port: creds.imapPort ?? 993,
    secure: true,
    auth: {
      user: creds.imapUser ?? '',
      pass: creds.imapPassword ?? '',
    },
    logger: false,
  });

  await client.connect();
  try {
    const mailbox = await client.mailboxOpen(creds.imapMailbox ?? 'INBOX');
    if (mailbox.exists === 0) return null;

    const messages = client.fetch(`${mailbox.exists}:${mailbox.exists}`, {
      envelope: true,
      bodyStructure: false,
    });

    let summary: LatestEmailSummary | null = null;
    for await (const msg of messages) {
      const env = msg.envelope;
      summary = {
        subject: env?.subject ?? null,
        from: env?.from?.[0]?.address ?? null,
        date: env?.date?.toISOString() ?? null,
        snippet: null,
      };
    }
    return summary;
  } finally {
    await client.logout();
  }
}

export async function verifyImap(creds: StoredEmailCredentials): Promise<{ ok: boolean; errorMessage: string | null }> {
  try {
    const client = new ImapFlow({
      host: creds.imapHost ?? '',
      port: creds.imapPort ?? 993,
      secure: true,
      auth: {
        user: creds.imapUser ?? '',
        pass: creds.imapPassword ?? '',
      },
      logger: false,
    });
    await client.connect();
    await client.logout();
    return { ok: true, errorMessage: null };
  } catch (err) {
    return { ok: false, errorMessage: err instanceof Error ? err.message : String(err) };
  }
}
