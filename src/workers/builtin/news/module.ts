import { getSchedulerSnapshot } from '../../../scheduler';
import type { BackendWorkerModule } from '../../module';
import { newsWorker } from './manifest';
import { newsApiRoutes } from './routes';
import { listNewsRuns } from './runs';
import { loadSourceQualityRules } from './source-quality';

export interface NewsWorkerDashboardData {
  recentRuns: Awaited<ReturnType<typeof listNewsRuns>>;
  sourceRules: Awaited<ReturnType<typeof loadSourceQualityRules>>;
  digestParams: Record<string, unknown>;
}

export const newsModule: BackendWorkerModule<NewsWorkerDashboardData> = {
  manifest: newsWorker,
  apiRoutes: newsApiRoutes,
  async loadDashboardData() {
    const [recentRuns, sourceRules, scheduler] = await Promise.all([
      listNewsRuns(5),
      loadSourceQualityRules(),
      getSchedulerSnapshot(),
    ]);
    const newsJob = scheduler.jobs.find((job) => job.name === 'news-digest');
    return { recentRuns, sourceRules, digestParams: newsJob?.params ?? {} };
  },
};

