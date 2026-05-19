import type { BackendWorkerModule } from '../../module';
import { lmStudioProviderWorker } from './manifest';
import { createLmStudioProviderAdapter } from './adapter';
import { lmStudioProviderApiRoutes } from './routes';

export const lmStudioProviderModule: BackendWorkerModule = {
  manifest: lmStudioProviderWorker,
  apiRoutes: lmStudioProviderApiRoutes,
  providerAdapters: [
    {
      providerId: 'lmstudio',
      create: createLmStudioProviderAdapter,
    },
  ],
};
