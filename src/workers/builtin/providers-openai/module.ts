import type { BackendWorkerModule } from '../../module';
import { openaiProviderWorker } from './manifest';
import { createOpenAIProviderAdapter } from './adapter';
import { openaiProviderApiRoutes } from './routes';
import { openAISettingsSnapshot } from './credentials';

export const openaiProviderModule: BackendWorkerModule = {
  manifest: openaiProviderWorker,
  async loadDashboardData() {
    return openAISettingsSnapshot();
  },
  providerAdapters: [
    {
      providerId: 'openai',
      create: createOpenAIProviderAdapter,
    },
  ],
  apiRoutes: openaiProviderApiRoutes,
};
