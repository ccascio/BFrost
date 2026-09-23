import type { IncomingMessage } from 'http';
import { isIP } from 'net';

/**
 * Host-wide request guard, applied before authentication and routing.
 *
 * 1. Host allowlist (DNS rebinding). A rebinding page reaches the admin port under its own
 *    domain name, so the browser treats it as same-origin. Only names that cannot be rebound
 *    are accepted: IP literals, `localhost`, and names listed in ADMIN_ALLOWED_HOSTS (for a
 *    reverse proxy or LAN name).
 * 2. Cross-site writes (CSRF). A state-changing /api request from a browser must come from this
 *    origin. Body-less POSTs are "simple" requests that skip the CORS preflight, and the session
 *    cookie is SameSite=Lax, so neither CORS nor the cookie stops them. Requests without
 *    Sec-Fetch-Site and Origin (curl, scripts) are not browser-driven and pass.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export type RequestGuardResult = { ok: true } | { ok: false; status: 403; error: string };

/** `host[:port]` → lowercase host without brackets or port, or null when malformed. */
export function hostnameOf(hostHeader: string): string | null {
  const value = hostHeader.trim().toLowerCase();
  if (!value) return null;
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    return end > 1 ? value.slice(1, end) : null;
  }
  const colon = value.indexOf(':');
  // A bare IPv6 address has several colons and no brackets; it cannot carry a port.
  if (colon !== -1 && value.indexOf(':', colon + 1) !== -1) return value;
  return colon === -1 ? value : value.slice(0, colon);
}

export function parseAllowedHosts(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedHost(hostHeader: string | undefined, allowedHosts: readonly string[]): boolean {
  if (!hostHeader) return false;
  const hostname = hostnameOf(hostHeader);
  if (!hostname) return false;
  if (hostname === 'localhost' || isIP(hostname) !== 0) return true;
  return allowedHosts.includes(hostname);
}

export function isCrossSiteWrite(req: Pick<IncomingMessage, 'method' | 'headers'>): boolean {
  if (SAFE_METHODS.has((req.method ?? 'GET').toUpperCase())) return false;
  const site = req.headers['sec-fetch-site'];
  if (typeof site === 'string') return site !== 'same-origin' && site !== 'none';
  const origin = req.headers.origin;
  if (typeof origin !== 'string') return false;
  try {
    return new URL(origin).host !== (req.headers.host ?? '').toLowerCase();
  } catch {
    return true;
  }
}

export function guardRequest(
  req: Pick<IncomingMessage, 'method' | 'headers'>,
  pathname: string,
  allowedHosts: readonly string[],
): RequestGuardResult {
  if (!isAllowedHost(req.headers.host, allowedHosts)) {
    return {
      ok: false,
      status: 403,
      error: 'Host not allowed. Add it to ADMIN_ALLOWED_HOSTS to serve the dashboard under this name.',
    };
  }
  if (pathname.startsWith('/api/') && isCrossSiteWrite(req)) {
    return { ok: false, status: 403, error: 'Cross-site request blocked.' };
  }
  return { ok: true };
}
