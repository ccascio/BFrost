import {
  clearDiscoveredProviderModels,
  replaceDiscoveredProviderModels,
} from './config';
import {
  getActiveLocalProvider,
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
