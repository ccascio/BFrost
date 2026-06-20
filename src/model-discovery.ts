import {
  clearDiscoveredProviderModels,
  replaceDiscoveredProviderModels,
} from './config';
import {
  getActiveLocalProvider,
  getProviderAdapter,
  listRegisteredProviders,
} from './workers/registry';

export function seedDeclaredProviderModels(): void {
  for (const registered of listRegisteredProviders()) {
    replaceDiscoveredProviderModels(registered.manifest.id, registered.manifest.defaultModels ?? []);
  }
}

export async function refreshActiveLocalProviderModels(): Promise<void> {
  const activeProvider = getActiveLocalProvider();
  const activeProviderId = activeProvider?.providerId ?? null;

  for (const registered of listRegisteredProviders()) {
    if (!registered.manifest.capabilities.localRuntime) continue;
    if (registered.manifest.id !== activeProviderId) {
      clearDiscoveredProviderModels(registered.manifest.id);
    }
  }

  if (!activeProvider) {
    return;
  }

  const registered = listRegisteredProviders().find((entry) => entry.manifest.id === activeProvider.providerId);
  if (!activeProvider.listAvailableModels) {
    replaceDiscoveredProviderModels(activeProvider.providerId, registered?.manifest.defaultModels ?? []);
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
    if (!adapter) {
      clearDiscoveredProviderModels(providerId);
      continue;
    }
    if (!adapter.isConfigured()) {
      clearDiscoveredProviderModels(adapter.providerId);
      continue;
    }
    try {
      const models = adapter.listAvailableModels
        ? await adapter.listAvailableModels()
        : registered.manifest.defaultModels ?? [];
      replaceDiscoveredProviderModels(adapter.providerId, models);
    } catch (err) {
      const fallbackModels = registered.manifest.defaultModels ?? [];
      if (fallbackModels.length > 0) {
        replaceDiscoveredProviderModels(adapter.providerId, fallbackModels);
      }
      console.warn(
        `[ModelDiscovery] Could not refresh ${adapter.providerId} models:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

export async function refreshAllProviderModels(): Promise<void> {
  await refreshActiveLocalProviderModels();
  await refreshCloudProviderModels();
}
