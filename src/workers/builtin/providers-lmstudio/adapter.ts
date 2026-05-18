import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { config } from '../../../config';
import type { ProviderAdapter } from '../../module';
import {
  getServerStatus,
  listAvailableModels,
  listEmbeddingModels,
  listLoadedModels,
  loadModel,
  startServer,
  stopServer,
  unloadAllModels,
  unloadModel,
} from './runtime';

const PROVIDER_ID = 'lmstudio';

function createSdkClient() {
  return createOpenAICompatible({ name: PROVIDER_ID, baseURL: config.ollamaBaseUrl });
}

export function createLmStudioProviderAdapter(): ProviderAdapter {
  let client = createSdkClient();
  let lastBaseUrl = config.ollamaBaseUrl;

  function refreshClientIfBaseUrlChanged() {
    if (config.ollamaBaseUrl !== lastBaseUrl) {
      client = createSdkClient();
      lastBaseUrl = config.ollamaBaseUrl;
    }
  }

  return {
    providerId: PROVIDER_ID,
    isConfigured() {
      return Boolean(config.lmStudioBin && config.ollamaBaseUrl);
    },
    getChatModel(modelId: string) {
      refreshClientIfBaseUrlChanged();
      return client.chatModel(modelId);
    },
    listAvailableModels,
    listEmbeddingModels,
    startRuntime: startServer,
    stopRuntime: stopServer,
    getRuntimeStatus: getServerStatus,
    listLoadedModels,
    loadModel,
    unloadModel,
    unloadAllModels,
  };
}
