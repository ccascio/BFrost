import { startScheduler } from './scheduler';
import { startAdminServer, stopAdminServer } from './admin-server';
import { applyPendingRestoreIfAny, startAutoBackup } from './app-backup';
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

async function main(): Promise<void> {
  // Apply any pending restore before the DB is opened for the first time.
  await applyPendingRestoreIfAny();

  const health = await getAppHealthSnapshot();
  assertStartupReadiness(health);
  logStartupHealthSummary(health);
  await hydrateConversations();
  await releaseStaleQueueLockOnBoot();
  await ensureActionTable();
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

  await startScheduler();
  await startAdminServer();
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

  const shutdown = async (signal: string) => {
    for (const adapter of channels) {
      await adapter.stop(signal).catch((err) => {
        console.warn(`[BFrost] Channel ${adapter.channelId} stop failed:`, err);
      });
    }
    await flushConversations();
    await stopAdminServer();
    for (const adapter of startedRuntimes) {
      if (!adapter.stopRuntime) continue;
      await adapter.stopRuntime().catch((err) => {
        console.warn(`[BFrost] Provider ${adapter.providerId} runtime stop failed:`, err);
      });
    }
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[BFrost] Fatal error:', err);
  process.exit(1);
});
