import { useEffect, useState } from 'react';
import type { WorkerDashboardViewDefinition } from '../../types';

interface DiscordStatus {
  tokenConfigured: boolean;
  channelConfigured: boolean;
  channelId: string | null;
  bot: { id: string; username: string; globalName: string | null } | null;
  errorMessage: string | null;
}

function StepHeader({ n, label, state }: { n: number; label: string; state: 'open' | 'done' | 'error' | 'pending' }) {
  const tone = state === 'done' ? 'good' : state === 'error' ? 'warning' : 'muted';
  const mark = state === 'done' ? '✓' : state === 'error' ? '!' : String(n);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
      <span className={`status-pill ${tone}`} style={{ minWidth: '1.5rem', textAlign: 'center' }}>{mark}</span>
      <strong>{label}</strong>
    </div>
  );
}

function DiscordConnectPanel({ onSaved }: { onSaved?: () => void }) {
  const [status, setStatus] = useState<DiscordStatus | null>(null);
  const [tokenDraft, setTokenDraft] = useState('');
  const [channelDraft, setChannelDraft] = useState('');
  const [busy, setBusy] = useState<'verify' | 'save-token' | 'save-channel' | 'test' | null>(null);
  const [verifiedBot, setVerifiedBot] = useState<DiscordStatus['bot']>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function refresh() {
    try {
      const res = await fetch('/api/workers/discord/status', { credentials: 'include' });
      if (!res.ok) return;
      const body = (await res.json()) as DiscordStatus;
      setStatus(body);
      if (body.channelId) setChannelDraft(body.channelId);
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
      const res = await fetch('/api/workers/discord/verify-token', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discordBotToken: tokenDraft }),
      });
      const body = await res.json();
      if (!body.ok) {
        setVerifyError(body.errorMessage ?? 'Discord rejected the token.');
        return;
      }
      setVerifiedBot(body.bot);
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function postSettings(payload: Record<string, string>, busyKey: 'save-token' | 'save-channel') {
    setBusy(busyKey);
    setSaveError(null);
    try {
      const res = await fetch('/api/workers/discord/settings', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setSaveError(body.error ?? 'Failed to save Discord setting.');
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
      const res = await fetch('/api/workers/discord/test-message', {
        method: 'POST',
        credentials: 'include',
      });
      const body = await res.json();
      setTestResult({
        ok: body.ok,
        message: body.ok ? 'Sent — check your Discord channel.' : body.errorMessage ?? 'Test failed.',
      });
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  }

  if (!status) return <p className="empty-state">Loading Discord status…</p>;

  const tokenStep = status.bot ? 'done' : status.tokenConfigured ? 'error' : 'open';
  const inviteStep: 'open' | 'done' | 'pending' = tokenStep === 'done' ? 'open' : 'pending';
  const channelStep: 'open' | 'done' | 'pending' =
    status.channelConfigured ? 'done' : tokenStep === 'done' ? 'open' : 'pending';
  const allDone = status.bot && status.channelConfigured;
  const inviteUrl = status.bot
    ? `https://discord.com/api/oauth2/authorize?client_id=${status.bot.id}&permissions=2048&scope=bot`
    : null;

  return (
    <div className="detail-body">
      <div style={{ marginBottom: '1rem' }}>
        <span className={`status-pill ${allDone ? 'good' : 'warning'}`}>
          {allDone ? 'Connected' : 'Setup needed'}
        </span>
        {status.bot ? (
          <span className="footnote" style={{ marginLeft: '0.5rem' }}>
            Bot: <strong>{status.bot.globalName ?? status.bot.username}</strong> (@{status.bot.username})
          </span>
        ) : null}
        <p className="footnote" style={{ marginTop: '0.5rem' }}>
          Discord is <strong>send-only</strong> in this version — BFrost can post notifications to a
          channel, but it does not read replies. For two-way chat, use Telegram.
        </p>
      </div>

      <section style={{ marginBottom: '1.25rem' }}>
        <StepHeader n={1} label="Create a Discord application and bot" state={tokenStep === 'done' ? 'done' : 'open'} />
        <p className="footnote">
          Open the <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer">Discord Developer Portal</a>,
          click <strong>New Application</strong>, give it a name, then open the <strong>Bot</strong> tab
          and click <strong>Reset Token</strong> to reveal your bot token. Copy it.
        </p>
      </section>

      <section style={{ marginBottom: '1.25rem' }}>
        <StepHeader n={2} label="Paste and verify the bot token" state={tokenStep} />
        {tokenStep === 'error' && status.errorMessage ? (
          <p className="footnote" style={{ color: 'var(--warning)' }}>
            Stored token did not work: {status.errorMessage}. Paste a fresh one below.
          </p>
        ) : null}
        {status.bot ? (
          <p className="footnote" style={{ color: 'var(--good)' }}>
            Token verified — connected as <strong>{status.bot.globalName ?? status.bot.username}</strong> (@{status.bot.username}).
            Paste a new token below to replace it.
          </p>
        ) : null}
        <label className="field">
          <span>Bot token</span>
          <input
            type="password"
            autoComplete="off"
            placeholder="MTAxNjY3..."
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
            Verified as <strong>{verifiedBot.globalName ?? verifiedBot.username}</strong> (@{verifiedBot.username}).
            Click Save to persist.
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
            onClick={() => void postSettings({ discordBotToken: tokenDraft }, 'save-token')}
          >
            {busy === 'save-token' ? 'Saving…' : 'Save token'}
          </button>
        </div>
      </section>

      <section style={{ marginBottom: '1.25rem', opacity: inviteStep === 'pending' ? 0.55 : 1 }}>
        <StepHeader n={3} label="Invite the bot to your server" state={inviteStep === 'pending' ? 'pending' : 'open'} />
        <p className="footnote">
          Click the button below to open a Discord page that lets you add the bot to a server you
          own or manage. The bot needs the <strong>Send Messages</strong> permission on the channel
          you will use for notifications.
        </p>
        <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
          <a
            href={inviteUrl ?? '#'}
            target="_blank"
            rel="noreferrer"
            className={inviteStep === 'pending' ? '' : 'primary'}
            style={{
              pointerEvents: inviteUrl ? 'auto' : 'none',
              opacity: inviteUrl ? 1 : 0.5,
              padding: '0.4rem 0.8rem',
              borderRadius: '6px',
              border: '1px solid var(--border)',
              textDecoration: 'none',
            }}
          >
            Open invite link
          </a>
        </div>
      </section>

      <section style={{ marginBottom: '1.25rem', opacity: channelStep === 'pending' ? 0.55 : 1 }}>
        <StepHeader n={4} label="Paste the channel ID" state={channelStep} />
        <p className="footnote">
          In Discord, open <strong>Settings → Advanced</strong> and enable <strong>Developer Mode</strong>.
          Then right-click the channel where BFrost should post and choose <strong>Copy Channel ID</strong>.
        </p>
        <label className="field">
          <span>Channel ID</span>
          <input
            type="text"
            inputMode="numeric"
            placeholder="1023456789012345678"
            value={channelDraft}
            onChange={(event) => setChannelDraft(event.target.value)}
            disabled={channelStep === 'pending'}
          />
        </label>
        <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
          <button
            type="button"
            className="primary"
            disabled={busy !== null || channelStep === 'pending' || channelDraft.trim().length === 0}
            onClick={() => void postSettings({ discordChannelId: channelDraft }, 'save-channel')}
          >
            {busy === 'save-channel' ? 'Saving…' : 'Save channel ID'}
          </button>
        </div>
      </section>

      <section style={{ opacity: allDone ? 1 : 0.55 }}>
        <StepHeader n={5} label="Send a test message" state={testResult?.ok ? 'done' : allDone ? 'open' : 'pending'} />
        <p className="footnote">
          One last check. BFrost will post a confirmation message to the configured channel.
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
  workerId: 'core.channels.discord',
  kind: 'channel-connect',
  surfaceIds: ['discord-credentials'],
  count: () => undefined,
  render: (ctx) => <DiscordConnectPanel onSaved={ctx.onSaved as (() => void) | undefined} />,
};
