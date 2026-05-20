import { createAnthropic } from '@ai-sdk/anthropic';
import { config, type ProviderModelOption } from '../../../config';
import type { ProviderAdapter } from '../../module';

const PROVIDER_ID = 'anthropic';
const ANTHROPIC_API_VERSION = '2023-06-01';

interface AnthropicModelEntry {
  type?: string;
  id: string;
  display_name?: string;
}

interface AnthropicModelListResponse {
  data?: AnthropicModelEntry[];
}

async function fetchModelList(apiKey: string): Promise<ProviderModelOption[]> {
  const response = await fetch('https://api.anthropic.com/v1/models', {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_API_VERSION,
    },
  });
  if (!response.ok) {
    throw new Error(`Anthropic /v1/models returned ${response.status}.`);
  }
  const body = (await response.json()) as AnthropicModelListResponse;
  const entries = body.data ?? [];
  return entries
    .filter((entry) => entry.id)
    .map((entry) => ({ id: entry.id, label: entry.display_name?.trim() || entry.id }));
}

export function createAnthropicProviderAdapter(): ProviderAdapter {
  let client = createAnthropic({ apiKey: config.anthropicApiKey });
  let lastKey = config.anthropicApiKey;

  function refreshClientIfKeyChanged() {
    if (config.anthropicApiKey !== lastKey) {
      client = createAnthropic({ apiKey: config.anthropicApiKey });
      lastKey = config.anthropicApiKey;
    }
  }

  return {
    providerId: PROVIDER_ID,
    isConfigured() {
      return Boolean(config.anthropicApiKey);
    },
    getChatModel(modelId: string) {
      if (!config.anthropicApiKey) {
        throw new Error('ANTHROPIC_API_KEY is required to use Anthropic models.');
      }
      refreshClientIfKeyChanged();
      return client(modelId);
    },
    async listAvailableModels() {
      if (!config.anthropicApiKey) return [];
      return fetchModelList(config.anthropicApiKey);
    },
  };
}
