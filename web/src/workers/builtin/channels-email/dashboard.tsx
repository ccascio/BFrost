import { useEffect, useState } from 'react';
import type { WorkerDashboardViewDefinition } from '../../types';

interface EmailStatus {
  emailAddress: string | null;
  notifyAddress: string | null;
  smtpConfigured: boolean;
  imapConfigured: boolean;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpSecure: boolean | null;
  smtpUser: string | null;
  imapHost: string | null;
  imapPort: number | null;
  imapUser: string | null;
  imapMailbox: string;
}

interface ProviderPreset {
  name: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  imapHost: string;
  imapPort: number;
  helpText: string;
}

interface LatestEmail {
  subject: string | null;
  from: string | null;
  date: string | null;
  snippet: string | null;
}

function StepHeader({
  n,
  label,
  state,
}: {
  n: number;
  label: string;
  state: 'open' | 'done' | 'error' | 'pending';
}) {
  const tone = state === 'done' ? 'good' : state === 'error' ? 'warning' : 'muted';
  const mark = state === 'done' ? '✓' : state === 'error' ? '!' : String(n);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
      <span className={`status-pill ${tone}`} style={{ minWidth: '1.5rem', textAlign: 'center' }}>
        {mark}
      </span>
      <strong>{label}</strong>
    </div>
  );
}

