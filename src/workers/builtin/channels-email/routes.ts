import { z } from 'zod';
import { BadRequestError, type AdminApiRoute } from '../../../admin-route';
import { recordEventSafe } from '../../../event-log';
import { getStoredEmailCredentials, setStoredEmailCredentials } from './credentials';
import { detectEmailProvider } from './providers';
import { sendEmail, verifySmtp } from './smtp';
import { fetchLatestEmail, verifyImap } from './imap';

const WORKER_ID = 'core.channels.email';

const EmailSettingsBodySchema = z
  .object({
    emailAddress: z.string().optional(),
    notifyAddress: z.string().optional(),
    smtpHost: z.string().optional(),
    smtpPort: z.number().int().min(1).max(65535).optional(),
    smtpUser: z.string().optional(),
    smtpPassword: z.string().optional(),
    smtpSecure: z.boolean().optional(),
    imapHost: z.string().optional(),
    imapPort: z.number().int().min(1).max(65535).optional(),
    imapUser: z.string().optional(),
    imapPassword: z.string().optional(),
    imapMailbox: z.string().optional(),
  })
  .strict();

const DetectProviderBodySchema = z.object({ emailAddress: z.string().min(1) }).strict();

async function buildStatus() {
  const creds = await getStoredEmailCredentials();
  return {
    emailAddress: creds.emailAddress ?? null,
    notifyAddress: creds.notifyAddress ?? null,
    smtpConfigured: Boolean(creds.smtpHost && creds.smtpUser && creds.smtpPassword),
    imapConfigured: Boolean(creds.imapHost && creds.imapUser && creds.imapPassword),
    smtpHost: creds.smtpHost ?? null,
    smtpPort: creds.smtpPort ?? null,
    smtpSecure: creds.smtpSecure ?? null,
    smtpUser: creds.smtpUser ?? null,
    imapHost: creds.imapHost ?? null,
    imapPort: creds.imapPort ?? null,
    imapUser: creds.imapUser ?? null,
    imapMailbox: creds.imapMailbox ?? 'INBOX',
  };
}

export const emailChannelApiRoutes: AdminApiRoute[] = [
  {
    method: 'GET',
    path: '/api/workers/email/status',
    workerIds: [WORKER_ID],
    async handle() {
      return { status: 200, body: await buildStatus() };
    },
  },
  {
    method: 'POST',
    path: '/api/workers/email/detect-provider',
    workerIds: [WORKER_ID],
    async handle({ req, readJsonBody }) {
      const body = await readJsonBody(req, DetectProviderBodySchema);
      const preset = detectEmailProvider(body.emailAddress);
      return { status: 200, body: { preset: preset ?? null } };
    },
  },
  {
    method: 'POST',
    path: '/api/workers/email/settings',
    workerIds: [WORKER_ID],
    async handle({ req, readJsonBody }) {
      const body = await readJsonBody(req, EmailSettingsBodySchema);
      const patch: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(body)) {
        if (value !== undefined) patch[key] = value;
      }
      if (Object.keys(patch).length === 0) {
        throw new BadRequestError('Provide at least one email setting to save.');
      }
      await setStoredEmailCredentials(patch);
      await recordEventSafe({
        category: 'admin',
        action: 'email_settings_updated',
        summary: 'Email channel settings updated.',
        metadata: { workerId: WORKER_ID, fields: Object.keys(patch) },
      });
      return { status: 200, body: { ok: true } };
    },
  },
  {
    method: 'POST',
    path: '/api/workers/email/test-send',
    workerIds: [WORKER_ID],
    async handle() {
      const creds = await getStoredEmailCredentials();
      const to = creds.notifyAddress ?? creds.emailAddress;
      if (!creds.smtpHost || !creds.smtpUser || !creds.smtpPassword) {
        return { status: 200, body: { ok: false, errorMessage: 'SMTP not configured yet.' } };
      }
      if (!to) {
        return { status: 200, body: { ok: false, errorMessage: 'No recipient address configured yet.' } };
      }
      const verify = await verifySmtp(creds);
      if (!verify.ok) {
        return { status: 200, body: { ok: false, errorMessage: verify.errorMessage } };
      }
      try {
        await sendEmail(creds, {
          to,
          subject: 'BFrost test email — connected',
          text: 'BFrost test email — your email channel is connected and reachable.',
        });
        return { status: 200, body: { ok: true, errorMessage: null } };
      } catch (err) {
        return {
          status: 200,
          body: { ok: false, errorMessage: err instanceof Error ? err.message : String(err) },
        };
      }
    },
  },
  {
    method: 'POST',
    path: '/api/workers/email/fetch-latest',
    workerIds: [WORKER_ID],
    async handle() {
      const creds = await getStoredEmailCredentials();
      if (!creds.imapHost || !creds.imapUser || !creds.imapPassword) {
        return { status: 200, body: { ok: false, errorMessage: 'IMAP not configured yet.', message: null } };
      }
      const verify = await verifyImap(creds);
      if (!verify.ok) {
        return { status: 200, body: { ok: false, errorMessage: verify.errorMessage, message: null } };
      }
      try {
        const message = await fetchLatestEmail(creds);
        return { status: 200, body: { ok: true, errorMessage: null, message } };
      } catch (err) {
        return {
          status: 200,
          body: {
            ok: false,
            errorMessage: err instanceof Error ? err.message : String(err),
            message: null,
          },
        };
      }
    },
  },
];
