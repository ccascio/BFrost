import { createOpenAI } from '@ai-sdk/openai';
import { wrapLanguageModel, type LanguageModel } from 'ai';
import type { ProviderModelOption } from '../../../config';
import type { ChatModelOptions, NativeWebSearchOptions, ProviderAdapter } from '../../module';
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

/**
 * Reasoning-effort levels per OpenAI model family, per vendor docs. OpenAI's /v1/models
 * endpoint does not expose reasoning capabilities, so this map is maintained from the
 * published API documentation. The GPT-5.6 family (sol/terra/luna) accepts the full
 * range and defaults to medium.
 */
function reasoningLevelsFor(modelId: string): string[] | undefined {
  if (modelId.toLowerCase().startsWith('gpt-5.6')) {
    return ['none', 'low', 'medium', 'high', 'xhigh', 'max'];
  }
  return undefined;
}

/**
 * Apply a selected reasoning level by injecting OpenAI's `reasoningEffort` provider
 * option ahead of every generate/stream call on this handle.
 */
function withReasoningEffort(model: LanguageModel, effort: string | undefined): LanguageModel {
  if (!effort) return model;
  return wrapLanguageModel({
    model: model as Parameters<typeof wrapLanguageModel>[0]['model'],
    middleware: {
      specificationVersion: 'v3',
      transformParams: async ({ params }) => ({
        ...params,
        providerOptions: {
          ...params.providerOptions,
          openai: {
            ...(params.providerOptions?.openai ?? {}),
            reasoningEffort: effort,
          },
        },
      }),
    },
  }) as LanguageModel;
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
    .map((entry) => {
      const reasoningLevels = reasoningLevelsFor(entry.id);
      return { id: entry.id, label: entry.id, ...(reasoningLevels ? { reasoningLevels } : {}) };
    });
}

// Known chat-capable models available through ChatGPT subscription (Codex CLI).
const OPENAI_SUBSCRIPTION_MODELS = [
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.4-nano',
  'o4-mini',
  'o3',
  'o3-mini',
  'gpt-4o',
  'gpt-4o-mini',
];

function subscriptionModels(): ProviderModelOption[] {
  const configured = resolveOpenAICodexCliModel();
  const ids = OPENAI_SUBSCRIPTION_MODELS.includes(configured)
    ? OPENAI_SUBSCRIPTION_MODELS
    : [configured, ...OPENAI_SUBSCRIPTION_MODELS];
  return ids.map((id) => {
    const reasoningLevels = reasoningLevelsFor(id);
    return {
      id,
      alias: `openai-subscription-${id}`.toLowerCase().replace(/[^a-z0-9._-]+/g, '-'),
      label: `ChatGPT subscription (${id})`,
      ...(reasoningLevels ? { reasoningLevels } : {}),
    };
  });
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
    getChatModel(modelId: string, options?: ChatModelOptions) {
      const reasoningLevel = options?.reasoningLevel;
      if (resolveOpenAIAuthMode() === 'subscription') {
        return withReasoningEffort(
          createOpenAICodexSubscriptionLanguageModel(
            modelId || resolveOpenAICodexCliModel(),
          ) as LanguageModel,
          reasoningLevel,
        );
      }
      if (!resolveOpenAIApiKey()) {
        throw new Error('OPENAI_API_KEY is required to use OpenAI models.');
      }
      refreshClientIfKeyChanged();
      if (reasoningLevel) {
        // The Responses API accepts the full vendor effort range (including `max`,
        // which the Chat Completions schema does not); reasoning models dispatch there.
        return withReasoningEffort(client.responses(modelId) as LanguageModel, reasoningLevel);
      }
      return client.chat(modelId);
    },
    getNativeWebSearch(modelId: string, options?: NativeWebSearchOptions) {
      const reasoningLevel = options?.reasoningLevel;
      const webSearch = client.tools.webSearch({
        searchContextSize: options?.searchContextSize,
        filters: options?.allowedDomains?.length
          ? { allowedDomains: options.allowedDomains }
          : undefined,
      });
      if (resolveOpenAIAuthMode() === 'subscription') {
        return {
          model: withReasoningEffort(
            createOpenAICodexSubscriptionLanguageModel(modelId || resolveOpenAICodexCliModel()) as LanguageModel,
            reasoningLevel,
          ),
          tools: { web_search: webSearch },
        };
      }
      if (!resolveOpenAIApiKey()) return undefined;
      refreshClientIfKeyChanged();
      // OpenAI's web_search tool is only exposed through the Responses API, not Chat
      // Completions, so API-key mode needs its own Responses model handle.
      return {
        model: withReasoningEffort(client.responses(modelId) as LanguageModel, reasoningLevel),
        tools: { web_search: client.tools.webSearch({
          searchContextSize: options?.searchContextSize,
          filters: options?.allowedDomains?.length
            ? { allowedDomains: options.allowedDomains }
            : undefined,
        }) },
      };
    },
    async listAvailableModels() {
      if (resolveOpenAIAuthMode() === 'subscription') {
        return readOpenAICodexSubscriptionReady() ? subscriptionModels() : [];
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
