import { HttpRouter } from '../router';
import { readJsonBody, sendJson } from '../responses';
import { ActiveScopeBodySchema } from '../../admin-api';
import { getActiveScopeId, setActiveScopeId, getScopeProviderWorkerId } from '../../active-scope';
import { recordEventSafe } from '../../event-log';

// Generic, worker-agnostic active-scope endpoints. The core exposes which worker provides
// scopes and the active scope id; the option list itself lives in that worker's dashboard
// data slice, never here.
export function registerScopeRoutes(router: HttpRouter): void {
  router.add('GET', '/api/active-scope', async (_req, res) => {
    sendJson(res, 200, {
      providerWorkerId: getScopeProviderWorkerId(),
      activeScopeId: await getActiveScopeId(),
    });
  });

  router.add('PUT', '/api/active-scope', async (req, res) => {
    const body = await readJsonBody(req, ActiveScopeBodySchema);
    const activeScopeId = await setActiveScopeId(body.scopeId);
    await recordEventSafe({
      category: 'admin',
      action: 'active_scope_changed',
      summary: `Active scope set to ${activeScopeId ?? 'none'}.`,
      metadata: { activeScopeId },
    });
    sendJson(res, 200, {
      providerWorkerId: getScopeProviderWorkerId(),
      activeScopeId,
    });
  });
}
