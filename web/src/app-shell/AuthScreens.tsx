import type { AppError } from '../app-types';

export function AuthCheckingScreen({ error }: { error: AppError | null }) {
  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">BFrost</p>
        <h1>Control Room</h1>
        <p className="hero-copy">Checking authentication status.</p>
        {error ? <p className="error-text">{error.friendly}</p> : null}
      </section>
    </main>
  );
}

export function LoginScreen({
  password,
  busy,
  error,
  onPasswordChange,
  onLogin,
}: {
  password: string;
  busy: boolean;
  error: AppError | null;
  onPasswordChange: (value: string) => void;
  onLogin: () => void;
}) {
  return (
    <main className="shell">
      <section className="hero">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <img
            src="/bfrost-logo.jpeg"
            alt="BFrost"
            style={{ width: 72, height: 72, borderRadius: 16, objectFit: 'cover', flexShrink: 0 }}
          />
          <div>
            <p className="eyebrow">BFrost</p>
            <h1>Control Room</h1>
            <p className="hero-copy">Enter the admin password to unlock operator controls.</p>
          </div>
        </div>
      </section>

      <section className="panel auth-panel">
        <label className="field">
          <span>Admin password</span>
          <input
            type="password"
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !busy) onLogin();
            }}
          />
        </label>

        <div className="panel-actions">
          <button className="primary" disabled={busy || password.length === 0} onClick={onLogin}>
            {busy ? 'Unlocking...' : 'Unlock dashboard'}
          </button>
        </div>

        {error ? <p className="error-box">{error.friendly}</p> : null}
      </section>
    </main>
  );
}

export function DashboardSplash({ error, exiting = false }: { error: AppError | null; exiting?: boolean }) {
  return (
    <div className={`bfrost-splash${exiting ? ' is-exiting' : ''}`} aria-busy="true" aria-live="polite">
      <img src="/bfrost-logo.jpeg" alt="BFrost" />
      <span>Loading BFrost...</span>
      {error ? (
        <p className="error-text" style={{ marginTop: '0.5rem' }}>{error.friendly}</p>
      ) : null}
    </div>
  );
}
