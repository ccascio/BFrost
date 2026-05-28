# core.channels.email — Email Channel

Sends operator notifications via SMTP. Includes a guided connect-flow with auto-detection for common providers (Gmail, Fastmail, iCloud, Outlook) and an IMAP inbox verifier.

## What it does

- **Send-only in this version.** `notifyOperator(text)` delivers job-run summaries and alerts to your configured address via SMTP. Inbound two-way routing (IMAP polling → `processChannelMessage`) is not yet implemented — for two-way chat, use Telegram.
- **Auto-detect.** The connect panel detects Gmail, Fastmail, iCloud, and Outlook from the email address and pre-fills all server settings.
- **IMAP verifier.** The connect panel's final step connects to IMAP and fetches the latest inbox message to confirm credentials are correct.

## Credentials

All credentials are stored in the KV namespace `worker.core.channels.email.credentials`. Nothing is written to `.env`. Settings can be changed any time from the Channels tab.

| Field | Description |
|-------|-------------|
| `emailAddress` | Your email address — used as the From address |
| `notifyAddress` | Where BFrost sends notifications (defaults to `emailAddress`) |
| `smtpHost` | SMTP server hostname |
| `smtpPort` | SMTP port — 587 for STARTTLS (recommended), 465 for SSL/TLS |
| `smtpUser` | SMTP username (usually your email address) |
| `smtpPassword` | SMTP password or App Password |
| `smtpSecure` | `true` for SSL/TLS on port 465, `false` for STARTTLS on port 587 |
| `imapHost` | IMAP server hostname |
| `imapPort` | IMAP port — 993 for SSL/TLS |
| `imapUser` | IMAP username (usually same as SMTP username) |
| `imapPassword` | IMAP password or App Password (usually same as SMTP password) |
| `imapMailbox` | Mailbox to check for the inbox verifier. Default: `INBOX` |

## App Passwords (important)

Gmail, iCloud, and Fastmail require an **App Password**, not your regular account password:

- **Gmail**: Enable 2-Step Verification → `myaccount.google.com` → Security → App Passwords
- **iCloud**: `appleid.apple.com` → Sign-In and Security → App-Specific Passwords
- **Fastmail**: Settings → Password & Security → Third-party app passwords

Using your regular account password will fail with an authentication error.

## API routes

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/workers/email/status` | Current configuration status |
| `POST` | `/api/workers/email/detect-provider` | Auto-detect preset from email address |
| `POST` | `/api/workers/email/settings` | Save any subset of credentials |
| `POST` | `/api/workers/email/test-send` | Send a test email via SMTP |
| `POST` | `/api/workers/email/fetch-latest` | Fetch the latest IMAP inbox message |

## Future: two-way (IMAP polling)

When inbound routing is implemented, an IMAP polling loop in `adapter.start()` would:
1. Poll the configured mailbox on a configurable interval
2. Deduplicate by UID to avoid re-processing seen messages
3. Apply sender allowlisting (mirror Telegram's `isAllowed`) before routing to `processChannelMessage`
4. Reply to the same thread from `notifyOperator`

The `imap.ts` module is structured to make adding this loop straightforward.