function EmailConnectPanel({ onSaved }: { onSaved?: () => void }) {
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Step 1 — email address + auto-detect
  const [emailDraft, setEmailDraft] = useState('');
  const [detectedPreset, setDetectedPreset] = useState<ProviderPreset | null>(null);
  const [detecting, setDetecting] = useState(false);

  // Step 2 — SMTP
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('587');
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');
  const [smtpSecure, setSmtpSecure] = useState(false);

  // Step 3 — IMAP
  const [imapHost, setImapHost] = useState('');
  const [imapPort, setImapPort] = useState('993');
  const [imapUser, setImapUser] = useState('');
  const [imapPassword, setImapPassword] = useState('');
  const [imapMailbox, setImapMailbox] = useState('INBOX');

  // Step verifiers
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [fetchResult, setFetchResult] = useState<{
    ok: boolean;
    message: string;
    email: LatestEmail | null;
  } | null>(null);

  async function refresh() {
    try {
      const res = await fetch('/api/workers/email/status', { credentials: 'include' });
      if (!res.ok) return;
      const body = (await res.json()) as EmailStatus;
      setStatus(body);
      if (body.emailAddress) setEmailDraft(body.emailAddress);
      if (body.smtpHost) setSmtpHost(body.smtpHost);
      if (body.smtpPort) setSmtpPort(String(body.smtpPort));
      if (body.smtpUser) setSmtpUser(body.smtpUser);
      if (body.smtpSecure !== null) setSmtpSecure(body.smtpSecure ?? false);
      if (body.imapHost) setImapHost(body.imapHost);
      if (body.imapPort) setImapPort(String(body.imapPort));
      if (body.imapUser) setImapUser(body.imapUser);
      if (body.imapMailbox) setImapMailbox(body.imapMailbox);
    } catch {
      // best-effort
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function detectProvider() {
    if (!emailDraft.trim() || !emailDraft.includes('@')) return;
    setDetecting(true);
    setDetectedPreset(null);
    try {
      const res = await fetch('/api/workers/email/detect-provider', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailAddress: emailDraft.trim() }),
      });
      const body = (await res.json()) as { preset: ProviderPreset | null };
      if (body.preset) {
        setDetectedPreset(body.preset);
        setSmtpHost(body.preset.smtpHost);
        setSmtpPort(String(body.preset.smtpPort));
        setSmtpSecure(body.preset.smtpSecure);
        setSmtpUser(emailDraft.trim());
        setImapHost(body.preset.imapHost);
        setImapPort(String(body.preset.imapPort));
        setImapUser(emailDraft.trim());
      }
    } catch {
      // best-effort
    } finally {
      setDetecting(false);
    }
  }

  async function saveEmail() {
    setBusy('save-email');
    setError(null);
    try {
      const res = await fetch('/api/workers/email/settings', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailAddress: emailDraft.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? 'Failed to save email address.');
        return;
      }
      await refresh();
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function saveSmtp() {
    setBusy('save-smtp');
    setError(null);
    try {
      const res = await fetch('/api/workers/email/settings', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          smtpHost: smtpHost.trim(),
          smtpPort: parseInt(smtpPort, 10),
          smtpUser: smtpUser.trim(),
          smtpPassword: smtpPassword.trim() || undefined,
          smtpSecure,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? 'Failed to save SMTP settings.');
        return;
      }
      await refresh();
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function saveImap() {
    setBusy('save-imap');
    setError(null);
    try {
      const res = await fetch('/api/workers/email/settings', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imapHost: imapHost.trim(),
          imapPort: parseInt(imapPort, 10),
          imapUser: imapUser.trim(),
          imapPassword: imapPassword.trim() || undefined,
          imapMailbox: imapMailbox.trim() || 'INBOX',
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? 'Failed to save IMAP settings.');
        return;
      }
      await refresh();
      onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function sendTestEmail() {
    setBusy('test');
    setTestResult(null);
    try {
      const res = await fetch('/api/workers/email/test-send', {
        method: 'POST',
        credentials: 'include',
      });
      const body = (await res.json()) as { ok: boolean; errorMessage: string | null };
      setTestResult({
        ok: body.ok,
        message: body.ok
          ? 'Sent — check your inbox.'
          : body.errorMessage ?? 'Test failed.',
      });
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }

  async function fetchLatest() {
    setBusy('fetch');
    setFetchResult(null);
    try {
      const res = await fetch('/api/workers/email/fetch-latest', {
        method: 'POST',
        credentials: 'include',
      });
      const body = (await res.json()) as {
        ok: boolean;
        errorMessage: string | null;
        message: LatestEmail | null;
      };
      if (!body.ok) {
        setFetchResult({ ok: false, message: body.errorMessage ?? 'Fetch failed.', email: null });
        return;
      }
      if (!body.message) {
        setFetchResult({ ok: true, message: 'Inbox is empty.', email: null });
        return;
      }
      setFetchResult({ ok: true, message: 'Latest message fetched.', email: body.message });
    } catch (err) {
      setFetchResult({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        email: null,
      });
    } finally {
      setBusy(null);
    }
  }

  if (!status) return <p className="empty-state">Loading email status…</p>;

  const emailStep = status.emailAddress ? 'done' : 'open';
  const smtpStep: 'open' | 'done' | 'pending' = status.smtpConfigured ? 'done' : emailStep === 'done' ? 'open' : 'pending';
  const testStep: 'open' | 'done' | 'pending' = testResult?.ok ? 'done' : smtpStep === 'done' ? 'open' : 'pending';
  const imapStep: 'open' | 'done' | 'pending' = status.imapConfigured ? 'done' : smtpStep === 'done' ? 'open' : 'pending';
  const fetchStep: 'open' | 'done' | 'pending' = fetchResult?.ok ? 'done' : imapStep === 'done' ? 'open' : 'pending';
  const allDone = status.smtpConfigured;

  return (
    <div className="detail-body">
      <div style={{ marginBottom: '1rem' }}>
        <span className={`status-pill ${allDone ? 'good' : 'warning'}`}>
          {allDone ? 'Connected' : 'Setup needed'}
        </span>
        {status.emailAddress ? (
          <span className="footnote" style={{ marginLeft: '0.5rem' }}>
            <strong>{status.emailAddress}</strong>
          </span>
        ) : null}
        <p className="footnote" style={{ marginTop: '0.5rem' }}>
          Email is <strong>send-only</strong> in this version — BFrost can send you notifications
          and job summaries, but it does not read replies. For two-way chat, use Telegram.
        </p>
      </div>

      {/* Step 1 — Email address */}
      <section style={{ marginBottom: '1.25rem' }}>
        <StepHeader n={1} label="Enter your email address" state={emailStep} />
        <p className="footnote">
          BFrost will auto-detect Gmail, Fastmail, iCloud, and Outlook settings and pre-fill the
          form below.
        </p>
        <label className="field">
          <span>Email address</span>
          <input
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={emailDraft}
            onChange={(e) => {
              setEmailDraft(e.target.value);
              setDetectedPreset(null);
            }}
            onBlur={() => void detectProvider()}
          />
        </label>
        {detectedPreset ? (
          <p className="footnote" style={{ color: 'var(--good)' }}>
            Detected <strong>{detectedPreset.name}</strong> — SMTP and IMAP settings pre-filled.{' '}
            {detectedPreset.helpText}
          </p>
        ) : null}
        <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
          <button
            type="button"
            disabled={detecting || !emailDraft.includes('@')}
            onClick={() => void detectProvider()}
          >
            {detecting ? 'Detecting…' : 'Auto-detect settings'}
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy !== null || !emailDraft.includes('@')}
            onClick={() => void saveEmail()}
          >
            {busy === 'save-email' ? 'Saving…' : 'Save address'}
          </button>
        </div>
      </section>

      {/* Step 2 — SMTP */}
      <section style={{ marginBottom: '1.25rem', opacity: emailStep === 'open' ? 0.55 : 1 }}>
        <StepHeader n={2} label="Configure SMTP (outgoing mail)" state={smtpStep} />
        <p className="footnote">
          SMTP is how BFrost sends emails. Use port <strong>587 with STARTTLS</strong> (the default).
          Gmail, iCloud, and Fastmail require an <strong>App Password</strong> — not your regular account password.
          For Gmail: go to{' '}
          <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">myaccount.google.com/apppasswords</a>
          , choose "Other (Custom name)", and copy the 16-digit password.
        </p>
        <label className="field">
          <span>SMTP host</span>
          <input
            type="text"
            placeholder="smtp.gmail.com"
            value={smtpHost}
            onChange={(e) => setSmtpHost(e.target.value)}
            disabled={emailStep === 'open'}
          />
        </label>
        <label className="field">
          <span>SMTP port</span>
          <input
            type="number"
            min={1}
            max={65535}
            value={smtpPort}
            onChange={(e) => setSmtpPort(e.target.value)}
            disabled={emailStep === 'open'}
          />
        </label>
        <label className="field">
          <span>SMTP username</span>
          <input
            type="text"
            autoComplete="username"
            placeholder="you@example.com"
            value={smtpUser}
            onChange={(e) => setSmtpUser(e.target.value)}
            disabled={emailStep === 'open'}
          />
        </label>
        <label className="field">
          <span>SMTP password / App password</span>
          <input
            type="password"
            autoComplete="new-password"
            value={smtpPassword}
            onChange={(e) => setSmtpPassword(e.target.value)}
            disabled={emailStep === 'open'}
            placeholder="Leave blank to keep the current value"
          />
        </label>
        <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="checkbox"
            checked={smtpSecure}
            onChange={(e) => setSmtpSecure(e.target.checked)}
            disabled={emailStep === 'open'}
          />
          <span>Use SSL/TLS on port 465 (uncheck for STARTTLS on port 587)</span>
        </label>
        <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
          <button
            type="button"
            className="primary"
            disabled={busy !== null || emailStep === 'open' || !smtpHost.trim() || !smtpUser.trim()}
            onClick={() => void saveSmtp()}
          >
            {busy === 'save-smtp' ? 'Saving…' : 'Save SMTP settings'}
          </button>
        </div>
      </section>

      {/* Step 3 — Test send */}
      <section style={{ marginBottom: '1.25rem', opacity: smtpStep === 'pending' ? 0.55 : 1 }}>
        <StepHeader
          n={3}
          label="Send a test email"
          state={testResult?.ok ? 'done' : smtpStep === 'done' ? 'open' : 'pending'}
        />
        <p className="footnote">
          BFrost will send a test message to{' '}
          <strong>{status.notifyAddress ?? status.emailAddress ?? 'your configured address'}</strong>.
        </p>
        <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
          <button
            type="button"
            disabled={busy !== null || smtpStep !== 'done'}
            onClick={() => void sendTestEmail()}
          >
            {busy === 'test' ? 'Sending…' : 'Send test email'}
          </button>
        </div>
        {testResult ? (
          <p
            className="footnote"
            style={{ marginTop: '0.5rem', color: testResult.ok ? 'var(--good)' : 'var(--warning)' }}
          >
            {testResult.message}
          </p>
        ) : null}
      </section>

      {/* Step 4 — IMAP */}
      <section style={{ marginBottom: '1.25rem', opacity: smtpStep === 'pending' ? 0.55 : 1 }}>
        <StepHeader n={4} label="Configure IMAP (inbox verifier)" state={imapStep} />
        <p className="footnote">
          IMAP lets BFrost check your inbox to verify the connection. The username and password are
          usually the same as your SMTP credentials.
        </p>
        <label className="field">
          <span>IMAP host</span>
          <input
            type="text"
            placeholder="imap.gmail.com"
            value={imapHost}
            onChange={(e) => setImapHost(e.target.value)}
            disabled={smtpStep === 'pending'}
          />
        </label>
        <label className="field">
          <span>IMAP port</span>
          <input
            type="number"
            min={1}
            max={65535}
            value={imapPort}
            onChange={(e) => setImapPort(e.target.value)}
            disabled={smtpStep === 'pending'}
          />
        </label>
        <label className="field">
          <span>IMAP username</span>
          <input
            type="text"
            autoComplete="username"
            placeholder="you@example.com"
            value={imapUser}
            onChange={(e) => setImapUser(e.target.value)}
            disabled={smtpStep === 'pending'}
          />
        </label>
        <label className="field">
          <span>IMAP password / App password</span>
          <input
            type="password"
            autoComplete="new-password"
            value={imapPassword}
            onChange={(e) => setImapPassword(e.target.value)}
            disabled={smtpStep === 'pending'}
            placeholder="Leave blank to keep the current value"
          />
        </label>
        <label className="field">
          <span>Mailbox</span>
          <input
            type="text"
            placeholder="INBOX"
            value={imapMailbox}
            onChange={(e) => setImapMailbox(e.target.value)}
            disabled={smtpStep === 'pending'}
          />
        </label>
        <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
          <button
            type="button"
            className="primary"
            disabled={busy !== null || smtpStep === 'pending' || !imapHost.trim() || !imapUser.trim()}
            onClick={() => void saveImap()}
          >
            {busy === 'save-imap' ? 'Saving…' : 'Save IMAP settings'}
          </button>
        </div>
      </section>

      {/* Step 5 — Fetch latest */}
      <section style={{ opacity: fetchStep === 'pending' ? 0.55 : 1 }}>
        <StepHeader
          n={5}
          label="Fetch latest inbox message"
          state={fetchResult?.ok ? 'done' : imapStep === 'done' ? 'open' : 'pending'}
        />
        <p className="footnote">Verify IMAP is working by fetching the most recent message from your inbox.</p>
        <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
          <button
            type="button"
            disabled={busy !== null || imapStep !== 'done'}
            onClick={() => void fetchLatest()}
          >
            {busy === 'fetch' ? 'Fetching…' : 'Fetch latest message'}
          </button>
        </div>
        {fetchResult ? (
          <div style={{ marginTop: '0.5rem' }}>
            <p
              className="footnote"
              style={{ color: fetchResult.ok ? 'var(--good)' : 'var(--warning)' }}
            >
              {fetchResult.message}
            </p>
            {fetchResult.email ? (
              <div
                className="footnote"
                style={{
                  marginTop: '0.25rem',
                  padding: '0.5rem',
                  background: 'var(--surface-alt)',
                  borderRadius: '4px',
                }}
              >
                <div>
                  <strong>From:</strong> {fetchResult.email.from ?? '—'}
                </div>
                <div>
                  <strong>Subject:</strong> {fetchResult.email.subject ?? '—'}
                </div>
                <div>
                  <strong>Date:</strong>{' '}
                  {fetchResult.email.date
                    ? new Date(fetchResult.email.date).toLocaleString()
                    : '—'}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {error ? (
        <p className="footnote" style={{ marginTop: '0.75rem', color: 'var(--warning)' }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const dashboardView: WorkerDashboardViewDefinition = {
  workerId: 'core.channels.email',
  kind: 'channel-connect',
  surfaceIds: ['email-credentials'],
  count: () => undefined,
  render: (ctx) => <EmailConnectPanel onSaved={ctx.onSaved as (() => void) | undefined} />,
};
