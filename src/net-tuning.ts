import net from 'node:net';

/**
 * Outbound connect tuning, applied once per process before anything fetches.
 *
 * Node runs Happy Eyeballs by default (`autoSelectFamily`): for a dual-stack host it
 * races the resolved addresses, giving each one only `autoSelectFamilyAttemptTimeout`
 * milliseconds to complete its TCP handshake before moving to the next. The default is
 * 500ms (250ms on older Node), which assumes a fast local path — if *every* address
 * exceeds it, the attempts are aggregated into `AggregateError [ETIMEDOUT]` and surface
 * from `fetch` as the famously uninformative `TypeError: fetch failed`.
 *
 * That is not a timeout the caller can see or configure: it fires long before any
 * `AbortSignal.timeout` the call site set, so a request with a generous 8s budget can
 * still fail in ~1s. On a link where handshakes take 300-900ms (a slow ISP path, a VPN,
 * congested wifi) the default turns ordinary latency into hard, total failure — while
 * curl, which uses a far more forgiving Happy Eyeballs delay, keeps working and makes
 * the host look reachable.
 *
 * Raising the attempt timeout costs nothing on a healthy link: it is an upper bound on
 * how long one address may stall, not an added delay. An unroutable family still fails
 * immediately with ENETUNREACH and falls through to the next address at once.
 *
 * Tune with `NET_CONNECT_ATTEMPT_TIMEOUT_MS`; set it to `0` to restore Node's default.
 */

export const DEFAULT_CONNECT_ATTEMPT_TIMEOUT_MS = 3_000;

export function resolveConnectAttemptTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  const raw = (env.NET_CONNECT_ATTEMPT_TIMEOUT_MS ?? '').trim();
  if (!raw) return DEFAULT_CONNECT_ATTEMPT_TIMEOUT_MS;
  const parsed = Number(raw);
  // `0` is the documented opt-out (keep Node's default); anything unparseable or
  // negative is operator error, and silently falling back beats crashing on boot.
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_CONNECT_ATTEMPT_TIMEOUT_MS;
  return parsed === 0 ? null : Math.floor(parsed);
}

/** Idempotent: applying twice is a no-op, so both entrypoints may import this freely. */
export function applyNetworkTuning(env: NodeJS.ProcessEnv = process.env): number | null {
  const timeoutMs = resolveConnectAttemptTimeoutMs(env);
  if (timeoutMs === null) return null;
  // Guarded: `engines` allows Node >=20, and these setters landed across several
  // releases. A missing setter means the runtime keeps its own default — not a failure.
  if (typeof net.setDefaultAutoSelectFamilyAttemptTimeout !== 'function') return null;
  net.setDefaultAutoSelectFamilyAttemptTimeout(timeoutMs);
  return timeoutMs;
}

applyNetworkTuning();
