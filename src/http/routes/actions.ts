import path from 'path';
import { promises as fs } from 'fs';
import { z } from 'zod';
import { HttpRouter } from '../router';
import { readJsonBody, sendJson } from '../responses';
import { recordEventSafe } from '../../event-log';
import { collectRecipes } from '../../workers/registry';
import { reloadSchedulerSchedules } from '../../scheduler';
import { setWorkerEnabled } from '../../workers/state';
import { updatePlatformSettings } from '../../admin-config';
import { openWorkerKv } from '../../workers/storage';
import { loadKvJson, saveKvJson } from '../../sqlite';
import { buildDashboardState } from '../../admin-dashboard-state';
import {
  listPendingActionRequests,
  listActionRequests,
  approveActionRequest,
  rejectActionRequest,
} from '../../actions';
import { ActionDecisionBodySchema, RecipeApplyBodySchema } from '../../admin-api';

export function registerActionRoutes(router: HttpRouter): void {
  router.add('GET', '/api/actions/pending', async (_req, res) => {
    const pending = await listPendingActionRequests();
    return sendJson(res, 200, { pendingActions: pending });
  });

  router.add('GET', '/api/actions', async (_req, res, { url }) => {
    const workerId = url.searchParams.get('workerId') ?? undefined;
    const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
    const actions = await listActionRequests({ workerId, limit });
    return sendJson(res, 200, { actions });
  });

  router.add('GET', '/api/wizard/state', async (_req, res) => {
    const state = await loadKvJson<{ step?: number; completed?: boolean }>('wizard.state') ?? {};
    const envExists = await fs.access(path.join(process.cwd(), '.env')).then(() => true, () => false);
    const completed = envExists ? (state.completed ?? false) : false;
    return sendJson(res, 200, { step: state.step ?? 0, completed });
  });

  router.add('POST', '/api/wizard/state', async (req, res) => {
    const body = await readJsonBody(req, z.object({
      step: z.number().int().min(0).max(8).optional(),
      completed: z.boolean().optional(),
    }).strict());
    const prev = await loadKvJson<{ step?: number; completed?: boolean }>('wizard.state') ?? {};
    const next = { ...prev, ...body };
    await saveKvJson('wizard.state', next);
    return sendJson(res, 200, { ok: true, ...next });
  });

  router.add('POST', '/api/recipes/apply', async (req, res) => {
    const body = await readJsonBody(req, RecipeApplyBodySchema);
    const recipes = collectRecipes();
    const recipe = recipes.find((r) => r.id === body.recipeId);
    if (!recipe) {
      return sendJson(res, 404, { error: `Recipe "${body.recipeId}" not found.` });
    }

    // Enable each step's worker (builtins only; local workers are not recipe targets).
    for (const step of recipe.steps) {
      await setWorkerEnabled(step.workerId, true, { builtIn: true });
    }
    await reloadSchedulerSchedules();

    // Apply provided inputs to their storage targets.
    const inputs = body.inputs ?? {};
    const missing: string[] = [];
    for (const input of recipe.requiredInputs ?? []) {
      const value = inputs[input.key];
      if (!value?.trim()) {
        missing.push(input.key);
        continue;
      }
      if (input.storage.type === 'worker-kv') {
        const kv = openWorkerKv(input.storage.workerId);
        const current = (await kv.get<Record<string, string>>(input.storage.kvKey)) ?? {};
        await kv.set(input.storage.kvKey, { ...current, [input.storage.kvField]: value.trim() });
      } else if (input.storage.type === 'global-kv-array') {
        const stored = await loadKvJson<Record<string, unknown>>(input.storage.kvKey) ?? {};
        const arr = Array.isArray(stored[input.storage.arrayField]) ? stored[input.storage.arrayField] as string[] : [];
        if (!arr.includes(value.trim())) arr.push(value.trim());
        await saveKvJson(input.storage.kvKey, { ...stored, [input.storage.arrayField]: arr });
      }
    }

    // Apply any platform-level settings.
    if (recipe.platformSettings?.primaryChannelId) {
      await updatePlatformSettings({ primaryChannelId: recipe.platformSettings.primaryChannelId });
    }

    return sendJson(res, 200, {
      ok: true,
      applied: missing.length === 0,
      missing,
      dashboard: await buildDashboardState(),
    });
  });

  router.add('POST', '/api/actions/:id/:decision', async (req, res, { params }) => {
    const requestId = params.id;
    const decision = params.decision;
    if (decision !== 'approve' && decision !== 'reject') {
      return sendJson(res, 404, { error: 'Not found' });
    }
    await readJsonBody(req, ActionDecisionBodySchema).catch(() => ({}));
    const updated = decision === 'approve'
      ? await approveActionRequest(requestId)
      : await rejectActionRequest(requestId);
    if (!updated) {
      return sendJson(res, 404, { error: 'Action request not found or already decided.' });
    }
    await recordEventSafe({
      category: 'actions',
      action: `action-${decision}d`,
      severity: 'info',
      summary: `Action request ${requestId} ${decision}d by operator.`,
      metadata: { requestId, workerId: updated.workerId, label: updated.label },
    });
    return sendJson(res, 200, { ok: true, action: updated });
  });
}
