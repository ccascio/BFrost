import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import { mkdtempSync } from 'fs';
import {
  validateInvocation,
  runShellCommand,
  ShellPolicyError,
  type ShellExecInput,
} from './sandbox';
import type { ShellPolicy } from './policy';

function policy(overrides: Partial<ShellPolicy> = {}): ShellPolicy {
  return {
    allowedCommands: ['echo', 'node'],
    timeoutSeconds: 10,
    maxOutputKb: 64,
    workingDir: mkdtempSync(path.join(os.tmpdir(), 'shell-sandbox-')),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Access controls
// ---------------------------------------------------------------------------

test('rejects every command when the allowlist is empty (fail-closed)', () => {
  assert.throws(
    () => validateInvocation({ command: 'echo' }, policy({ allowedCommands: [] })),
    (err: unknown) => err instanceof ShellPolicyError && /allowlist/i.test((err as Error).message),
  );
});

test('rejects a command that is not on the allowlist', () => {
  assert.throws(
    () => validateInvocation({ command: 'rm', args: ['-rf', '/'] }, policy()),
    (err: unknown) => err instanceof ShellPolicyError && /not allowed/i.test((err as Error).message),
  );
});

test('rejects a command name carrying a path separator', () => {
  assert.throws(
    () => validateInvocation({ command: '/bin/echo' }, policy({ allowedCommands: ['echo'] })),
    (err: unknown) => err instanceof ShellPolicyError && /bare binary name/i.test((err as Error).message),
  );
});

test('rejects args that are not an array of strings', () => {
  assert.throws(
    () => validateInvocation({ command: 'echo', args: [1 as unknown as string] }, policy()),
    ShellPolicyError,
  );
});

test('rejects a working directory that escapes the sandbox root', () => {
  assert.throws(
    () => validateInvocation({ command: 'echo', cwd: '../../etc' }, policy()),
    (err: unknown) => err instanceof ShellPolicyError && /escapes the sandbox/i.test((err as Error).message),
  );
});

test('accepts an allowlisted command and resolves cwd inside the root', () => {
  const p = policy();
  const resolved = validateInvocation({ command: ' echo ', args: ['hi'], cwd: 'sub' }, p);
  assert.equal(resolved.command, 'echo');
  assert.deepEqual(resolved.args, ['hi']);
  assert.equal(resolved.cwd, path.join(path.resolve(p.workingDir), 'sub'));
});

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

test('runs an allowlisted command and captures stdout + exit code', async () => {
  const result = await runShellCommand({ command: 'echo', args: ['hello world'] }, policy());
  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /hello world/);
});

test('does not leak host environment variables into the child', async () => {
  process.env.SHELL_WORKER_TEST_SECRET = 'top-secret-value';
  try {
    const result = await runShellCommand(
      {
        command: 'node',
        args: ['-e', 'process.stdout.write(process.env.SHELL_WORKER_TEST_SECRET || "ABSENT")'],
      },
      policy(),
    );
    assert.equal(result.stdout, 'ABSENT');
  } finally {
    delete process.env.SHELL_WORKER_TEST_SECRET;
  }
});

test('kills a command that exceeds the timeout', async () => {
  const result = await runShellCommand(
    { command: 'node', args: ['-e', 'setTimeout(() => {}, 60000)'] },
    policy({ timeoutSeconds: 1 }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.signal, 'SIGKILL');
});

test('truncates output beyond the configured cap', async () => {
  const result = await runShellCommand(
    { command: 'node', args: ['-e', 'process.stdout.write("x".repeat(5000))'] },
    policy({ maxOutputKb: 1 }),
  );
  assert.equal(result.truncated, true);
  assert.ok(result.stdout.length <= 1024);
});
