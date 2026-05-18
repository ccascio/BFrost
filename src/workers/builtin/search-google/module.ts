import type { BackendWorkerModule } from '../../module';
import { searchGoogleWorker } from './manifest';
import { googleSearchApiRoutes } from './routes';

export const searchGoogleModule: BackendWorkerModule = {
  manifest: searchGoogleWorker,
  apiRoutes: googleSearchApiRoutes,
};

export { searchGoogle, type SearchResult, type SearchOptions } from './client';
