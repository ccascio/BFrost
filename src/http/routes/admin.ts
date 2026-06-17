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
    setTimeout(async () => {
      if (body.wipeBackups) {
        const backupDir = path.join(config.adminStoreDir, 'backups');
        await fs.rm(backupDir, { recursive: true, force: true }).catch(() => undefined);
      }
      if (body.wipeCredentials) {
        const envPath = path.join(process.cwd(), '.env');
        // Strip known credential keys but keep structural lines (comments, blank lines)
        const CREDENTIAL_KEYS = [
          'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'TELEGRAM_BOT_TOKEN', 'DISCORD_BOT_TOKEN',
          'X_CONSUMER_KEY', 'X_CONSUMER_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_TOKEN_SECRET',
          'GOOGLE_API_KEY', 'GOOGLE_SEARCH_ENGINE_ID',
        ];
        try {
          const content = await fs.readFile(envPath, 'utf8');
          const filtered = content.split('\n').filter((line) => {
            const key = line.split('=')[0]?.trim();
            return !key || !CREDENTIAL_KEYS.includes(key);
          }).join('\n');
          await fs.writeFile(envPath, filtered, 'utf8');
        } catch { /* no .env — nothing to clear */ }
      }
      if (body.wipeWorkerState) {
        // Close the DB and delete the SQLite file. A fresh DB is created on next boot.
        const { closeDb } = await import('../../sqlite');
        closeDb();
        await fs.rm(config.appDbPath, { force: true }).catch(() => undefined);
      }
      process.exit(0);
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

  // Seed the dashboard with sample data for first-time users
  router.add('POST', '/api/admin/seed-sample-data', async (_req, res) => {
    const SAMPLE_NEWS = [
      { title: 'AI researchers unveil new language model benchmark', url: 'https://example.com/ai-benchmark', shortDesc: 'A new benchmark suite tests reasoning, code, and multi-step planning across 20 open-source models.' },
      { title: 'Open-source robotics platform gains momentum', url: 'https://example.com/robotics', shortDesc: 'Community contributions double in six months as developers build affordable home automation robots.' },
      { title: 'Privacy-first browser extension hits 1M installs', url: 'https://example.com/privacy-ext', shortDesc: 'The extension blocks 99% of trackers with no configuration needed and is fully open-source.' },
      { title: 'Local AI inference now possible on mid-range laptops', url: 'https://example.com/local-ai', shortDesc: 'Optimised runtimes let 7B-parameter models run at usable speeds on hardware costing under $800.' },
      { title: 'Decentralised social network reaches 10 million users', url: 'https://example.com/decentralised', shortDesc: 'Federated protocol lets users own their data while still connecting across platforms.' },
    ];
    const SAMPLE_RESEARCH = [
      { title: 'Research Note: Local AI Trends 2026', url: 'https://example.com/research/local-ai', shortDesc: 'An analysis of on-device model inference improvements over the past 12 months.' },
      { title: 'Research Note: Privacy-preserving Architectures', url: 'https://example.com/research/privacy', shortDesc: 'Survey of approaches that minimise data leaving the device without sacrificing capability.' },
    ];
    for (const item of SAMPLE_NEWS) {
      await publishItem({ producerWorkerId: 'core.news', itemType: 'news.article', title: item.title, shortDesc: item.shortDesc, url: item.url, tags: ['sample'], state: 'queued' });
    }
    for (const item of SAMPLE_RESEARCH) {
      await publishItem({ producerWorkerId: 'core.research', itemType: 'research.note', title: item.title, shortDesc: item.shortDesc, url: item.url, tags: ['sample'], state: 'queued' });
    }
    await recordEventSafe({ category: 'admin', action: 'sample_data_seeded', summary: 'Sample data seeded for demo purposes.', metadata: { newsCount: SAMPLE_NEWS.length, researchCount: SAMPLE_RESEARCH.length } });
    return sendJson(res, 200, { ok: true, seeded: SAMPLE_NEWS.length + SAMPLE_RESEARCH.length });
  });
}
