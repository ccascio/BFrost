import { createOpenAI } from '@ai-sdk/openai';
import { config } from '../../../config';
import type { ProviderAdapter } from '../../module';

const PROVIDER_ID = 'openai';

export function createOpenAIProviderAdapter(): ProviderAdapter {
  let client = createOpenAI({ apiKey: config.openaiApiKey });
  let lastKey = config.openaiApiKey;

  function refreshClientIfKeyChanged() {
    if (config.openaiApiKey !== lastKey) {
      client = createOpenAI({ apiKey: config.openaiApiKey });
      lastKey = config.openaiApiKey;
    }
  }

  return {
    providerId: PROVIDER_ID,
    isConfigured() {
      return Boolean(config.openaiApiKey);
    },
    getChatModel(modelId: string) {
      if (!config.openaiApiKey) {
        throw new Error('OPENAI_API_KEY is required to use OpenAI models.');
      }
      refreshClientIfKeyChanged();
      return client.chat(modelId);
    },
  };
}
