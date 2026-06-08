import type { BackendWorkerModule } from '../../module';
import type { AdminApiRoute } from '../../../admin-route';
import { demoWorker } from './manifest';
import { runDemo, loadDemoSnapshot, type DemoRunSnapshot } from './job';

export interface DemoWorkerDashboardData {
  lastRun: DemoRunSnapshot | null;
}

// The onboarding CTA hits this route directly rather than the job runner, so the demo runs
// with zero providers configured — it publishes canned items to the bus and returns a summary.
const demoApiRoutes: AdminApiRoute[] = [
  {
    method: 'POST',
    path: '/api/workers/demo/run',
    workerIds: ['core.demo'],
    async handle() {
      const result = await runDemo();
      return { status: 200, body: result };
    },
  },
];

export const demoModule: BackendWorkerModule<DemoWorkerDashboardData> = {
  manifest: demoWorker,
  apiRoutes: demoApiRoutes,
  async loadDashboardData() {
    return { lastRun: await loadDemoSnapshot() };
  },
};
