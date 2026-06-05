import type { AdminApiRoute } from '../../../admin-route';
import { recordEventSafe } from '../../../event-log';
import { savePolicy, ShellPolicySchema } from './policy';

/**
 * Backs the Config → Shell commands form. The form posts the full policy; the schema is
 * defined locally (never in core `admin-api.ts`) so the worker stays self-contained.
 */
export const shellApiRoutes: AdminApiRoute[] = [
  {
    method: 'POST',
    path: '/api/shell-policy',
    workerIds: ['core.shell'],
    async handle({ req, readJsonBody }) {
      const body = await readJsonBody(req, ShellPolicySchema);
      const policy = await savePolicy(body);
      await recordEventSafe({
        category: 'worker',
        action: 'shell_policy_updated',
        summary: 'Shell command policy updated.',
        metadata: {
          workerId: 'core.shell',
          allowedCommands: policy.allowedCommands.length,
          timeoutSeconds: policy.timeoutSeconds,
          maxOutputKb: policy.maxOutputKb,
        },
      });
      return { status: 200, body: { ok: true, allowedCommands: policy.allowedCommands.length } };
    },
  },
];
