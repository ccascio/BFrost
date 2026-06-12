import { loadAdminSettings } from '../../../admin-config';
import type { BackendWorkerModule } from '../../module';
import { xPublisherWorker } from './manifest';
import { xPublisherApiRoutes } from './routes';

export const xPublisherModule: BackendWorkerModule = {
  manifest: xPublisherWorker,
  apiRoutes: xPublisherApiRoutes,
  async loadDashboardData() {
    const settings = await loadAdminSettings();
    const job = settings.jobs['tweet-post'];
    return { ...(job?.params ?? {}), prompt: job?.prompt ?? '' };
  },
};

