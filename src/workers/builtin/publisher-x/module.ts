import type { BackendWorkerModule } from '../../module';
import { xPublisherWorker } from './manifest';
import { xPublisherApiRoutes } from './routes';

export const xPublisherModule: BackendWorkerModule = {
  manifest: xPublisherWorker,
  apiRoutes: xPublisherApiRoutes,
};

