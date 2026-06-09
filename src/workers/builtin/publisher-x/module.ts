import { loadAdminSettings } from '../../../admin-config';
import type { BackendWorkerModule } from '../../module';
import { xPublisherWorker } from './manifest';
import { xPublisherApiRoutes } from './routes';

export const xPublisherModule: BackendWorkerModule = {
  manifest: xPublisherWorker,
  apiRoutes: xPublisherApiRoutes,
  async loadDashboardData() {
    const settings = await loadAdminSettings();
    return settings.jobs['tweet-post']?.params ?? {};
  },
};

