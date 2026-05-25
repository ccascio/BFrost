/**
 * Persistence layer for the action approval queue.
 *
 * The `action_requests` table lives in the main app SQLite database alongside
 * `app_kv` and `event_log`. It is created idempotently on first access via
 * `ensureActionTable()`, which `src/index.ts` calls at startup.
 */

import { randomUUID } from 'crypto';
import { getAppDb } from '../sqlite';
import type { ActionClass, ActionRequest, ActionResult, ActionState, StoredActionRequest } from './types';

const TABLE = 'action_requests';

export async function ensureActionTable(): Promise<void> {
  const db = await getAppDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id          TEXT PRIMARY KEY,
      worker_id   TEXT NOT NULL,
      action_class TEXT NOT NULL,
      label       TEXT NOT NULL,
      rationale   TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      preview     TEXT,
      state       TEXT NOT NULL DEFAULT 'pending',
      created_at  TEXT NOT NULL,
      decided_at  TEXT,
      executed_at TEXT,
      result_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_action_requests_worker_id ON ${TABLE}(worker_id);
    CREATE INDEX IF NOT EXISTS idx_action_requests_state     ON ${TABLE}(state);
    CREATE INDEX IF NOT EXISTS idx_action_requests_created_at ON ${TABLE}(created_at DESC);
  `);
}

function rowToRequest(row: Record<string, unknown>): ActionRequest {
  return {
    id:          row['id'] as string,
    workerId:    row['worker_id'] as string,
    actionClass: row['action_class'] as ActionClass,
    label:       row['label'] as string,
    rationale:   row['rationale'] as string,
    payload:     JSON.parse((row['payload_json'] as string) || '{}'),
    preview:     (row['preview'] as string | null) ?? null,
    state:       row['state'] as ActionState,
    createdAt:   row['created_at'] as string,
    decidedAt:   (row['decided_at'] as string | null) ?? null,
    executedAt:  (row['executed_at'] as string | null) ?? null,
  };
}

export async function createActionRequest(opts: {
  workerId: string;
  actionClass: ActionClass;
  label: string;
  rationale: string;
  payload: Record<string, unknown>;
  preview: string | null;
}): Promise<ActionRequest> {
  const db = await getAppDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const state: ActionState = opts.actionClass === 'read-only' ? 'approved' : 'pending';

  db.prepare(
    `INSERT INTO ${TABLE}
     (id, worker_id, action_class, label, rationale, payload_json, preview, state, created_at, decided_at, executed_at, result_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    opts.workerId,
    opts.actionClass,
    opts.label,
    opts.rationale,
    JSON.stringify(opts.payload),
    opts.preview,
    state,
    now,
    state === 'approved' ? now : null,
    null,
    null,
  );

  return getActionRequest(id) as Promise<ActionRequest>;
}

export async function getActionRequest(id: string): Promise<ActionRequest | null> {
  const db = await getAppDb();
  const row = db.prepare(`SELECT * FROM ${TABLE} WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  return row ? rowToRequest(row) : null;
}

export async function listPendingActionRequests(): Promise<ActionRequest[]> {
  const db = await getAppDb();
  const rows = db.prepare(`SELECT * FROM ${TABLE} WHERE state = 'pending' ORDER BY created_at ASC`).all() as Record<string, unknown>[];
  return rows.map(rowToRequest);
}

export async function listActionRequests(opts?: { workerId?: string; limit?: number }): Promise<ActionRequest[]> {
  const db = await getAppDb();
  const limit = Math.min(opts?.limit ?? 50, 200);
  let sql = `SELECT * FROM ${TABLE}`;
  const params: unknown[] = [];
  if (opts?.workerId) {
    sql += ` WHERE worker_id = ?`;
    params.push(opts.workerId);
  }
  sql += ` ORDER BY created_at DESC LIMIT ${limit}`;
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(rowToRequest);
}

export async function approveActionRequest(id: string): Promise<ActionRequest | null> {
  const db = await getAppDb();
  const now = new Date().toISOString();
  const result = db.prepare(
    `UPDATE ${TABLE} SET state = 'approved', decided_at = ? WHERE id = ? AND state = 'pending'`,
  ).run(now, id);
  if (result.changes === 0) return null;
  return getActionRequest(id);
}

export async function rejectActionRequest(id: string): Promise<ActionRequest | null> {
  const db = await getAppDb();
  const now = new Date().toISOString();
  const result = db.prepare(
    `UPDATE ${TABLE} SET state = 'rejected', decided_at = ? WHERE id = ? AND state = 'pending'`,
  ).run(now, id);
  if (result.changes === 0) return null;
  return getActionRequest(id);
}

export async function markActionExecuted(id: string, result: ActionResult): Promise<ActionRequest | null> {
  const db = await getAppDb();
  const state: ActionState = result.ok ? 'executed' : 'failed';
  db.prepare(
    `UPDATE ${TABLE} SET state = ?, executed_at = ?, result_json = ? WHERE id = ?`,
  ).run(state, result.executedAt, JSON.stringify(result), id);
  return getActionRequest(id);
}
