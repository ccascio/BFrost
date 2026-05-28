import type { BackendWorkerModule } from '../../module';
import { anthropicProviderWorker } from './manifest';
import { createAnthropicProviderAdapter } from './adapter';
import { anthropicProviderApiRoutes } from './routes';

export const anthropicProviderModule: BackendWorkerModule = {
  manifest: anthropicProviderWorker,
  providerAdapters: [
    {
      providerId: 'anthropic',
      create: createAnthropicProviderAdapter,
    },
  ],
  apiRoutes: anthropicProviderApiRoutes,
};
