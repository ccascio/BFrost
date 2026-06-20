import type { BackendWorkerModule } from '../../module';
import { anthropicProviderWorker } from './manifest';
import { createAnthropicProviderAdapter } from './adapter';
import { anthropicProviderApiRoutes } from './routes';
import { anthropicSettingsSnapshot } from './credentials';

export const anthropicProviderModule: BackendWorkerModule = {
  manifest: anthropicProviderWorker,
  async loadDashboardData() {
    return anthropicSettingsSnapshot();
  },
  providerAdapters: [
    {
      providerId: 'anthropic',
      create: createAnthropicProviderAdapter,
    },
  ],
  apiRoutes: anthropicProviderApiRoutes,
};
