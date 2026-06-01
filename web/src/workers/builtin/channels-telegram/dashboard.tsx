import { useEffect, useState } from 'react';
import type { WorkerDashboardViewDefinition } from '../../types';
import type { WorkerDashboardUiContract } from '../../ui-contract';

interface TelegramStatus {
  tokenConfigured: boolean;
  allowedUserConfigured: boolean;
  allowedUserId: number | null;
  bot: { id: number; firstName: string; username: string | null } | null;
  errorMessage: string | null;
}

function StepHeader({
  n,
  label,
  state,
  ui,
}: {
  n: number;
  label: string;
  state: 'open' | 'done' | 'error' | 'pending';
  ui?: WorkerDashboardUiContract;
}) {
  const tone = state === 'done' ? 'good' : state === 'error' ? 'warning' : 'muted';
  const mark = state === 'done' ? '✓' : state === 'error' ? '!' : String(n);
  const classes = ui?.classes;
  return (
    <div className={classes?.stepHeader ?? 'bfrost-worker-step-header'}>
      <span className={ui?.cx(ui.statusTone(tone), 'bfrost-worker-step-marker') ?? `status-pill ${tone} bfrost-worker-step-marker`}>{mark}</span>
      <strong>{label}</strong>
    </div>
  );
}

function TelegramConnectPanel({ onSaved, ui }: { onSaved?: () => void; ui?: WorkerDashboardUiContract }) {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [tokenDraft, setTokenDraft] = useState('');
  const [userIdDraft, setUserIdDraft] = useState('');
  const [busy, setBusy] = useState<'verify' | 'save-token' | 'save-user' | 'test' | null>(null);
  const [verifiedBot, setVerifiedBot] = useState<TelegramStatus['bot']>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function refresh() {
    try {
      const res = await fetch('/api/workers/telegram/status', { credentials: 'include' });
      if (!res.ok) return;
      const body = (await res.json()) as TelegramStatus;
      setStatus(body);
      if (body.allowedUserId) setUserIdDraft(String(body.allowedUserId));
    } catch {
      // best-effort
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function verifyToken() {
    setBusy('verify');
    setVerifyError(null);
    setVerifiedBot(null);
    try {
      const res = await fetch('/api/workers/telegram/verify-token', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramBotToken: tokenDraft }),
      });
      const body = await res.json();
      if (!body.ok) {
        setVerifyError(body.errorMessage ?? 'Telegram rejected the token.');
        return;
      }
      setVerifiedBot(body.bot);
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function saveToken() {
    if (!verifiedBot) return;
    setBusy('save-token');
    setSaveError(null);
    try {
      const res = await fetch('/api/telegram-settings', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telegramBotToken: tokenDraft }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSaveError(body.error ?? 'Failed to save token.');
        return;
      }
      setTokenDraft('');
      await refresh();
      onSaved?.();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function saveUserId() {
    setBusy('save-user');
    setSaveError(null);
    try {
      const res = await fetch('/api/telegram-settings', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowedUserId: userIdDraft }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSaveError(body.error ?? 'Failed to save user ID.');
        return;
      }
      await refresh();
      onSaved?.();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function sendTestMessage() {
    setBusy('test');
    setTestResult(null);
    try {
      const res = await fetch('/api/workers/telegram/test-message', {
        method: 'POST',
        credentials: 'include',
      });
      const body = await res.json();
      setTestResult({
        ok: body.ok,
        message: body.ok ? 'Sent — check your Telegram chat.' : body.errorMessage ?? 'Test failed.',
      });
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }

  if (!status) return <p className="empty-state">Loading Telegram status…</p>;

  const tokenStep = status.bot ? 'done' : status.tokenConfigured ? 'error' : 'open';
  const userStep = status.allowedUserConfigured ? 'done' : tokenStep === 'done' ? 'open' : 'pending';
  const allDone = status.bot && status.allowedUserConfigured;

  return (
    <div className={ui?.classes.detailBody ?? 'detail-body'}>
      <div style={{ marginBottom: '1rem' }}>
        <span className={`status-pill ${allDone ? 'good' : 'warning'}`}>
          {allDone ? 'Connected' : 'Setup needed'}
        </span>
        {status.bot ? (
          <span className="footnote" style={{ marginLeft: '0.5rem' }}>
            Bot: <strong>{status.bot.firstName}</strong>
            {status.bot.username ? ` (@${status.bot.username})` : ''}
          </span>
        ) : null}
      </div>

      <section className="bfrost-worker-step">
        <StepHeader ui={ui} n={1} label="Create a bot with BotFather" state={tokenStep === 'done' ? 'done' : 'open'} />
        <p className="footnote">
          Open Telegram and message <a href="https://t.me/BotFather" target="_blank" rel="noreferrer"><code>@BotFather</code></a>. Send <code>/newbot</code>, pick a name, then a username ending in <code>bot</code>. BotFather replies with a token that looks like <code>123456789:ABCDEF…</code>. Copy it.
        </p>
      </section>

      <section className="bfrost-worker-step">
        <StepHeader ui={ui} n={2} label="Paste and verify the bot token" state={tokenStep} />
        {tokenStep === 'error' && status.errorMessage ? (
          <p className="footnote" style={{ color: 'var(--warning)' }}>
            Stored token did not work: {status.errorMessage}. Paste a fresh one below.
          </p>
        ) : null}
        {status.bot ? (
          <p className="footnote" style={{ color: 'var(--good)' }}>
            Token verified — connected as <strong>{status.bot.firstName}</strong>
            {status.bot.username ? ` (@${status.bot.username})` : ''}. Paste a new token below to replace it.
          </p>
        ) : null}
        <label className="field">
          <span>Bot token</span>
          <input
            type="password"
            autoComplete="off"
            placeholder="123456789:ABCDEF..."
            value={tokenDraft}
            onChange={(event) => {
              setTokenDraft(event.target.value);
              setVerifiedBot(null);
              setVerifyError(null);
            }}
          />
        </label>
        {verifiedBot ? (
          <p className="footnote" style={{ color: 'var(--good)' }}>
            Verified as <strong>{verifiedBot.firstName}</strong>
            {verifiedBot.username ? ` (@${verifiedBot.username})` : ''}. Click Save to persist.
          </p>
        ) : null}
        {verifyError ? <p className="footnote" style={{ color: 'var(--warning)' }}>{verifyError}</p> : null}
        <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
          <button type="button" disabled={busy !== null || tokenDraft.trim().length === 0} onClick={() => void verifyToken()}>
            {busy === 'verify' ? 'Verifying…' : 'Verify token'}
          </button>
          <button
            type="button"
            className="primary"
            disabled={busy !== null || !verifiedBot}
            onClick={() => void saveToken()}
          >
            {busy === 'save-token' ? 'Saving…' : 'Save token'}
          </button>
        </div>
      </section>

      <section className="bfrost-worker-step" data-disabled={tokenStep === 'done' ? undefined : 'true'}>
        <StepHeader ui={ui} n={3} label="Tell BFrost your Telegram user ID" state={userStep} />
        <p className="footnote">
          Open <a href="https://t.me/userinfobot" target="_blank" rel="noreferrer"><code>@userinfobot</code></a> in Telegram and send it any message — it replies with your numeric ID. This restricts your BFrost bot so only your account can use it.
        </p>
        <label className="field">
          <span>Your Telegram user ID</span>
          <input
            type="text"
            inputMode="numeric"
            placeholder="123456789"
            value={userIdDraft}
            onChange={(event) => setUserIdDraft(event.target.value)}
            disabled={tokenStep !== 'done'}
          />
        </label>
        <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
          <button
            type="button"
            className="primary"
            disabled={busy !== null || tokenStep !== 'done' || userIdDraft.trim().length === 0}
            onClick={() => void saveUserId()}
          >
            {busy === 'save-user' ? 'Saving…' : 'Save user ID'}
          </button>
        </div>
      </section>

      <section className="bfrost-worker-step" data-disabled={allDone ? undefined : 'true'}>
        <StepHeader ui={ui} n={4} label="Send a test message" state={testResult?.ok ? 'done' : allDone ? 'open' : 'pending'} />
        <p className="footnote">
          One last check. Make sure you have sent <code>/start</code> to your bot at least once from Telegram (Telegram does not let bots message users who have not initiated a chat). Then click below — BFrost will send a confirmation message to your account.
        </p>
        <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
          <button type="button" disabled={busy !== null || !allDone} onClick={() => void sendTestMessage()}>
            {busy === 'test' ? 'Sending…' : 'Send test message'}
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

      {saveError ? <p className="footnote" style={{ marginTop: '0.75rem', color: 'var(--warning)' }}>{saveError}</p> : null}
    </div>
  );
}

export const dashboardView: WorkerDashboardViewDefinition = {
  workerId: 'core.channels.telegram',
  kind: 'channel-connect',
  surfaceIds: ['telegram-credentials'],
  count: () => undefined,
  render: (ctx) => <TelegramConnectPanel ui={ctx.ui as WorkerDashboardUiContract | undefined} onSaved={ctx.onSaved as (() => void) | undefined} />,
};
