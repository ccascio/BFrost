import { createAnthropic } from '@ai-sdk/anthropic';
import { config } from '../../../config';
import type { ProviderAdapter } from '../../module';

const PROVIDER_ID = 'anthropic';

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
  };
}
