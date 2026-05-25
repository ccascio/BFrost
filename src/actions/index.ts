/**
 * Permissioned Action Runtime — public re-exports (Workstream 5).
 *
 * Import from here in core code (admin-server, index.ts, sdk.ts) rather than
 * the individual sub-modules.
 */

export type {
  ActionClass,
  ActionState,
  ActionRequest,
  ActionApproval,
  ActionResult,
  StoredActionRequest,
} from './types';

export {
  ensureActionTable,
  createActionRequest,
  getActionRequest,
  listPendingActionRequests,
  listActionRequests,
  approveActionRequest,
  rejectActionRequest,
  markActionExecuted,
} from './store';

export { requestFileRead, requestFileWrite } from './primitives';
