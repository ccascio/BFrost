import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { config } from '../../../config';
import type { ProviderAdapter } from '../../module';
import { getLmStudioBin } from './settings';
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

function parseEmbeddingResponse(data: unknown): number[] {
  const value = data as {
    data?: Array<{ embedding?: unknown }>;
    embedding?: unknown;
    embeddings?: unknown[];
  };

  if (Array.isArray(value.data) && Array.isArray(value.data[0]?.embedding)) {
    return value.data[0].embedding.map(Number);
  }
  if (Array.isArray(value.embedding)) {
    return value.embedding.map(Number);
  }
  if (Array.isArray(value.embeddings) && Array.isArray(value.embeddings[0])) {
    return value.embeddings[0].map(Number);
  }
  throw new Error('Local embedding endpoint returned an unsupported response shape.');
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
      return Boolean(getLmStudioBin() && config.ollamaBaseUrl);
    },
    getChatModel(modelId: string) {
      refreshClientIfBaseUrlChanged();
      return client.chatModel(modelId);
    },
    listAvailableModels,
    listEmbeddingModels,
    async embedText(modelId: string, input: string) {
      const endpoint = `${config.ollamaBaseUrl.replace(/\/$/, '')}/embeddings`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelId, input }),
      });
      if (!response.ok) {
        const message = await response.text().catch(() => response.statusText);
        throw new Error(`Local embedding request failed (${response.status}): ${message || response.statusText}`);
      }
      return parseEmbeddingResponse(await response.json());
    },
    startRuntime: startServer,
    stopRuntime: stopServer,
    getRuntimeStatus: getServerStatus,
    listLoadedModels,
    loadModel,
    unloadModel,
    unloadAllModels,
  };
}
