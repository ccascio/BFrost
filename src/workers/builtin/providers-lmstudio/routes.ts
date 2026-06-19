import type { AdminApiRoute } from '../../../admin-route';
import { BadRequestError } from '../../../admin-route';
import { getDefaultModel } from '../../../config';
import { recordEventSafe } from '../../../event-log';
import { refreshActiveLocalProviderModels } from '../../../model-discovery';
import { LocalRuntimeActionBodySchema, LocalRuntimeModelsSectionSchema } from '../../../admin-api';
import { getActiveLocalProvider } from '../../../workers/registry';
import { getMemoryCleanupSpec, probeMemoryCleanup, runMemoryCleanup } from './runtime';

const WORKER_ID = 'core.providers.lmstudio';

async function buildStatus() {
  const spec = getMemoryCleanupSpec();
  const configured = await probeMemoryCleanup();
  return {
    platform: spec.platform,
    supported: spec.platform === 'darwin' || spec.platform === 'linux',
    configured,
    command: spec.command ?? null,
    sudoersLine: spec.sudoersLine ?? null,
    sudoersDropInPath: '/etc/sudoers.d/bfrost-memory',
  };
}

export const lmStudioProviderApiRoutes: AdminApiRoute[] = [
  {
    method: 'GET',
    path: '/api/dashboard/lmstudio-models',
    workerIds: [WORKER_ID],
    async handle() {
      const localProvider = getActiveLocalProvider();
      if (!localProvider?.listLoadedModels) {
        return { status: 200, body: LocalRuntimeModelsSectionSchema.parse({ loadedModels: [] }) };
      }
      const loaded = await localProvider.listLoadedModels();
      return {
        status: 200,
        body: LocalRuntimeModelsSectionSchema.parse({
          loadedModels: loaded.map((item) => item.modelKey || item.identifier || 'unknown'),
        }),
      };
    },
  },
  {
    method: 'POST',
    path: '/api/lmstudio',
    workerIds: [WORKER_ID],
    async handle({ req, readJsonBody }) {
      // Lazy-require to break the CJS cycle:
      //   admin-worker-ops → workers/builtin → providers-lmstudio/routes → admin-worker-ops
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { withLocalProvider } = require('../../../admin-worker-ops') as typeof import('../../../admin-worker-ops');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { pinAndLoadModel, unpinAndUnloadModel } = require('../../../job-runner') as typeof import('../../../job-runner');

      const body = await readJsonBody(req, LocalRuntimeActionBodySchema);
      const action = body.action;
      await refreshActiveLocalProviderModels();
      const defaultModel = getDefaultModel();

      if (action === 'pin-load') {
        const alias = body.alias?.trim() || defaultModel.alias;
        await pinAndLoadModel(alias);
        await recordEventSafe({
          category: 'admin',
          action: 'lmstudio_model_pinned',
          summary: `LM Studio model pinned and loaded: ${alias}`,
          metadata: { alias },
        });
        return { status: 200, body: { ok: true } };
      }

      if (action === 'pin-unload') {
        await unpinAndUnloadModel();
        await recordEventSafe({
          category: 'admin',
          action: 'lmstudio_model_unpinned',
          summary: 'LM Studio pin cleared and all models unloaded.',
        });
        return { status: 200, body: { ok: true } };
      }

      await withLocalProvider(async (provider) => {
        if (action === 'start' && provider.startRuntime) {
          await provider.startRuntime();
        } else if (action === 'stop' && provider.stopRuntime) {
          await provider.stopRuntime();
        } else if (action === 'load-default' && provider.loadModel) {
          if (defaultModel.provider !== provider.providerId) {
            throw new BadRequestError(`Default model ${defaultModel.alias} is not served by the active local provider.`);
          }
          if (provider.startRuntime) await provider.startRuntime();
          await provider.loadModel(defaultModel.id);
        } else if (action === 'unload-default' && provider.unloadModel) {
          if (defaultModel.provider !== provider.providerId) {
            throw new BadRequestError(`Default model ${defaultModel.alias} is not served by the active local provider.`);
          }
          await provider.unloadModel(defaultModel.id);
        } else if (action === 'unload-all' && provider.unloadAllModels) {
          await provider.unloadAllModels();
        }
      });

      return { status: 200, body: { ok: true } };
    },
  },
  {
    method: 'GET',
    path: '/api/workers/lmstudio/memory-cleanup',
    workerIds: [WORKER_ID],
    async handle() {
      return { status: 200, body: await buildStatus() };
    },
  },
  {
    method: 'POST',
    path: '/api/workers/lmstudio/memory-cleanup/test',
    workerIds: [WORKER_ID],
    async handle() {
      const before = await buildStatus();
      const startedAt = Date.now();
      let ok = false;
      let errorMessage: string | null = null;
      try {
        await runMemoryCleanup();
        ok = true;
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err);
      }
      return {
        status: 200,
        body: {
          ok,
          durationMs: Date.now() - startedAt,
          errorMessage,
          status: before,
        },
      };
    },
  },
];
