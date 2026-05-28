import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import type { StoredEmailCredentials } from './credentials';

export interface SmtpSendOptions {
  to: string;
  subject: string;
  text: string;
}

function createTransport(creds: StoredEmailCredentials) {
  // `family` is not in the @types/nodemailer Options type but nodemailer passes it
  // straight through to node's net.connect — it prevents IPv6 EHOSTUNREACH errors.
  const opts: SMTPTransport.Options & { family?: number } = {
    host: creds.smtpHost,
    port: creds.smtpPort ?? 587,
    secure: creds.smtpSecure ?? false,
    family: 4,
    auth: {
      user: creds.smtpUser,
      pass: creds.smtpPassword,
    },
  };
  return nodemailer.createTransport(opts as SMTPTransport.Options);
}

export async function sendEmail(creds: StoredEmailCredentials, opts: SmtpSendOptions): Promise<void> {
  const transport = createTransport(creds);
  await transport.sendMail({
    from: creds.emailAddress ?? creds.smtpUser,
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
  });
}

export async function verifySmtp(creds: StoredEmailCredentials): Promise<{ ok: boolean; errorMessage: string | null }> {
  try {
    const transport = createTransport(creds);
    await transport.verify();
    return { ok: true, errorMessage: null };
  } catch (err) {
    return { ok: false, errorMessage: err instanceof Error ? err.message : String(err) };
  }
}
