/**
 * Built-in safe primitives for the permissioned action runtime.
 *
 * Workers call these helpers instead of touching `fs` directly. Each primitive:
 *   1. Creates an ActionRequest with a human-readable preview.
 *   2. For `read-only` actions: executes immediately and returns.
 *   3. For `approved-write` actions: polls the approval queue until approved or
 *      rejected (or the timeout elapses), then executes and records the result.
 *
 * Current primitives:
 *   - requestFileRead  — read-only; no approval needed.
 *   - requestFileWrite — approved-write; blocks until the operator reviews a diff.
 */

import { promises as fs, existsSync } from 'fs';
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

  let hunkStart = Math.max(0, changedIdxs[0] - maxCtx);
  let hunkEnd   = Math.min(changes.length - 1, changedIdxs[changedIdxs.length - 1] + maxCtx);
  const lines: string[] = [];
  let oldLine = hunkStart + 1, newLine = hunkStart + 1;
  for (let k = hunkStart; k <= hunkEnd; k++) {
    const c = changes[k];
    lines.push(`${c.type}${c.line}`);
    if (c.type === '-') newLine--;
    if (c.type === '+') oldLine--;
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
