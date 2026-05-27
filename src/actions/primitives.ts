/**
 * Built-in safe primitives for the permissioned action runtime.
 *
 * Workers call these helpers instead of touching `fs` directly. Each primitive:
 *   1. Creates an ActionRequest with a human-readable preview.
 *   2. For `read-only` actions: executes immediately and returns.
 *   3. For `approved-write` actions: polls the approval queue until approved or
 *      rejected (or the timeout elapses), then executes and records the result.
 *
 * Permission scopes (WorkerManifest.permissions):
 *   When `permissions` is absent on the worker's manifest the worker is unrestricted.
 *   When present, only explicitly listed scopes pass — everything else throws a
 *   `PermissionDeniedError` before any action request is created.
 *
 * Current primitives:
 *   - requestFileRead  — read-only; no approval needed.
 *   - requestFileWrite — approved-write; blocks until the operator reviews a diff.
 *   - requestShell     — approved-write; runs a child process after operator approval.
 */

import { promises as fs, existsSync } from 'fs';
import { spawn } from 'child_process';
import path from 'path';
import { recordEventSafe } from '../event-log';
import {
  approveActionRequest,
  createActionRequest,
  getActionRequest,
  markActionExecuted,
} from './store';
import type { ActionResult } from './types';

// ---------------------------------------------------------------------------
// Permission scope enforcement
// ---------------------------------------------------------------------------

/**
 * Thrown when a worker attempts an action outside its declared permission scopes.
 */
export class PermissionDeniedError extends Error {
  constructor(workerId: string, scope: string) {
    super(`Worker "${workerId}" does not have permission: ${scope}`);
    this.name = 'PermissionDeniedError';
  }
}

/**
 * Returns the `permissions` array for the given worker, or `undefined` (unrestricted)
 * when the worker has no manifest or no declared permissions.
 *
 * Lazy-required to avoid a circular import: registry → builtin workers → primitives.
 */
function getWorkerPermissions(workerId: string): string[] | undefined {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const registry = require('../workers/registry') as typeof import('../workers/registry');
  const manifest = registry.listWorkers().find((w) => w.id === workerId);
  return manifest?.permissions;
}

/**
 * Checks whether `workerId` holds `scope`. If `permissions` is absent the worker is
 * unrestricted. If it is present the scope must match either exactly or via a wildcard
 * suffix (`file:read:*` covers all `file:read:` scopes; `shell:*` covers all `shell:` scopes).
 *
 * @throws {PermissionDeniedError} when the check fails.
 */
function assertPermission(workerId: string, scope: string): void {
  const permissions = getWorkerPermissions(workerId);
  if (permissions === undefined) return; // Unrestricted — no permissions field declared.

  const [kind, verb] = scope.split(':');
  const wildcardScope = `${kind}:${verb}:*`;

  const allowed =
    permissions.includes(scope) ||
    permissions.includes(wildcardScope);

  if (!allowed) {
    throw new PermissionDeniedError(workerId, scope);
  }
}

// ---------------------------------------------------------------------------
// Diff helper (no external deps)
// ---------------------------------------------------------------------------

function buildDiff(oldLines: string[], newLines: string[], filePath: string): string {
  const header = `--- ${filePath} (existing)\n+++ ${filePath} (proposed)\n`;
  // Naive line-by-line diff — sufficient for a review preview.
  const maxCtx = 3;
  const hunks: string[] = [];
  let i = 0, j = 0;
  const changes: Array<{ type: '+' | '-' | ' '; line: string }> = [];

  // LCS-free approach: align via indices until one list runs out
  while (i < oldLines.length || j < newLines.length) {
    const o = oldLines[i];
    const n = newLines[j];
    if (i >= oldLines.length) {
      changes.push({ type: '+', line: newLines[j++] });
    } else if (j >= newLines.length) {
      changes.push({ type: '-', line: oldLines[i++] });
    } else if (o === n) {
      changes.push({ type: ' ', line: o });
      i++; j++;
    } else {
      // Try lookahead of 2 to find a match
      let matched = false;
      for (let look = 1; look <= 2; look++) {
        if (newLines[j + look] === o) {
          for (let k = 0; k < look; k++) changes.push({ type: '+', line: newLines[j++] });
          matched = true; break;
        }
        if (oldLines[i + look] === n) {
          for (let k = 0; k < look; k++) changes.push({ type: '-', line: oldLines[i++] });
          matched = true; break;
        }
      }
      if (!matched) {
        changes.push({ type: '-', line: oldLines[i++] });
        changes.push({ type: '+', line: newLines[j++] });
      }
    }
  }

  // Group into hunks around changed lines
  const changedIdxs = changes.map((c, idx) => c.type !== ' ' ? idx : -1).filter((x) => x >= 0);
  if (changedIdxs.length === 0) return header + '(no changes)\n';

  const hunkStart = Math.max(0, changedIdxs[0] - maxCtx);
  const hunkEnd   = Math.min(changes.length - 1, changedIdxs[changedIdxs.length - 1] + maxCtx);
  const lines: string[] = [];
  for (let k = hunkStart; k <= hunkEnd; k++) {
    const c = changes[k];
    lines.push(`${c.type}${c.line}`);
  }
  hunks.push(`@@ -${hunkStart + 1} +${hunkStart + 1} @@\n` + lines.join('\n'));

  return header + hunks.join('\n');
}

