import type { BackendWorkerModule } from '../../module';
import { anthropicProviderWorker } from './manifest';
import { createAnthropicProviderAdapter } from './adapter';

export const anthropicProviderModule: BackendWorkerModule = {
  manifest: anthropicProviderWorker,
  providerAdapters: [
    {
      providerId: 'anthropic',
      create: createAnthropicProviderAdapter,
    },
  ],
};
