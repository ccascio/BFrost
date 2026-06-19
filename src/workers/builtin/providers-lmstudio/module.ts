import type { BackendWorkerModule } from '../../module';
import { lmStudioProviderWorker } from './manifest';
import { createLmStudioProviderAdapter } from './adapter';
import { lmStudioProviderApiRoutes } from './routes';
import { constants } from 'fs';
import { access } from 'fs/promises';
import { getLmStudioBin } from './settings';

async function fileExecutable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK | constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export const lmStudioProviderModule: BackendWorkerModule = {
  manifest: lmStudioProviderWorker,
  apiRoutes: lmStudioProviderApiRoutes,
  healthChecks: [
    {
      key: 'lmStudioCli',
      category: 'dependencies',
      async check() {
        const bin = getLmStudioBin();
        const ok = await fileExecutable(bin);
        return {
          ok,
          detail: ok
            ? `LM Studio CLI found at ${bin}.`
            : `LM Studio CLI missing or not executable at ${bin}.`,
        };
      },
    },
  ],
  providerAdapters: [
    {
      providerId: 'lmstudio',
      create: createLmStudioProviderAdapter,
    },
  ],
};
