import { catchUpMissedRunsOnStartup, startScheduler, stopScheduler } from './scheduler';
import { startAdminServer, stopAdminServer } from './admin-server';
import { applyPendingRestoreIfAny, startAutoBackup, stopAutoBackup } from './app-backup';
import { getAppHealthSnapshot, logStartupHealthSummary } from './health';
import { hydrateConversations, flushConversations } from './conversation';
import { hydrateThreads, flushThreads } from './chat-threads';
import { hydrateProjects, flushProjects } from './projects';
import {
  getActiveLocalProvider,
  listRegisteredChannels,
  setHiddenBuiltInIds,
} from './workers/registry';
import { bootstrapLocalWorkers } from './workers/bootstrap';
import { startLocalWorkerWatcher, type LocalWorkerWatcher } from './workers/watch';
import { loadWorkerState } from './workers/state';
import { builtInWorkers } from './workers/builtin';
import { applyPlatformSettingsToConfig, loadAdminSettings } from './admin-config';
import { releaseStaleQueueLockOnBoot } from './jobs/queue';
import { registerBfrostRuntimeModule } from './sdk-runtime';
import { ensureActionTable } from './actions';
import { refreshActiveLocalProviderModels, refreshCloudProviderModels } from './model-discovery';
import { config, findModel } from './config';
import type { ChannelAdapter, ProviderAdapter } from './workers/module';
import { acquireRuntimeLock, releaseRuntimeLock } from './runtime-lock';
import { closeDb } from './sqlite';

async function main(): Promise<void> {
  // Apply any pending restore before the DB is opened for the first time.
  await applyPendingRestoreIfAny();

  const health = await getAppHealthSnapshot();
  // No local-runtime dependency is a hard requirement: LM Studio is optional
  // (Ollama or a cloud provider can serve models instead). Missing dependencies
  // are surfaced as warnings rather than blocking startup.
  logStartupHealthSummary(health);
  await hydrateConversations();
  await hydrateThreads();
  await hydrateProjects();
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

  // Boot only the active local-runtime provider, and only when the user's default
  // model actually needs it. Skipped when the default model resolves to a cloud
  // provider (openai, anthropic, …) so LM Studio (or any local runtime) is not
  // loaded into memory unnecessarily.
  //
  // Decision table for config.ollamaModel:
  //   resolves to cloud model  → skip (user switched to cloud)
  //   resolves to local model  → start (user explicitly chose local)
  //   does not resolve at all  → start (model is likely local, server just isn't up yet)
  const startedRuntimes: ProviderAdapter[] = [];
  const activeLocalAdapter = getActiveLocalProvider();
  if (!activeLocalAdapter) {
    console.log('[BFrost] No active local-runtime provider configured, skipping runtime start.');
  } else if (!activeLocalAdapter.startRuntime) {
    console.log(`[BFrost] Provider ${activeLocalAdapter.providerId} selected but has no runtime to start.`);
  } else {
    const resolvedDefault = findModel(config.ollamaModel);
    const defaultUsesLocalRuntime =
      !resolvedDefault || resolvedDefault.provider === activeLocalAdapter.providerId;
    if (!defaultUsesLocalRuntime) {
      console.log(
        `[BFrost] Provider ${activeLocalAdapter.providerId} configured but default model` +
        ` uses '${resolvedDefault!.provider}' — skipping runtime start.`,
      );
    } else {
      // Best-effort: a local runtime that fails to start (e.g. its CLI/binary
      // isn't installed) must not crash startup. Degrade to a warning and let
      // the rest of the platform — cloud providers, channels, scheduler — boot.
      try {
        const weStarted = await activeLocalAdapter.startRuntime();
        if (weStarted) {
          startedRuntimes.push(activeLocalAdapter);
        }
        console.log(`[BFrost] Provider ${activeLocalAdapter.providerId} ready.`);
      } catch (err) {
        console.warn(
          `[BFrost] Provider ${activeLocalAdapter.providerId} could not start its local runtime; ` +
          `continuing without it. ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }
  await refreshActiveLocalProviderModels();

  await startAdminServer();
  await startScheduler();
  await startAutoBackup();
  const workerWatcher: LocalWorkerWatcher = startLocalWorkerWatcher();

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

  // Recover the most recent scheduled run that elapsed while BFrost was not running
  // (powered-off / rebooted machine). Runs after channels start so a recovered digest
  // can actually be delivered to the operator.
  await catchUpMissedRunsOnStartup().catch((err) => {
    console.warn('[BFrost] Startup catch-up failed:', err);
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    let exitCode = 0;

    workerWatcher.stop();
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
    await flushThreads().catch((err) => {
      exitCode = 1;
      console.warn('[BFrost] Thread registry flush failed:', err);
    });
    await flushProjects().catch((err) => {
      exitCode = 1;
      console.warn('[BFrost] Project registry flush failed:', err);
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
