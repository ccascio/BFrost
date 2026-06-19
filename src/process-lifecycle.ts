export type ProcessFaultKind = 'unhandledRejection' | 'uncaughtException' | 'fatalStartupError';

export interface SerializedError {
  name?: string;
  message: string;
  stack?: string;
  code?: string | number;
}

export interface ProcessFaultLog {
  event: 'process_fault';
  kind: ProcessFaultKind;
  pid: number;
  timestamp: string;
  error: SerializedError;
}

export interface InstallProcessFaultHandlersOptions {
  cleanup: (kind: ProcessFaultKind, err: unknown) => Promise<void>;
}

export interface HandleProcessFaultOptions extends InstallProcessFaultHandlersOptions {
  exit?: (code: number) => void;
}

let handlingProcessFault = false;

export function serializeError(err: unknown): SerializedError {
  if (err instanceof Error) {
    const withCode = err as Error & { code?: string | number };
    return {
      name: err.name,
      message: err.message,
      ...(err.stack ? { stack: err.stack } : {}),
      ...(withCode.code !== undefined ? { code: withCode.code } : {}),
    };
  }

  if (typeof err === 'object' && err !== null) {
    try {
      return { message: JSON.stringify(err) };
    } catch {
      return { message: Object.prototype.toString.call(err) };
    }
  }

  return { message: String(err) };
}

export function logProcessFault(kind: ProcessFaultKind, err: unknown): void {
  const entry: ProcessFaultLog = {
    event: 'process_fault',
    kind,
    pid: process.pid,
    timestamp: new Date().toISOString(),
    error: serializeError(err),
  };
  console.error(`[BFrost] ${JSON.stringify(entry)}`);
}

export function logCleanupFailure(scope: string, err: unknown): void {
  console.warn(
    `[BFrost] ${JSON.stringify({
      event: 'cleanup_failure',
      scope,
      pid: process.pid,
      timestamp: new Date().toISOString(),
      error: serializeError(err),
    })}`,
  );
}

export function detach(promise: Promise<unknown>, label: string): void {
  promise.catch((err) => {
    console.warn(
      `[BFrost] ${JSON.stringify({
        event: 'detached_promise_rejection',
        label,
        pid: process.pid,
        timestamp: new Date().toISOString(),
        error: serializeError(err),
      })}`,
    );
  });
}

export function installProcessFaultHandlers(options: InstallProcessFaultHandlersOptions): void {
  process.on('unhandledRejection', (reason) => {
    void handleProcessFault('unhandledRejection', reason, options);
  });
  process.on('uncaughtException', (err) => {
    void handleProcessFault('uncaughtException', err, options);
  });
}

export async function handleProcessFault(
  kind: ProcessFaultKind,
  err: unknown,
  options: HandleProcessFaultOptions,
): Promise<void> {
  logProcessFault(kind, err);
  if (handlingProcessFault) {
    return;
  }

  handlingProcessFault = true;
  process.exitCode = 1;

  try {
    await options.cleanup(kind, err);
  } catch (cleanupErr) {
    logCleanupFailure(`process-fault:${kind}`, cleanupErr);
  } finally {
    if (options.exit) {
      options.exit(1);
    } else {
      process.exit(1);
    }
  }
}

export function resetProcessFaultHandlingForTests(): void {
  handlingProcessFault = false;
}
