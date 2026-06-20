import { createOpenAI } from '@ai-sdk/openai';
import type { ProviderModelOption } from '../../../config';
import type { ProviderAdapter } from '../../module';
import {
  resolveOpenAIApiKey,
  resolveOpenAIAuthMode,
  resolveOpenAICodexCliModel,
} from './credentials';
import {
  createOpenAICodexSubscriptionLanguageModel,
  readOpenAICodexSubscriptionReady,
} from './subscription-model';

const PROVIDER_ID = 'openai';

interface OpenAiModelEntry {
  id: string;
  object?: string;
  owned_by?: string;
}

interface OpenAiModelListResponse {
  data?: OpenAiModelEntry[];
}

function parseEmbeddingResponse(data: unknown): number[] {
  const value = data as { data?: Array<{ embedding?: unknown }> };
  const embedding = value.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) {
    throw new Error('OpenAI embedding endpoint returned an unsupported response shape.');
  }
  return embedding.map(Number);
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

function subscriptionModel(): ProviderModelOption {
  const id = resolveOpenAICodexCliModel();
  return {
    id,
    alias: `openai-subscription-${id}`.toLowerCase().replace(/[^a-z0-9._-]+/g, '-'),
    label: `ChatGPT subscription (${id})`,
  };
}

export function createOpenAIProviderAdapter(): ProviderAdapter {
  let client = createOpenAI({ apiKey: resolveOpenAIApiKey() });
  let lastKey = resolveOpenAIApiKey();

  function refreshClientIfKeyChanged() {
    const key = resolveOpenAIApiKey();
    if (key !== lastKey) {
      client = createOpenAI({ apiKey: key });
      lastKey = key;
    }
  }

  return {
    providerId: PROVIDER_ID,
    isConfigured() {
      if (resolveOpenAIAuthMode() === 'subscription') return readOpenAICodexSubscriptionReady();
      return Boolean(resolveOpenAIApiKey());
    },
    getChatModel(modelId: string) {
      if (resolveOpenAIAuthMode() === 'subscription') {
        return createOpenAICodexSubscriptionLanguageModel(modelId || resolveOpenAICodexCliModel());
      }
      if (!resolveOpenAIApiKey()) {
        throw new Error('OPENAI_API_KEY is required to use OpenAI models.');
      }
      refreshClientIfKeyChanged();
      return client.chat(modelId);
    },
    async listAvailableModels() {
      if (resolveOpenAIAuthMode() === 'subscription') {
        return readOpenAICodexSubscriptionReady() ? [subscriptionModel()] : [];
      }
      const key = resolveOpenAIApiKey();
      if (!key) return [];
      return fetchModelList(key);
    },
    async embedText(modelId: string, input: string) {
      const key = resolveOpenAIApiKey();
      if (!key) {
        throw new Error('OpenAI API key is required to generate embeddings.');
      }
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: modelId, input }),
      });
      if (!response.ok) {
        const message = await response.text().catch(() => response.statusText);
        throw new Error(`OpenAI embedding request failed (${response.status}): ${message || response.statusText}`);
      }
      return parseEmbeddingResponse(await response.json());
    },
  };
}
