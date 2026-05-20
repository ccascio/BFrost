import {
  clearDiscoveredProviderModels,
  replaceDiscoveredProviderModels,
} from './config';
import {
  getActiveLocalProvider,
  getProviderAdapter,
  listRegisteredProviders,
} from './workers/registry';

export async function refreshActiveLocalProviderModels(): Promise<void> {
  const activeProvider = getActiveLocalProvider();
  const activeProviderId = activeProvider?.providerId ?? null;

  for (const registered of listRegisteredProviders()) {
    if (!registered.manifest.capabilities.localRuntime) continue;
    if (registered.manifest.id !== activeProviderId) {
      clearDiscoveredProviderModels(registered.manifest.id);
    }
  }

  if (!activeProvider?.listAvailableModels) {
    return;
  }

  try {
    const models = await activeProvider.listAvailableModels();
    replaceDiscoveredProviderModels(activeProvider.providerId, models);
  } catch (err) {
    console.warn(
      `[ModelDiscovery] Could not refresh ${activeProvider.providerId} models:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Refresh discovered models for every cloud (non-local-runtime) provider that has
 * credentials configured. Called at boot and after a cloud API key is saved so the
 * dashboard model picker reflects what the user can actually use.
 */
export async function refreshCloudProviderModels(): Promise<void> {
  for (const registered of listRegisteredProviders()) {
    if (registered.manifest.capabilities.localRuntime) continue;
    const providerId = registered.manifest.id;
    const adapter = getProviderAdapter(providerId);
    if (!adapter?.listAvailableModels) continue;
    if (!adapter.isConfigured()) {
      clearDiscoveredProviderModels(adapter.providerId);
      continue;
    }
    try {
      const models = await adapter.listAvailableModels();
      replaceDiscoveredProviderModels(adapter.providerId, models);
    } catch (err) {
      console.warn(
        `[ModelDiscovery] Could not refresh ${adapter.providerId} models:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

export async function refreshAllProviderModels(): Promise<void> {
  await Promise.all([refreshActiveLocalProviderModels(), refreshCloudProviderModels()]);
}
