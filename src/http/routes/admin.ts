import path from 'path';
import { promises as fs } from 'fs';
import { HttpRouter } from '../router';
import { readJsonBody, sendJson } from '../responses';
import { config } from '../../config';
import { recordEventSafe } from '../../event-log';
import { BadRequestError } from '../../admin-route';
import { listWorkers } from '../../workers/registry';
import { isWorkerEnabled, loadWorkerState, setWorkerEnabled } from '../../workers/state';
import { deactivateLocalWorker } from '../../workers/bootstrap';
import { publishItem } from '../../jobs/item-bus';
import { FactoryResetBodySchema } from '../../admin-api';
import { detach, logCleanupFailure } from '../../process-lifecycle';

export function registerAdminRoutes(router: HttpRouter): void {
  // Factory reset — wipes selected categories of state, then exits for restart
  router.add('POST', '/api/admin/factory-reset', async (req, res) => {
    const body = await readJsonBody(req, FactoryResetBodySchema);
    if (!body.wipeWorkerState && !body.wipeCredentials && !body.wipeBackups) {
      throw new BadRequestError('Select at least one category to reset.');
    }
    await recordEventSafe({
      category: 'admin',
      action: 'factory_reset',
      summary: `Factory reset initiated (workerState=${body.wipeWorkerState}, credentials=${body.wipeCredentials}, backups=${body.wipeBackups}).`,
      metadata: body as unknown as Record<string, unknown>,
    });
    // Send the response before performing destructive operations so the client gets it.
    sendJson(res, 200, { ok: true, message: 'Reset in progress. BFrost will exit and must be restarted.' });
    // Perform reset asynchronously after a brief delay so the HTTP response flushes.
    setTimeout(() => {
      detach((async () => {
        if (body.wipeBackups) {
          const backupDir = path.join(config.adminStoreDir, 'backups');
          await fs.rm(backupDir, { recursive: true, force: true }).catch((err) => {
            logCleanupFailure('factory-reset:backups', err);
          });
        }
        if (body.wipeCredentials) {
          const envPath = path.join(process.cwd(), '.env');
          // Strip likely credential keys while keeping structural lines (comments, blank lines).
          // Worker-owned credential names should not be enumerated in core.
          const isCredentialKey = (key: string): boolean =>
            /(?:^|_)(?:API_)?KEY$/.test(key) ||
            /(?:^|_)(?:TOKEN|SECRET|PASSWORD)$/.test(key) ||
            /(?:^|_)(?:ACCESS|REFRESH)_TOKEN$/.test(key) ||
            /(?:^|_)CLIENT_SECRET$/.test(key);
          try {
            const content = await fs.readFile(envPath, 'utf8');
            const filtered = content.split('\n').filter((line) => {
              const key = line.split('=')[0]?.trim();
              return !key || !isCredentialKey(key);
            }).join('\n');
            await fs.writeFile(envPath, filtered, 'utf8');
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
              logCleanupFailure('factory-reset:credentials', err);
            }
          }
        }
        if (body.wipeWorkerState) {
          // Close the DB and delete the SQLite file. A fresh DB is created on next boot.
          const { closeDb } = await import('../../sqlite');
          closeDb();
          await fs.rm(config.appDbPath, { force: true }).catch((err) => {
            logCleanupFailure('factory-reset:worker-state', err);
          });
        }
        process.exit(0);
      })(), 'admin:factory-reset');
    }, 200);
    return; // response already sent above
  });

  // Disable all workers (safe-mode boot helper)
  router.add('POST', '/api/admin/disable-all-workers', async (_req, res) => {
    const allWorkers = listWorkers();
    const workerState = await loadWorkerState();
    const disabledIds: string[] = [];
    for (const worker of allWorkers) {
      if (isWorkerEnabled(worker.id, workerState)) {
        await setWorkerEnabled(worker.id, false, { builtIn: worker.builtIn });
        await deactivateLocalWorker(worker.id);
        disabledIds.push(worker.id);
      }
    }
    await recordEventSafe({ category: 'admin', action: 'safe_mode_activated', summary: `Safe mode: ${disabledIds.length} worker(s) disabled.`, metadata: { disabledIds } });
    return sendJson(res, 200, { ok: true, disabledCount: disabledIds.length });
  });

  // Seed the dashboard with sample data for first-time users.
  // Each worker declares its own sample items via manifest.sampleItems — no worker ids appear here.
  router.add('POST', '/api/admin/seed-sample-data', async (_req, res) => {
    const workers = listWorkers();
    let seeded = 0;
    for (const worker of workers) {
      for (const item of worker.sampleItems ?? []) {
        await publishItem({
          producerWorkerId: worker.id,
          itemType: item.itemType,
          title: item.title,
          shortDesc: item.shortDesc,
          url: item.url,
          tags: [...(item.tags ?? []), 'sample'],
          state: (item.state ?? 'queued') as 'queued',
        });
        seeded++;
      }
    }
    await recordEventSafe({ category: 'admin', action: 'sample_data_seeded', summary: 'Sample data seeded for demo purposes.', metadata: { seeded } });
    return sendJson(res, 200, { ok: true, seeded });
  });
}
