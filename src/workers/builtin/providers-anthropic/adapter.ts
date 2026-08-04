import { createAnthropic } from '@ai-sdk/anthropic';
import { wrapLanguageModel, type LanguageModel } from 'ai';
import { spawnSync } from 'child_process';
import type { ProviderModelOption } from '../../../config';
import type { ChatModelOptions, NativeWebSearchOptions, ProviderAdapter } from '../../module';
import { createCliLanguageModel } from '../provider-cli-model';
import {
  resolveAnthropicApiKey,
  resolveAnthropicAuthMode,
  resolveAnthropicClaudeCliModel,
  resolveAnthropicClaudeCliPath,
  readAnthropicOAuthReady,
} from './credentials';
import { createAnthropicOAuthLanguageModel, getFreshAnthropicOAuthCredentials, ANTHROPIC_OAUTH_BETA_HEADER } from './subscription-model';

const PROVIDER_ID = 'anthropic';
const ANTHROPIC_API_VERSION = '2023-06-01';
const CLAUDE_CLI_CLEAR_ENV = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_API_KEY_OLD',
  'ANTHROPIC_API_TOKEN',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_CUSTOM_HEADERS',
  'ANTHROPIC_OAUTH_TOKEN',
  'ANTHROPIC_UNIX_SOCKET',
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_OAUTH_REFRESH_TOKEN',
  'CLAUDE_CODE_OAUTH_SCOPES',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
  'CLAUDE_CODE_PLUGIN_CACHE_DIR',
  'CLAUDE_CODE_PLUGIN_SEED_DIR',
  'CLAUDE_CODE_REMOTE',
  'CLAUDE_CODE_USE_COWORK_PLUGINS',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_VERTEX',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_HEADERS',
  'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT',
  'OTEL_EXPORTER_OTLP_LOGS_HEADERS',
  'OTEL_EXPORTER_OTLP_LOGS_PROTOCOL',
  'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT',
  'OTEL_EXPORTER_OTLP_METRICS_HEADERS',
  'OTEL_EXPORTER_OTLP_METRICS_PROTOCOL',
  'OTEL_EXPORTER_OTLP_PROTOCOL',
  'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
  'OTEL_EXPORTER_OTLP_TRACES_HEADERS',
  'OTEL_EXPORTER_OTLP_TRACES_PROTOCOL',
  'OTEL_LOGS_EXPORTER',
  'OTEL_METRICS_EXPORTER',
  'OTEL_SDK_DISABLED',
  'OTEL_TRACES_EXPORTER',
] as const;

interface AnthropicModelEntry {
  type?: string;
  id: string;
  display_name?: string;
  /** Per-model capability tree exposed by /v1/models (present since Mar 2026). */
  capabilities?: {
    effort?: Record<string, { supported?: boolean } | boolean | undefined>;
  };
}

interface AnthropicModelListResponse {
  data?: AnthropicModelEntry[];
}

// Anthropic's canonical effort order, lightest first.
const EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * Vendor-documented effort support per model family; used when /v1/models does not
 * include a `capabilities` tree (older API responses, subscription fallback entries).
 */
function staticReasoningLevels(modelId: string): string[] | undefined {
  const id = modelId.toLowerCase();
  if (/^claude-(opus-4-[78]|sonnet-5|fable-5|mythos-5)/.test(id)) {
    return ['low', 'medium', 'high', 'xhigh', 'max'];
  }
  if (/^claude-(opus-4-6|sonnet-4-6)/.test(id)) {
    return ['low', 'medium', 'high', 'max'];
  }
  if (/^claude-opus-4-5/.test(id)) {
    return ['low', 'medium', 'high'];
  }
  return undefined;
}

/** Prefer the vendor's live capability report; fall back to the static family map. */
function reasoningLevelsFor(entry: AnthropicModelEntry): string[] | undefined {
  const effort = entry.capabilities?.effort;
  if (effort && typeof effort === 'object') {
    const levels = EFFORT_ORDER.filter((level) => {
      const value = effort[level];
      return value === true || (typeof value === 'object' && value?.supported === true);
    });
    return levels.length > 0 ? levels : undefined;
  }
  return staticReasoningLevels(entry.id);
}

/**
 * Apply a selected reasoning level by injecting Anthropic's `effort` provider option
 * ahead of every generate/stream call on this handle.
 */
function withEffort(model: LanguageModel, effort: string | undefined): LanguageModel {
  if (!effort) return model;
  return wrapLanguageModel({
    model: model as Parameters<typeof wrapLanguageModel>[0]['model'],
    middleware: {
      specificationVersion: 'v3',
      transformParams: async ({ params }) => ({
        ...params,
        providerOptions: {
          ...params.providerOptions,
          anthropic: {
            ...(params.providerOptions?.anthropic ?? {}),
            effort,
          },
        },
      }),
    },
  }) as LanguageModel;
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
    .map((entry) => {
      const reasoningLevels = reasoningLevelsFor(entry);
      return {
        id: entry.id,
        label: entry.display_name?.trim() || entry.id,
        ...(reasoningLevels ? { reasoningLevels } : {}),
      };
    });
}

