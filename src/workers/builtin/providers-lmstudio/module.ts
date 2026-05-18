import type { BackendWorkerModule } from '../../module';
import { lmStudioProviderWorker } from './manifest';
import { createLmStudioProviderAdapter } from './adapter';

export const lmStudioProviderModule: BackendWorkerModule = {
  manifest: lmStudioProviderWorker,
  providerAdapters: [
    {
      providerId: 'lmstudio',
      create: createLmStudioProviderAdapter,
    },
  ],
};
