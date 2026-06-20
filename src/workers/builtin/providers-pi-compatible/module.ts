import type { BackendWorkerModule } from '../../module';
import { PI_COMPATIBLE_PROVIDERS } from './catalog';
import { createPiCompatibleProviderAdapter } from './adapter';
import { piCompatibleSettingsSnapshot } from './credentials';
import { piCompatibleProviderWorker } from './manifest';
import { piCompatibleProviderApiRoutes } from './routes';
import { anthropicSettingsSnapshot } from '../providers-anthropic/credentials';
import { openAISettingsSnapshot } from '../providers-openai/credentials';

export const piCompatibleProviderModule: BackendWorkerModule = {
  manifest: piCompatibleProviderWorker,
  async loadDashboardData() {
    return {
      ...piCompatibleSettingsSnapshot(),
      anthropic: anthropicSettingsSnapshot(),
      openai: openAISettingsSnapshot(),
    };
  },
  providerAdapters: PI_COMPATIBLE_PROVIDERS.map((provider) => ({
    providerId: provider.id,
    create: () => createPiCompatibleProviderAdapter(provider),
  })),
  apiRoutes: piCompatibleProviderApiRoutes,
};
