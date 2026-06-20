import { createAnthropic } from '@ai-sdk/anthropic';
import { spawnSync } from 'child_process';
import type { ProviderModelOption } from '../../../config';
import type { ProviderAdapter } from '../../module';
import { createCliLanguageModel } from '../provider-cli-model';
import {
  resolveAnthropicApiKey,
  resolveAnthropicAuthMode,
  resolveAnthropicClaudeCliModel,
  resolveAnthropicClaudeCliPath,
} from './credentials';

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

function isClaudeSubscriptionReady(): boolean {
  const result = spawnSync(resolveAnthropicClaudeCliPath(), ['auth', 'status'], {
    timeout: 5000,
    encoding: 'utf8',
  });
  if (result.status !== 0) return false;
  const output = `${result.stdout}\n${result.stderr}`;
  return /"loggedIn"\s*:\s*true/.test(output) || /subscriptionType/i.test(output);
}

function subscriptionModel(): ProviderModelOption {
  const id = resolveAnthropicClaudeCliModel();
  return {
    id,
    alias: `anthropic-subscription-${id}`.toLowerCase().replace(/[^a-z0-9._-]+/g, '-'),
    label: `Claude subscription via Claude CLI (${id})`,
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
      if (resolveAnthropicAuthMode() === 'subscription') return isClaudeSubscriptionReady();
      return Boolean(resolveAnthropicApiKey());
    },
    getChatModel(modelId: string) {
      if (resolveAnthropicAuthMode() === 'subscription') {
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
      return client(modelId);
    },
    async listAvailableModels() {
      if (resolveAnthropicAuthMode() === 'subscription') {
        return isClaudeSubscriptionReady() ? [subscriptionModel()] : [];
      }
      const key = resolveAnthropicApiKey();
      if (!key) return [];
      return fetchModelList(key);
    },
  };
}
