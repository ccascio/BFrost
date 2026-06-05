/**
 * The shell sandbox: validates an invocation against the policy and runs it.
 *
 * This is a *policy filter*, not an OS-level jail. It does not virtualise the filesystem
 * or drop OS privileges — an allowlisted `cat` can still read any file the host user can
 * by absolute path. What it does guarantee:
 *   - no shell is ever invoked (`execFile`, not `exec`) so arguments are passed literally
 *     and there is no metacharacter / injection surface;
 *   - only bare binary names on the operator allowlist may run (fail-closed);
 *   - an optional per-call cwd cannot escape the configured sandbox root;
 *   - the process is killed after the timeout and output is capped;
 *   - the child sees a scrubbed environment, so host secrets are not leaked into it.
 */
import { execFile } from 'child_process';
import { mkdir } from 'fs/promises';
import path from 'path';
import type { ShellPolicy } from './policy';

export interface ShellExecInput {
  /** Bare binary name (no path, no arguments). Must be on the policy allowlist. */
  command: string;
  /** Arguments passed literally to the binary — no shell interpretation. */
  args?: string[];
  /** Optional working directory, relative to the sandbox root. Cannot escape it. */
  cwd?: string;
}

export interface ShellExecResult {
  ok: boolean;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
}

/** Thrown when an invocation is rejected before anything is spawned. */
export class ShellPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShellPolicyError';
  }
}

const NUL = String.fromCharCode(0);

interface ResolvedInvocation {
  command: string;
  args: string[];
  cwd: string;
}

/** Apply every access control. Throws {@link ShellPolicyError} on the first violation. */
export function validateInvocation(input: ShellExecInput, policy: ShellPolicy): ResolvedInvocation {
  const command = typeof input.command === 'string' ? input.command.trim() : '';
  if (!command) {
    throw new ShellPolicyError('No command provided.');
  }
  if (command.includes('/') || command.includes('\\') || command.includes(NUL)) {
    throw new ShellPolicyError(
      `Command must be a bare binary name without path separators: "${input.command}".`,
    );
  }

  // Fail-closed allowlist: an empty list rejects everything.
  if (policy.allowedCommands.length === 0) {
    throw new ShellPolicyError(
      'The shell worker has an empty command allowlist. An operator must add commands in ' +
        'Config → Shell commands before any command can run.',
    );
  }
  if (!policy.allowedCommands.includes(command)) {
    throw new ShellPolicyError(
      `Command "${command}" is not allowed. Allowed commands: ${policy.allowedCommands.join(', ')}.`,
    );
  }

  const rawArgs = input.args ?? [];
  if (!Array.isArray(rawArgs) || rawArgs.some((arg) => typeof arg !== 'string')) {
    throw new ShellPolicyError('args must be an array of strings.');
  }
  const args = rawArgs as string[];
  if (args.some((arg) => arg.includes(NUL))) {
    throw new ShellPolicyError('Arguments must not contain NUL bytes.');
  }

  // Confine the working directory to the sandbox root.
  const root = path.resolve(policy.workingDir);
  const requested = input.cwd ? path.resolve(root, input.cwd) : root;
  const rel = path.relative(root, requested);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new ShellPolicyError('Working directory escapes the sandbox root.');
  }

  return { command, args, cwd: requested };
}

/**
 * Minimal environment for the child. Only PATH (so the binary resolves), HOME and LANG
 * are passed through; everything else on the host — including API keys and tokens — is
 * withheld from the command.
 */
function scrubbedEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: process.env.HOME ?? '/tmp',
    LANG: process.env.LANG ?? 'C',
  };
}

export async function runShellCommand(
  input: ShellExecInput,
  policy: ShellPolicy,
): Promise<ShellExecResult> {
  const { command, args, cwd } = validateInvocation(input, policy);
  await mkdir(cwd, { recursive: true });

  const maxBytes = policy.maxOutputKb * 1024;
  const startedAt = Date.now();

  return await new Promise<ShellExecResult>((resolve) => {
    execFile(
      command,
      args,
      {
        cwd,
        timeout: policy.timeoutSeconds * 1000,
        killSignal: 'SIGKILL', // SIGTERM is ignorable; force-kill on timeout
        maxBuffer: maxBytes,
        windowsHide: true,
        env: scrubbedEnv(),
      },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - startedAt;
        const err = error as
          | (NodeJS.ErrnoException & { signal?: NodeJS.Signals; killed?: boolean })
          | null;

        let out = stdout?.toString() ?? '';
        let errOut = stderr?.toString() ?? '';
        let truncated = !!err && err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';

        if (out.length > maxBytes) {
          out = out.slice(0, maxBytes);
          truncated = true;
        }
        if (errOut.length > maxBytes) {
          errOut = errOut.slice(0, maxBytes);
          truncated = true;
        }

        let exitCode: number | null = 0;
        let signal: string | null = null;
        if (err) {
          // execFile reports a non-zero exit as a numeric `code`; spawn-level failures
          // (ENOENT, timeout kill) carry a string code or none, with the signal set.
          exitCode = typeof err.code === 'number' ? err.code : null;
          signal = err.signal ?? null;
          if (err.code === 'ENOENT' && !errOut) {
            errOut = `Command not found on PATH: ${command}.`;
          }
        }

        resolve({ ok: !err, exitCode, signal, stdout: out, stderr: errOut, truncated, durationMs });
      },
    );
  });
}

/** Render a result into the compact text block returned to the assistant. */
export function formatResult(command: string, args: string[], result: ShellExecResult): string {
  const lines: string[] = [`$ ${[command, ...args].join(' ')}`];

  if (result.exitCode === null) {
    lines.push(
      result.signal ? `(terminated by ${result.signal})` : '(command failed to start)',
    );
  } else {
    lines.push(`exit code: ${result.exitCode}${result.signal ? ` (signal ${result.signal})` : ''}`);
  }

  const stdout = result.stdout.trimEnd();
  const stderr = result.stderr.trimEnd();
  if (stdout) lines.push(`\nstdout:\n${stdout}`);
  if (stderr) lines.push(`\nstderr:\n${stderr}`);
  if (!stdout && !stderr) lines.push('(no output)');
  if (result.truncated) lines.push('\n[output truncated to the configured limit]');
  lines.push(`\n(${result.durationMs} ms)`);

  return lines.join('\n');
}
