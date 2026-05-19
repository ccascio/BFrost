import type { BackendWorkerModule } from '../../module';
import { openaiProviderWorker } from './manifest';
import { createOpenAIProviderAdapter } from './adapter';

export const openaiProviderModule: BackendWorkerModule = {
  manifest: openaiProviderWorker,
  providerAdapters: [
    {
      providerId: 'openai',
      create: createOpenAIProviderAdapter,
    },
  ],
};
