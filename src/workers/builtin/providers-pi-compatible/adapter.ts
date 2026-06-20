import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { ProviderAdapter } from '../../module';
import type { PiCompatibleProviderDefinition } from './catalog';
import {
  isPiProviderConfigured,
  resolvePiProviderApiKey,
  resolvePiProviderBaseURL,
} from './credentials';

type PiCompatibleSdkClient = {
  getChatModel(modelId: string): unknown;
};

function createSdkClient(provider: PiCompatibleProviderDefinition): PiCompatibleSdkClient {
  const apiKey = resolvePiProviderApiKey(provider);
  const baseURL = resolvePiProviderBaseURL(provider);
  if (provider.transport === 'anthropic-compatible') {
    const client = createAnthropic({
      name: provider.id,
      baseURL,
      authToken: apiKey,
      headers: provider.headers,
    });
    return {
      getChatModel(modelId: string) {
        return client(modelId);
      },
    };
  }
  const client = createOpenAICompatible({
    name: provider.id,
    baseURL,
    apiKey,
    headers: provider.headers,
  });
  return {
    getChatModel(modelId: string) {
      return client.chatModel(modelId);
    },
  };
}

export function createPiCompatibleProviderAdapter(provider: PiCompatibleProviderDefinition): ProviderAdapter {
  let client = createSdkClient(provider);
  let lastApiKey = resolvePiProviderApiKey(provider);
  let lastBaseURL = resolvePiProviderBaseURL(provider);

  function refreshClientIfConfigChanged() {
    const nextApiKey = resolvePiProviderApiKey(provider);
    const nextBaseURL = resolvePiProviderBaseURL(provider);
    if (nextApiKey !== lastApiKey || nextBaseURL !== lastBaseURL) {
      client = createSdkClient(provider);
      lastApiKey = nextApiKey;
      lastBaseURL = nextBaseURL;
    }
  }

  return {
    providerId: provider.id,
    isConfigured() {
      return isPiProviderConfigured(provider);
    },
    getChatModel(modelId: string) {
      if (!isPiProviderConfigured(provider)) {
        if (provider.requiresCloudflareAccountId) {
          throw new Error(`${provider.envVar} and CLOUDFLARE_ACCOUNT_ID are required to use ${provider.label}.`);
        }
        throw new Error(`${provider.envVar} is required to use ${provider.label}.`);
      }
      refreshClientIfConfigChanged();
      return client.getChatModel(modelId);
    },
    async listAvailableModels() {
      return provider.defaultModels ?? [];
    },
  };
}
