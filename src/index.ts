import { startScheduler, stopScheduler } from './scheduler';
import { startAdminServer, stopAdminServer } from './admin-server';
import { applyPendingRestoreIfAny, startAutoBackup, stopAutoBackup } from './app-backup';
import { assertStartupReadiness, getAppHealthSnapshot, logStartupHealthSummary } from './health';
import { hydrateConversations, flushConversations } from './conversation';
import {
  getActiveLocalProvider,
  listRegisteredChannels,
  listRegisteredProviders,
  getProviderAdapter,
  setHiddenBuiltInIds,
} from './workers/registry';
import { bootstrapLocalWorkers } from './workers/bootstrap';
import { loadWorkerState } from './workers/state';
import { builtInWorkers } from './workers/builtin';
import { applyPlatformSettingsToConfig, loadAdminSettings } from './admin-config';
import { releaseStaleQueueLockOnBoot } from './jobs/queue';
import { registerBfrostRuntimeModule } from './sdk-runtime';
import { ensureActionTable } from './actions';
import { refreshActiveLocalProviderModels, refreshCloudProviderModels } from './model-discovery';
import type { ChannelAdapter, ProviderAdapter } from './workers/module';
import { acquireRuntimeLock, releaseRuntimeLock } from './runtime-lock';
import { closeDb } from './sqlite';

async function main(): Promise<void> {
  // Apply any pending restore before the DB is opened for the first time.
  await applyPendingRestoreIfAny();

  const health = await getAppHealthSnapshot();
  assertStartupReadiness(health);
  logStartupHealthSummary(health);
  await hydrateConversations();
  await releaseStaleQueueLockOnBoot();
  await ensureActionTable();
  await acquireRuntimeLock();
  // Make `import { ... } from 'bfrost'` resolvable inside local worker bundles.
  // Must happen before bootstrapLocalWorkers so the first require() inside a worker
  // entrypoint sees the synthetic module.
  registerBfrostRuntimeModule();

  // Apply any persisted hidden-built-in flags before the registry is first used
  // by bootstrapLocalWorkers. This ensures soft-deleted plugin workers are excluded
  // from the scheduler and tool catalog from the very first request.
  const bootState = await loadWorkerState();
  const builtInIdSet = new Set(builtInWorkers.map((w) => w.id));
  const bootHiddenIds = new Set(
    Object.entries(bootState.workers)
      .filter(([id, s]) => s.hidden === true && builtInIdSet.has(id))
      .map(([id]) => id),
  );
  if (bootHiddenIds.size > 0) {
    setHiddenBuiltInIds(bootHiddenIds);
  }

  const localWorkers = await bootstrapLocalWorkers();
  await refreshActiveLocalProviderModels();
  // Best-effort: cloud providers self-skip when their key is missing, so it's safe to run
  // unconditionally. Network failures here just leave the discovered list empty.
  await refreshCloudProviderModels();

  // Apply persisted platform settings (active local provider, primary channel) so the
  // selection survives restarts. Done after bootstrapLocalWorkers so any worker the user
  // chose previously is already registered.
  const persistedAdminSettings = await loadAdminSettings();
  applyPlatformSettingsToConfig(persistedAdminSettings.platform);
  if (localWorkers.loaded.length) {
    console.log(`[BFrost] Loaded ${localWorkers.loaded.length} local worker(s): ${localWorkers.loaded.join(', ')}`);
  }
  for (const issue of localWorkers.issues) {
    console.warn(`[BFrost] Local worker issue (${issue.sourcePath}): ${issue.message}`);
  }

  // Boot any local-runtime providers (e.g. LM Studio) so chat models are reachable.
  const startedRuntimes: ProviderAdapter[] = [];
  for (const registered of listRegisteredProviders()) {
    if (!registered.manifest.capabilities.localRuntime) continue;
    const adapter = getProviderAdapter(registered.manifest.id);
    if (!adapter || !adapter.isConfigured() || !adapter.startRuntime) {
      console.log(`[BFrost] Provider ${registered.manifest.id} not configured for runtime start, skipping.`);
      continue;
    }
    const weStarted = await adapter.startRuntime();
    if (weStarted) {
      startedRuntimes.push(adapter);
    }
    console.log(`[BFrost] Provider ${registered.manifest.id} ready.`);
  }
  void getActiveLocalProvider();
  await refreshActiveLocalProviderModels();

  await startAdminServer();
  await startScheduler();
  await startAutoBackup();

  const channels: ChannelAdapter[] = [];
  for (const registered of listRegisteredChannels()) {
    const adapter = registered.factory.create();
    if (!(await adapter.isConfigured())) {
      console.log(`[BFrost] Channel ${registered.manifest.id} not configured, skipping.`);
      continue;
    }
    await adapter.start();
    channels.push(adapter);
    console.log(`[BFrost] Channel ${registered.manifest.id} started.`);
  }

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    let exitCode = 0;

    await stopScheduler().catch((err) => {
      exitCode = 1;
      console.warn('[BFrost] Scheduler stop failed:', err);
    });
    await stopAutoBackup().catch((err) => {
      exitCode = 1;
      console.warn('[BFrost] Auto-backup stop failed:', err);
    });
    for (const adapter of channels) {
      await adapter.stop(signal).catch((err) => {
        exitCode = 1;
        console.warn(`[BFrost] Channel ${adapter.channelId} stop failed:`, err);
      });
    }
    await flushConversations().catch((err) => {
      exitCode = 1;
      console.warn('[BFrost] Conversation flush failed:', err);
    });
    await stopAdminServer().catch((err) => {
      exitCode = 1;
      console.warn('[BFrost] Admin server stop failed:', err);
    });
    for (const adapter of startedRuntimes) {
      if (!adapter.stopRuntime) continue;
      await adapter.stopRuntime().catch((err) => {
        exitCode = 1;
        console.warn(`[BFrost] Provider ${adapter.providerId} runtime stop failed:`, err);
      });
    }
    await releaseRuntimeLock().catch((err) => {
      exitCode = 1;
      console.warn('[BFrost] Runtime lock release failed:', err);
    });
    closeDb();
    process.exit(exitCode);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch(async (err) => {
  console.error('[BFrost] Fatal error:', err);
  await stopScheduler().catch(() => undefined);
  await stopAutoBackup().catch(() => undefined);
  await releaseRuntimeLock().catch(() => undefined);
  closeDb();
  process.exit(1);
});