function buildNewFileDiff(newLines: string[], filePath: string): string {
  const header = `--- /dev/null\n+++ ${filePath} (new file)\n@@ -0,0 +1,${newLines.length} @@\n`;
  return header + newLines.map((l) => `+${l}`).join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Poll helper — waits for an approved-write request to be decided
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

async function waitForDecision(requestId: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const req = await getActionRequest(requestId);
    if (!req) return false;
    if (req.state === 'approved') return true;
    if (req.state === 'rejected') return false;
    await new Promise<void>((res) => setTimeout(res, POLL_INTERVAL_MS));
  }
  return false;
}

// ---------------------------------------------------------------------------
// requestFileRead — read-only, no approval needed
// ---------------------------------------------------------------------------

export async function requestFileRead(
  workerId: string,
  filePath: string,
): Promise<string> {
  const absPath = path.resolve(filePath);
  assertPermission(workerId, `file:read:${absPath}`);

  const request = await createActionRequest({
    workerId,
    actionClass: 'read-only',
    label: 'Read file',
    rationale: `Worker ${workerId} is reading ${absPath}`,
    payload: { path: absPath },
    preview: null,
  });

  const content = await fs.readFile(absPath, 'utf8');

  const result: ActionResult = {
    requestId: request.id,
    ok: true,
    output: `Read ${content.length} bytes from ${absPath}`,
    executedAt: new Date().toISOString(),
  };
  await markActionExecuted(request.id, result);
  await recordEventSafe({
    category: 'actions',
    action: 'file-read',
    severity: 'info',
    summary: `[${workerId}] Read file: ${absPath}`,
    metadata: { requestId: request.id, workerId, path: absPath },
  });

  return content;
}

// ---------------------------------------------------------------------------
// requestFileWrite — approved-write; blocks until operator approves
// ---------------------------------------------------------------------------

