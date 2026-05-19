import type { AdminApiRoute } from '../../../admin-route';
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
