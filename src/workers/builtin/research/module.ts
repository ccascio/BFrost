import type { BackendWorkerModule } from '../../module';
import { listRecentEventsSafe } from '../../../event-log';
import { researchWorker } from './manifest';
import { researchApiRoutes } from './routes';
import { listResearchNotes, loadResearchSettings } from './job';

export interface ResearchWorkerDashboardData {
  settings: Awaited<ReturnType<typeof loadResearchSettings>>;
  notes: Awaited<ReturnType<typeof listResearchNotes>>;
  events: Awaited<ReturnType<typeof listRecentEventsSafe>>;
}

export const researchModule: BackendWorkerModule<ResearchWorkerDashboardData> = {
  manifest: researchWorker,
  apiRoutes: researchApiRoutes,
  async loadDashboardData() {
    const [settings, notes, recentEvents] = await Promise.all([
      loadResearchSettings(),
      listResearchNotes(20),
      listRecentEventsSafe(50),
    ]);
    const events = recentEvents
      .filter((event) => event.metadata?.workerId === 'core.research')
      .slice(0, 20);
    return { settings, notes, events };
  },
};

