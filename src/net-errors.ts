/**
 * Naming what actually went wrong when `fetch` rejects, and deciding whether it is
 * worth trying again.
 *
 * `fetch` collapses every transport-layer problem into the same opaque
 * `TypeError: fetch failed` and hangs the real reason off `.cause`: a
 * `ConnectTimeoutError` when the handshake never completed, `ENOTFOUND` when DNS
 * missed, `ECONNRESET` when the peer hung up mid-body, an `AggregateError` when Happy
 * Eyeballs burned through every resolved address (see ./net-tuning for why that one
 * fires earlier than call sites expect). A log line that prints `err.message` alone
 * therefore records only that *something* network-shaped happened — a bare
 * `Search failed for "<name>": fetch failed`, with no way to tell a stalled link from a
 * blocked host from a bad hostname.
 *
 * `describeFetchFailure` walks that chain and renders the specific cause instead;
 * `fetchFailureError` is the wrapper to throw so the chain survives for whoever
 * classifies it further up.
 *
 * The classifier is the other half. This codebase treats "transient" versus
 * "deterministic" as a load-bearing distinction (see the failure-classification rule in
 * CLAUDE.md): a deterministic failure should be recorded once and not retried, while a
 * transient one must stay retryable or a single DNS blip strands real work. Connect
 * timeouts, resets, and 429/5xx are the transient set; a 404, a malformed payload, or an
 * unparseable response are not.
 *
 * Everything here is deliberately generic — no worker, provider, or endpoint is named —
 * so any caller doing outbound HTTP can share it.
 *
 * Note on the casts: `target` is ES2020, whose `Error` type has neither `cause` nor
 * `AggregateError.errors`. Both exist on every Node this runs on, so they are read and
 * written through narrow structural casts rather than by widening the build's `lib`.
 */

/** Bound on how far `describeFetchFailure` follows `.cause`. Real chains are 2-3 deep;
 *  the limit only exists so a self-referencing cause cannot spin. */
const MAX_CAUSE_DEPTH = 5;

/** `errno`-style codes whose failure could plausibly clear on its own. `ENOTFOUND` and
 *  `EAI_AGAIN` are included on purpose: a permanently wrong hostname also reports
 *  `ENOTFOUND`, but so does a resolver that went away with the network, and one extra
 *  attempt is far cheaper than stranding every job behind a DNS blip. */
const TRANSIENT_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'EPIPE',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ENETUNREACH',
  'ENETDOWN',
  'EHOSTUNREACH',
  'EHOSTDOWN',
  'ERR_SOCKET_CONNECTION_TIMEOUT',
]);

/** Error names that carry the same meaning as the codes above. `AbortError` covers the
 *  call site's own `AbortSignal.timeout` budget expiring. */
const TRANSIENT_NAMES = new Set(['TimeoutError', 'ConnectTimeoutError', 'SocketError', 'AbortError']);

/** Marker for failures whose transience only the throw site knows — chiefly an HTTP
 *  status, which leaves no `code` behind once it has been turned into a message. */
const TRANSIENT_MARKER = Symbol('bfrost.transientFailure');

/** The parts of a runtime error this module reads but ES2020's `Error` type omits, plus
 *  the marker above — declared together so the reads below need one narrow cast each
 *  rather than a cast per property. */
type ErrorInternals = Error & {
  cause?: unknown;
  code?: unknown;
  errors?: unknown;
  [TRANSIENT_MARKER]?: boolean;
};

function codeOf(err: Error): string | null {
  const code = (err as ErrorInternals).code;
  return typeof code === 'string' && code ? code : null;
}

function causeOf(err: Error): unknown {
  return (err as ErrorInternals).cause;
}

/** An `AggregateError`'s children — Happy Eyeballs produces one per resolved address. */
function childErrorsOf(err: Error): unknown[] {
  const errors = (err as ErrorInternals).errors;
  return Array.isArray(errors) ? errors : [];
}

