import { config } from './config';

/**
 * Lightweight timing diagnostics for slow operations.
 *
 * Debug logging is deliberately opt-in. It writes only operation names, timestamps,
 * durations, and success/failure status — never SQL parameters, request bodies, or
 * provider credentials.
 */
export function isDebugLoggingEnabled(): boolean {
  return config.logLevel === 'debug';
}

export interface DebugOperation {
  finish(error?: unknown): void;
}

/** Start a timed operation and return its completion marker. */
export function startDebugOperation(label: string): DebugOperation {
  if (!isDebugLoggingEnabled()) {
    return { finish: () => undefined };
  }

  const startedAt = new Date().toISOString();
  const started = performance.now();
  console.debug(`[DEBUG] ${startedAt} START ${label}`);

  let finished = false;
  return {
    finish(error?: unknown): void {
      if (finished) return;
      finished = true;
      const finishedAt = new Date().toISOString();
      const durationMs = (performance.now() - started).toFixed(2);
      const status = error === undefined ? 'ok' : 'error';
      const errorType = error === undefined ? '' : ` errorType=${error instanceof Error ? error.name : typeof error}`;
      console.debug(`[DEBUG] ${finishedAt} END ${label} status=${status} durationMs=${durationMs}${errorType}`);
    },
  };
}

/** Time a synchronous operation without changing its return value or errors. */
export function withDebugTiming<T>(label: string, operation: () => T): T {
  const timer = startDebugOperation(label);
  let failed = false;
  let failure: unknown;
  try {
    return operation();
  } catch (error) {
    failed = true;
    failure = error;
    throw error;
  } finally {
    timer.finish(failed ? failure : undefined);
  }
}

/** Time an asynchronous operation without changing its return value or errors. */
export async function withDebugTimingAsync<T>(label: string, operation: () => Promise<T>): Promise<T> {
  const timer = startDebugOperation(label);
  let failed = false;
  let failure: unknown;
  try {
    return await operation();
  } catch (error) {
    failed = true;
    failure = error;
    throw error;
  } finally {
    timer.finish(failed ? failure : undefined);
  }
}

/**
 * Install one process-wide fetch boundary so network calls made by built-in and local
 * workers are visible without requiring every worker to import a logging helper.
 * Query strings are intentionally omitted because they may contain credentials or payloads.
 */
export function installDebugFetchInstrumentation(): void {
  if (!isDebugLoggingEnabled()) return;
  const target = globalThis as typeof globalThis & { __BFrostDebugFetchInstalled?: boolean };
  if (target.__BFrostDebugFetchInstalled || typeof globalThis.fetch !== 'function') return;
  target.__BFrostDebugFetchInstalled = true;

  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
    if (!isDebugLoggingEnabled()) return originalFetch(...args);
    const input = args[0];
    const rawUrl = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    return withDebugTimingAsync(`http.fetch ${safeFetchTarget(rawUrl)}`, () => originalFetch(...args));
  }) as typeof fetch;
}

/** Reduce arbitrary URLs to an origin so path/query credentials can never reach logs. */
export function safeFetchTarget(rawUrl: string): string {
  try {
    return new URL(rawUrl).origin;
  } catch {
    return '<invalid-url>';
  }
}

