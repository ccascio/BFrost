import { createOpenAI } from '@ai-sdk/openai';
import { config, type ProviderModelOption } from '../../../config';
import type { ProviderAdapter } from '../../module';

const PROVIDER_ID = 'openai';

interface OpenAiModelEntry {
  id: string;
  object?: string;
  owned_by?: string;
}

interface OpenAiModelListResponse {
  data?: OpenAiModelEntry[];
}

// Heuristic: chat-capable OpenAI model ids start with gpt-, chatgpt-, or o[0-9].
// Filters out embedding/whisper/tts/dall-e ids so the dashboard model picker stays useful.
function isChatCapable(id: string): boolean {
  const lower = id.toLowerCase();
  if (lower.startsWith('gpt-') || lower.startsWith('chatgpt-')) return true;
  if (/^o\d/.test(lower)) return true;
  return false;
}

async function fetchModelList(apiKey: string): Promise<ProviderModelOption[]> {
  const response = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    throw new Error(`OpenAI /v1/models returned ${response.status}.`);
  }
  const body = (await response.json()) as OpenAiModelListResponse;
  const entries = body.data ?? [];
  return entries
    .filter((entry) => entry.id && isChatCapable(entry.id))
    .map((entry) => ({ id: entry.id, label: entry.id }));
}

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
    async listAvailableModels() {
      if (!config.openaiApiKey) return [];
      return fetchModelList(config.openaiApiKey);
    },
  };
}