export async function requestFileWrite(
  workerId: string,
  filePath: string,
  content: string,
  opts?: { rationale?: string; timeoutMs?: number },
): Promise<{ approved: boolean; requestId: string }> {
  const absPath = path.resolve(filePath);
  assertPermission(workerId, `file:write:${absPath}`);

  const newLines = content.split('\n');

  let preview: string;
  if (existsSync(absPath)) {
    const existing = await fs.readFile(absPath, 'utf8');
    if (existing === content) {
      // No change — treat as read-only
      const req = await createActionRequest({
        workerId,
        actionClass: 'read-only',
        label: 'Write file (no change)',
        rationale: opts?.rationale ?? `Worker ${workerId} would write ${absPath} (content unchanged)`,
        payload: { path: absPath },
        preview: '(no changes)',
      });
      await markActionExecuted(req.id, { requestId: req.id, ok: true, output: 'no-op (content unchanged)', executedAt: new Date().toISOString() });
      return { approved: true, requestId: req.id };
    }
    preview = buildDiff(existing.split('\n'), newLines, absPath);
  } else {
    preview = buildNewFileDiff(newLines, absPath);
  }

  const request = await createActionRequest({
    workerId,
    actionClass: 'approved-write',
    label: 'Write file',
    rationale: opts?.rationale ?? `Worker ${workerId} wants to write ${absPath}`,
    payload: { path: absPath, byteCount: Buffer.byteLength(content, 'utf8') },
    preview,
  });

  await recordEventSafe({
    category: 'actions',
    action: 'file-write-requested',
    severity: 'info',
    summary: `[${workerId}] Requested write to: ${absPath} (awaiting approval)`,
    metadata: { requestId: request.id, workerId, path: absPath },
  });

  const approved = await waitForDecision(request.id, opts?.timeoutMs);

  if (!approved) {
    const resultRejected: ActionResult = {
      requestId: request.id,
      ok: false,
      error: 'Rejected by operator or timed out',
      executedAt: new Date().toISOString(),
    };
    await markActionExecuted(request.id, resultRejected);
    await recordEventSafe({
      category: 'actions',
      action: 'file-write-rejected',
      severity: 'warning',
      summary: `[${workerId}] File write rejected or timed out: ${absPath}`,
      metadata: { requestId: request.id, workerId, path: absPath },
    });
    return { approved: false, requestId: request.id };
  }

  try {
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, content, 'utf8');
    const resultOk: ActionResult = {
      requestId: request.id,
      ok: true,
      output: `Wrote ${Buffer.byteLength(content, 'utf8')} bytes to ${absPath}`,
      executedAt: new Date().toISOString(),
    };
    await markActionExecuted(request.id, resultOk);
    await recordEventSafe({
      category: 'actions',
      action: 'file-write-executed',
      severity: 'info',
      summary: `[${workerId}] Wrote file: ${absPath}`,
      metadata: { requestId: request.id, workerId, path: absPath },
    });
    return { approved: true, requestId: request.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const resultErr: ActionResult = {
      requestId: request.id,
      ok: false,
      error: msg,
      executedAt: new Date().toISOString(),
    };
    await markActionExecuted(request.id, resultErr);
    await recordEventSafe({
      category: 'actions',
      action: 'file-write-failed',
      severity: 'error',
      summary: `[${workerId}] File write failed: ${absPath} — ${msg}`,
      metadata: { requestId: request.id, workerId, path: absPath, error: msg },
    });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// requestShell — approved-write; runs a child process after operator approval
// ---------------------------------------------------------------------------

export interface ShellResult {
  approved: boolean;
  requestId: string;
  /** Present only when the command was actually executed. */
  output?: { stdout: string; stderr: string; exitCode: number };
}

/**
 * Request approval to run `command` with the given `args`. Blocks until the operator
 * approves or rejects (or `timeoutMs` elapses).
 *
 * The command name is validated against the worker's `permissions` list using the
 * `shell:<command-name>` scope. Use `shell:*` in the manifest to allow any command.
 *
 * stdout/stderr are captured and stored in the action result; both are truncated to
 * 64 KiB to avoid storing runaway output in the DB.
 */
export async function requestShell(
  workerId: string,
  command: string,
  args: string[] = [],
  opts?: {
    rationale?: string;
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
    /** Max bytes to capture from stdout/stderr (default 65536). */
    maxOutputBytes?: number;
  },
): Promise<ShellResult> {
  assertPermission(workerId, `shell:${command}`);

  const displayCmd = [command, ...args].join(' ');
  const preview = `$ ${displayCmd}${opts?.cwd ? `\n# cwd: ${opts.cwd}` : ''}`;

  const request = await createActionRequest({
    workerId,
    actionClass: 'approved-write',
    label: `Run: ${displayCmd.slice(0, 80)}`,
    rationale: opts?.rationale ?? `Worker ${workerId} wants to run: ${displayCmd}`,
    payload: { command, args, cwd: opts?.cwd ?? null },
    preview,
  });

  await recordEventSafe({
    category: 'actions',
    action: 'shell-requested',
    severity: 'info',
    summary: `[${workerId}] Requested shell: ${displayCmd} (awaiting approval)`,
    metadata: { requestId: request.id, workerId, command, args },
  });

  const approved = await waitForDecision(request.id, opts?.timeoutMs);

  if (!approved) {
    await markActionExecuted(request.id, {
      requestId: request.id,
      ok: false,
      error: 'Rejected by operator or timed out',
      executedAt: new Date().toISOString(),
    });
    await recordEventSafe({
      category: 'actions',
      action: 'shell-rejected',
      severity: 'warning',
      summary: `[${workerId}] Shell command rejected or timed out: ${displayCmd}`,
      metadata: { requestId: request.id, workerId, command },
    });
    return { approved: false, requestId: request.id };
  }

  // Execute the command and capture output.
  const maxBytes = opts?.maxOutputBytes ?? 65536;
  const execResult = await new Promise<{ stdout: string; stderr: string; exitCode: number }>(
    (resolve, reject) => {
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutSize = 0, stderrSize = 0;

      const child = spawn(command, args, {
        cwd: opts?.cwd,
        env: opts?.env ? { ...process.env, ...opts.env } : process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      child.stdout.on('data', (chunk: Buffer) => {
        const remaining = maxBytes - stdoutSize;
        if (remaining > 0) {
          stdoutChunks.push(chunk.subarray(0, remaining));
          stdoutSize += Math.min(chunk.length, remaining);
        }
      });
      child.stderr.on('data', (chunk: Buffer) => {
        const remaining = maxBytes - stderrSize;
        if (remaining > 0) {
          stderrChunks.push(chunk.subarray(0, remaining));
          stderrSize += Math.min(chunk.length, remaining);
        }
      });
      child.on('close', (code) => {
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
          exitCode: code ?? 1,
        });
      });
      child.on('error', reject);
    },
  );

  const ok = execResult.exitCode === 0;
  await markActionExecuted(request.id, {
    requestId: request.id,
    ok,
    output: `exit ${execResult.exitCode}\n${execResult.stdout}`,
    error: ok ? undefined : execResult.stderr || `exit code ${execResult.exitCode}`,
    executedAt: new Date().toISOString(),
  });
  await recordEventSafe({
    category: 'actions',
    action: ok ? 'shell-executed' : 'shell-failed',
    severity: ok ? 'info' : 'error',
    summary: `[${workerId}] Shell ${ok ? 'completed' : 'failed'}: ${displayCmd} (exit ${execResult.exitCode})`,
    metadata: { requestId: request.id, workerId, command, exitCode: execResult.exitCode },
  });

  return { approved: true, requestId: request.id, output: execResult };
}
