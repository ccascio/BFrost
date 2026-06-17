import { HttpRouter } from '../router';
import { sendJson } from '../responses';
import {
  buildDashboardState,
  buildQueueSection,
  buildCronRunsSection,
  buildEventsSection,
  buildBackupsSection,
  buildWorkerDataSection,
  buildLocalEmbeddingModelsSection,
  buildJobMetricsSection,
} from '../../admin-dashboard-state';

export function registerDashboardRoutes(router: HttpRouter): void {
  router.add('GET', '/api/dashboard', async (_req, res) => {
    return sendJson(res, 200, await buildDashboardState());
  });
  router.add('GET', '/api/dashboard/queue', async (_req, res) => {
    return sendJson(res, 200, await buildQueueSection());
  });
  router.add('GET', '/api/dashboard/cron-runs', async (_req, res) => {
    return sendJson(res, 200, await buildCronRunsSection());
  });
  router.add('GET', '/api/dashboard/events', async (_req, res) => {
    return sendJson(res, 200, await buildEventsSection());
  });
  router.add('GET', '/api/dashboard/backups', async (_req, res) => {
    return sendJson(res, 200, await buildBackupsSection());
  });
  router.add('GET', '/api/dashboard/worker-data', async (_req, res) => {
    return sendJson(res, 200, await buildWorkerDataSection());
  });
  router.add('GET', '/api/dashboard/local-embedding-models', async (_req, res) => {
    return sendJson(res, 200, await buildLocalEmbeddingModelsSection());
  });
  router.add('GET', '/api/dashboard/job-metrics', async (_req, res) => {
    return sendJson(res, 200, await buildJobMetricsSection());
  });
}
