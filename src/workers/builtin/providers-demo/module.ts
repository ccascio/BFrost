import type { BackendWorkerModule } from '../../module';
import { createDemoProviderAdapter } from './adapter';
import { demoProviderWorker } from './manifest';

export const demoProviderModule: BackendWorkerModule = {
  manifest: demoProviderWorker,
  providerAdapters: [{ providerId: 'demo', create: createDemoProviderAdapter }],
};
