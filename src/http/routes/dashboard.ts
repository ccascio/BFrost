import type { ServerResponse } from 'http';
import { HttpRouter } from '../router';
import { sendJson } from '../responses';
import {
  buildDashboardState,
  buildQueueSection,
  buildCronRunsSection,
  buildEventsSection,
  buildBackupsSection,
  buildWorkerDataSection,
  buildLocalRuntimeModelsSection,
  buildLocalEmbeddingModelsSection,
  buildJobMetricsSection,
} from '../../admin-dashboard-state';
import { subscribeToEventLog, type EventLogRecord } from '../../event-log';

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
  router.add('GET', '/api/dashboard/local-runtime-models', async (_req, res) => {
    return sendJson(res, 200, await buildLocalRuntimeModelsSection());
  });
  router.add('GET', '/api/dashboard/local-embedding-models', async (_req, res) => {
    return sendJson(res, 200, await buildLocalEmbeddingModelsSection());
  });
  router.add('GET', '/api/dashboard/job-metrics', async (_req, res) => {
    return sendJson(res, 200, await buildJobMetricsSection());
  });
  router.add('GET', '/api/events/stream', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    writeSseEvent(res, 'ready', { connectedAt: new Date().toISOString() });

    const unsubscribe = subscribeToEventLog((event) => {
      writeSseEvent(res, 'event-log', event, event.id);
    });
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) {
        res.write(': heartbeat\n\n');
      }
    }, 15000);

    const close = () => {
      clearInterval(heartbeat);
      unsubscribe();
    };
    req.on('close', close);
    res.on('close', close);
  });
}

function writeSseEvent(
  res: ServerResponse,
  eventName: string,
  payload: EventLogRecord | Record<string, unknown>,
  id?: string,
): void {
  if (res.writableEnded) return;
  if (id) res.write(`id: ${sanitizeSseLine(id)}\n`);
  res.write(`event: ${sanitizeSseLine(eventName)}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function sanitizeSseLine(value: string): string {
  return value.replace(/[\r\n]/g, '');
}