/** One error rendered on its own: its message, plus the `code` when that adds something
 *  the message does not already say (undici puts the reason in the message, Node's
 *  socket errors put it only in the code). */
function labelOf(err: Error): string {
  const message = err.message.trim();
  const code = codeOf(err);
  if (message && code && !message.includes(code)) return `${message} [${code}]`;
  if (message) return message;
  return code ?? err.name;
}

/** The children summarised as distinct labels — they are usually all the same failure
 *  repeated once per address, so collapsing duplicates keeps the line readable. */
function aggregateLabelOf(err: Error): string | null {
  const children = childErrorsOf(err);
  if (children.length === 0) return null;
  const labels = [...new Set(children.map((child) => (child instanceof Error ? labelOf(child) : String(child))))];
  return labels.join(', ');
}

/**
 * A one-line description of a failed request that names the underlying cause rather
 * than the wrapper. `TypeError: fetch failed` is dropped once a specific cause is
 * known, since it carries nothing the cause does not.
 */
export function describeFetchFailure(err: unknown): string {
  if (!(err instanceof Error)) return String(err);

  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = err;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current instanceof Error && !seen.has(current); depth += 1) {
    seen.add(current);
    const label = labelOf(current);
    const aggregate = aggregateLabelOf(current);
    const rendered = aggregate ? (label && label !== current.name ? `${label}: ${aggregate}` : aggregate) : label;
    if (rendered && !parts.includes(rendered)) parts.push(rendered);
    current = causeOf(current);
  }

  if (parts.length === 0) return err.name;
  if (parts.length === 1) return parts[0];

  const [outer, ...rest] = parts;
  // The generic wrapper adds nothing once the cause is in hand; every other layer is
  // kept, because intermediate wrappers usually say which call was being made.
  if (/^fetch failed$/i.test(outer)) return rest.join(': ');
  return `${outer} (${rest.join(': ')})`;
}

/**
 * The error to throw when an outbound request rejects: `context` says which call failed,
 * the described cause says why, and the original is preserved as `cause` so
 * `isTransientFetchFailure` can still read the real code upstream.
 */
export function fetchFailureError(context: string, err: unknown): Error {
  const wrapped = new Error(`${context}: ${describeFetchFailure(err)}`);
  (wrapped as ErrorInternals).cause = err;
  return wrapped;
}

/**
 * Mark an error the caller knows to be worth retrying — for HTTP statuses, whose
 * transience is lost the moment the response becomes a message. Returns the same error
 * so it can wrap a `throw`.
 */
export function flagTransientFailure<E extends Error>(err: E): E {
  Object.defineProperty(err, TRANSIENT_MARKER, { value: true, enumerable: false, configurable: true });
  return err;
}

/** HTTP statuses that say "ask again later" rather than "this request is wrong":
 *  timeouts, `Too Early`, rate limits, and every server-side error. */
export function isTransientHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/**
 * True when anything in the error's cause chain looks like a condition that could clear
 * on its own — a connect timeout, a reset, an unreachable network, or a status the throw
 * site flagged via `flagTransientFailure`.
 *
 * Deliberately optimistic, which is only safe because callers bound the number of
 * retries: one wasted attempt costs a few seconds, while misreading a network blip as a
 * permanent verdict costs a stranded item that deterministic ids can never re-publish.
 */
export function isTransientFetchFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return false;

  const queue: unknown[] = [err];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!(current instanceof Error) || seen.has(current)) continue;
    seen.add(current);

    if ((current as ErrorInternals)[TRANSIENT_MARKER] === true) return true;
    const code = codeOf(current);
    if (code && TRANSIENT_CODES.has(code)) return true;
    if (TRANSIENT_NAMES.has(current.name)) return true;

    queue.push(...childErrorsOf(current));
    const cause = causeOf(current);
    if (cause !== undefined) queue.push(cause);
  }
  return false;
}
