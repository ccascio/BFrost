import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detach,
  handleProcessFault,
  logProcessFault,
  resetProcessFaultHandlingForTests,
  serializeError,
} from './process-lifecycle';

function parseBfrostJson(line: string): unknown {
  assert.ok(line.startsWith('[BFrost] '));
  return JSON.parse(line.slice('[BFrost] '.length)) as unknown;
}

test('serializeError preserves useful Error fields', () => {
  const err = new Error('boom') as Error & { code?: string };
  err.code = 'E_BOOM';
  const serialized = serializeError(err);

  assert.equal(serialized.name, 'Error');
  assert.equal(serialized.message, 'boom');
  assert.equal(serialized.code, 'E_BOOM');
  assert.equal(typeof serialized.stack, 'string');
});

test('serializeError tolerates non-Error circular values', () => {
  const circular: { self?: unknown } = {};
  circular.self = circular;

  assert.equal(serializeError(circular).message, '[object Object]');
});

test('logProcessFault emits one structured log line', () => {
  const originalError = console.error;
  const lines: string[] = [];
  console.error = (line?: unknown) => {
    lines.push(String(line));
  };

  try {
    logProcessFault('unhandledRejection', new Error('forced rejection'));
  } finally {
    console.error = originalError;
  }

  assert.equal(lines.length, 1);
  const parsed = parseBfrostJson(lines[0]) as {
    event: string;
    kind: string;
    error: { message: string };
  };
  assert.equal(parsed.event, 'process_fault');
  assert.equal(parsed.kind, 'unhandledRejection');
  assert.equal(parsed.error.message, 'forced rejection');
});

test('handleProcessFault logs, cleans up, and exits with a defined failure code', async () => {
  const originalError = console.error;
  const previousExitCode = process.exitCode;
  const lines: string[] = [];
  const cleanupKinds: string[] = [];
  const exitCodes: number[] = [];
  console.error = (line?: unknown) => {
    lines.push(String(line));
  };
  resetProcessFaultHandlingForTests();

  try {
    await handleProcessFault('uncaughtException', new Error('bad'), {
      cleanup: async (kind) => {
        cleanupKinds.push(kind);
      },
      exit: (code) => {
        exitCodes.push(code);
      },
    });
  } finally {
    console.error = originalError;
    process.exitCode = previousExitCode;
    resetProcessFaultHandlingForTests();
  }

  assert.equal(lines.length, 1);
  assert.deepEqual(cleanupKinds, ['uncaughtException']);
  assert.deepEqual(exitCodes, [1]);
});

test('detach logs rejected background work with its label', async () => {
  const originalWarn = console.warn;
  const lines: string[] = [];
  console.warn = (line?: unknown) => {
    lines.push(String(line));
  };

  try {
    detach(Promise.reject(new Error('background failed')), 'test:background');
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(lines.length, 1);
  const parsed = parseBfrostJson(lines[0]) as {
    event: string;
    label: string;
    error: { message: string };
  };
  assert.equal(parsed.event, 'detached_promise_rejection');
  assert.equal(parsed.label, 'test:background');
  assert.equal(parsed.error.message, 'background failed');
});
