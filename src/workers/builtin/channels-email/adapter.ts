import type { ChannelAdapter } from '../../module';
import { getStoredEmailCredentials } from './credentials';
import { sendEmail } from './smtp';

const CHANNEL_ID = 'email';
const EMAIL_MAX_CHARS = 10000;

export function createEmailChannelAdapter(): ChannelAdapter {
  return {
    channelId: CHANNEL_ID,
    async isConfigured() {
      const creds = await getStoredEmailCredentials();
      return Boolean(
        creds.smtpHost &&
          creds.smtpUser &&
          creds.smtpPassword &&
          (creds.notifyAddress ?? creds.emailAddress),
      );
    },
    async start() {
      // Send-only adapter — IMAP polling for inbound messages is not yet implemented.
      // notifyOperator() delivers proactive emails via SMTP on demand.
    },
    async stop(_reason: string) {
      // No-op.
    },
    async notifyOperator(text: string) {
      const creds = await getStoredEmailCredentials();
      const to = creds.notifyAddress ?? creds.emailAddress;
      if (!creds.smtpHost || !creds.smtpUser || !creds.smtpPassword || !to) {
        console.warn('[EmailChannel] SMTP not fully configured; skipping operator notification.');
        return;
      }
      const body = text.length > EMAIL_MAX_CHARS ? text.slice(0, EMAIL_MAX_CHARS) + '\n…[truncated]' : text;
      await sendEmail(creds, {
        to,
        subject: 'BFrost notification',
        text: body,
      });
    },
  };
}
