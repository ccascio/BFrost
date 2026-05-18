import type { BackendWorkerModule } from '../../module';
import { newsWorker } from './manifest';
import { newsApiRoutes } from './routes';
import { listNewsRuns } from './runs';
import { loadSourceQualityRules } from './source-quality';

export interface NewsWorkerDashboardData {
  recentRuns: Awaited<ReturnType<typeof listNewsRuns>>;
  sourceRules: Awaited<ReturnType<typeof loadSourceQualityRules>>;
}

export const newsModule: BackendWorkerModule<NewsWorkerDashboardData> = {
  manifest: newsWorker,
  apiRoutes: newsApiRoutes,
  async loadDashboardData() {
    const [recentRuns, sourceRules] = await Promise.all([
      listNewsRuns(5),
      loadSourceQualityRules(),
    ]);
    return { recentRuns, sourceRules };
  },
};