async function fetchModelListWithOAuth(): Promise<ProviderModelOption[]> {
  const credentials = await getFreshAnthropicOAuthCredentials();
  const response = await fetch('https://api.anthropic.com/v1/models', {
    headers: {
      Authorization: `Bearer ${credentials.access}`,
      'anthropic-version': ANTHROPIC_API_VERSION,
      'anthropic-beta': ANTHROPIC_OAUTH_BETA_HEADER,
    },
  });
  if (!response.ok) {
    throw new Error(`Anthropic /v1/models (OAuth) returned ${response.status}.`);
  }
  const body = (await response.json()) as AnthropicModelListResponse;
  const entries = body.data ?? [];
  return entries
    .filter((entry) => entry.id)
    .map((entry) => {
      const reasoningLevels = reasoningLevelsFor(entry);
      return {
        id: entry.id,
        label: entry.display_name?.trim() || entry.id,
        ...(reasoningLevels ? { reasoningLevels } : {}),
      };
    });
}

function isClaudeSubscriptionReady(): boolean {
  const result = spawnSync(resolveAnthropicClaudeCliPath(), ['auth', 'status'], {
    timeout: 5000,
    encoding: 'utf8',
  });
  if (result.status !== 0) return false;
  const output = `${result.stdout}\n${result.stderr}`;
  return /"loggedIn"\s*:\s*true/.test(output) || /subscriptionType/i.test(output);
}

function subscriptionModel(reasoningSupported: boolean): ProviderModelOption {
  const id = resolveAnthropicClaudeCliModel();
  const reasoningLevels = reasoningSupported ? staticReasoningLevels(id) : undefined;
  return {
    id,
    alias: `anthropic-subscription-${id}`.toLowerCase().replace(/[^a-z0-9._-]+/g, '-'),
    label: `Claude subscription (${id})`,
    ...(reasoningLevels ? { reasoningLevels } : {}),
  };
}

export function createAnthropicProviderAdapter(): ProviderAdapter {
  let client = createAnthropic({ apiKey: resolveAnthropicApiKey() });
  let lastKey = resolveAnthropicApiKey();

  function refreshClientIfKeyChanged() {
    const key = resolveAnthropicApiKey();
    if (key !== lastKey) {
      client = createAnthropic({ apiKey: key });
      lastKey = key;
    }
  }

  return {
    providerId: PROVIDER_ID,
    isConfigured() {
      if (resolveAnthropicAuthMode() === 'subscription') {
        return readAnthropicOAuthReady() || isClaudeSubscriptionReady();
      }
      return Boolean(resolveAnthropicApiKey());
    },
    getChatModel(modelId: string, options?: ChatModelOptions) {
      if (resolveAnthropicAuthMode() === 'subscription') {
        if (readAnthropicOAuthReady()) {
          return withEffort(
            createAnthropicOAuthLanguageModel(modelId || resolveAnthropicClaudeCliModel()) as LanguageModel,
            options?.reasoningLevel,
          );
        }
        if (!isClaudeSubscriptionReady()) {
          throw new Error('Anthropic Claude login not found. Use Settings to log in with Claude, then retry.');
        }
        // The claude CLI exposes no effort/reasoning flag, so a selected level cannot
        // be applied on this auth path — the CLI's own defaults are used.
        return createCliLanguageModel({
          providerId: PROVIDER_ID,
          modelId: modelId || resolveAnthropicClaudeCliModel(),
          command: resolveAnthropicClaudeCliPath(),
          clearEnv: CLAUDE_CLI_CLEAR_ENV,
          buildArgs(model) {
            return [
              '--print',
              '--safe-mode',
              '--setting-sources',
              'user',
              '--tools',
              '',
              '--model',
              model,
              '--output-format',
              'text',
              '--no-session-persistence',
            ];
          },
          async readOutput(_outputPath, stdout) {
            return stdout;
          },
        });
      }
      if (!resolveAnthropicApiKey()) {
        throw new Error('ANTHROPIC_API_KEY is required to use Anthropic models.');
      }
      refreshClientIfKeyChanged();
      return withEffort(client(modelId) as LanguageModel, options?.reasoningLevel);
    },
    getNativeWebSearch(modelId: string, options?: NativeWebSearchOptions) {
      // Subscription auth (Claude CLI / OAuth) doesn't go through this API-key client, so
      // native web search isn't available there — caller falls back to the search worker.
      if (resolveAnthropicAuthMode() === 'subscription' || !resolveAnthropicApiKey()) return undefined;
      refreshClientIfKeyChanged();
      return {
        model: withEffort(client(modelId) as LanguageModel, options?.reasoningLevel),
        tools: { web_search: client.tools.webSearch_20250305() },
      };
    },
    async listAvailableModels() {
      if (resolveAnthropicAuthMode() === 'subscription') {
        if (readAnthropicOAuthReady()) {
          try {
            return await fetchModelListWithOAuth();
          } catch {
            return [subscriptionModel(true)];
          }
        }
        return isClaudeSubscriptionReady() ? [subscriptionModel(false)] : [];
      }
      const key = resolveAnthropicApiKey();
      if (!key) return [];
      return fetchModelList(key);
    },
  };
}
