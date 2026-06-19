import { loadAdminSettings } from '../../../admin-config';
import type { BackendWorkerModule } from '../../module';
import { xPublisherWorker } from './manifest';
import { xPublisherApiRoutes } from './routes';
import { resolveXCredentials } from './x-client';

export const xPublisherModule: BackendWorkerModule = {
  manifest: xPublisherWorker,
  apiRoutes: xPublisherApiRoutes,
  healthChecks: [
    {
      key: 'xConfigured',
      category: 'integrations',
      async check() {
        const credentials = await resolveXCredentials();
        const ok = Boolean(
          credentials.consumerKey &&
            credentials.consumerSecret &&
            credentials.accessToken &&
            credentials.accessTokenSecret,
        );
        return {
          ok,
          detail: ok
            ? 'X posting credentials present.'
            : 'Configure X posting credentials in the worker settings.',
        };
      },
    },
  ],
  async loadDashboardData() {
    const settings = await loadAdminSettings();
    const job = settings.jobs['tweet-post'];
    return { ...(job?.params ?? {}), prompt: job?.prompt ?? '' };
  },
};
