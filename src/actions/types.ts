/**
 * Permissioned Action Runtime — types (Workstream 5)
 *
 * An ActionRequest is raised by a worker when it wants to perform a real-world
 * write. The runtime blocks execution until the operator approves or rejects the
 * request through the dashboard. Every request and its outcome are audited via
 * the existing event log.
 *
 * Action classes determine how the runtime handles a request:
 *   - read-only:         No approval needed. Executes immediately and is logged.
 *   - approved-write:    Blocks until the operator approves. Shows a diff preview.
 *   - draft:             (future) Saves a draft artifact for review; no destructive write.
 *   - trusted-automation:(future) Auto-approved for workers in the Trusted tier.
 *   - blocked:           Always rejected; no further evaluation.
 */

export type ActionClass =
  | 'read-only'
  | 'approved-write'
  | 'draft'              // stub — not yet implemented
  | 'trusted-automation' // stub — not yet implemented
  | 'blocked';

export type ActionState = 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';

export interface ActionRequest {
  id: string;
  workerId: string;
  actionClass: ActionClass;
  /** Short verb-noun description shown in the dashboard (e.g. "Write file"). */
  label: string;
  /** Human-readable explanation of why this action is being requested. */
  rationale: string;
  /** Opaque payload specific to the primitive (path + content for file-write, etc.). */
  payload: Record<string, unknown>;
  /** Diff or preview rendered for the operator before approval. Null for read-only actions. */
  preview: string | null;
  state: ActionState;
  createdAt: string;
  decidedAt: string | null;
  executedAt: string | null;
}

export interface ActionApproval {
  requestId: string;
  approved: boolean;
  /** Optional note the operator can add when approving or rejecting. */
  note?: string;
}

export interface ActionResult {
  requestId: string;
  ok: boolean;
  output?: string;
  error?: string;
  executedAt: string;
}

/** Stored in SQLite; id and workerId are indexed. */
export interface StoredActionRequest {
  id: string;
  workerId: string;
  actionClass: ActionClass;
  label: string;
  rationale: string;
  payloadJson: string;
  preview: string | null;
  state: ActionState;
  createdAt: string;
  decidedAt: string | null;
  executedAt: string | null;
  resultJson: string | null;
}
