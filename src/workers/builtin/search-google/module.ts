import type { BackendWorkerModule } from '../../module';
import { searchGoogleWorker } from './manifest';
import { googleSearchApiRoutes } from './routes';
import { resolveGoogleCredentials } from './client';

export const searchGoogleModule: BackendWorkerModule = {
  manifest: searchGoogleWorker,
  apiRoutes: googleSearchApiRoutes,
  healthChecks: [
    {
      key: 'googleSearchConfigured',
      category: 'integrations',
      async check() {
        const credentials = await resolveGoogleCredentials();
        const ok = Boolean(credentials.apiKey && credentials.engineId);
        return {
          ok,
          detail: ok
            ? 'Google Custom Search credentials present.'
            : 'Configure Google Custom Search credentials in the worker settings.',
        };
      },
    },
  ],
};

export { searchGoogle, type SearchResult, type SearchOptions } from './client';
