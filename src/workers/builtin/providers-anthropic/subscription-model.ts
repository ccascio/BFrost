import path from 'path';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import { upsertEnvValue } from '../../../env-file';
import {
  type AnthropicOAuthCredentials,
  resolveAnthropicOAuthCredentials,
  setAnthropicOAuthCredentials,
} from './credentials';

const OAUTH_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const REFRESH_SKEW_MS = 60_000;

export const ANTHROPIC_OAUTH_BETA_HEADER = 'claude-code-20250219,oauth-2025-04-20';

export async function persistAnthropicOAuthCredentials(credentials: AnthropicOAuthCredentials): Promise<void> {
  const envPath = path.join(process.cwd(), '.env');
  await upsertEnvValue(envPath, 'ANTHROPIC_OAUTH_TOKEN', credentials.access);
  await upsertEnvValue(envPath, 'BFROST_ANTHROPIC_OAUTH_REFRESH_TOKEN', credentials.refresh);
  await upsertEnvValue(envPath, 'BFROST_ANTHROPIC_OAUTH_EXPIRES_AT', String(credentials.expires));
  setAnthropicOAuthCredentials(credentials);
}

async function refreshAnthropicOAuthCredentials(refreshToken: string, signal?: AbortSignal): Promise<AnthropicOAuthCredentials> {
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: OAUTH_CLIENT_ID,
      refresh_token: refreshToken,
    }),
    signal,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Anthropic OAuth token refresh failed (${response.status}): ${text || response.statusText}`);
  }
  const json = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!json.access_token || !json.refresh_token || typeof json.expires_in !== 'number') {
    throw new Error('Anthropic OAuth refresh response was missing access_token, refresh_token, or expires_in.');
  }
  return {
    access: json.access_token,
    refresh: json.refresh_token,
    expires: Date.now() + json.expires_in * 1000 - 5 * 60_000,
  };
}

export async function getFreshAnthropicOAuthCredentials(signal?: AbortSignal): Promise<AnthropicOAuthCredentials> {
  const credentials = resolveAnthropicOAuthCredentials();
  if (!credentials.access || !credentials.refresh) {
    throw new Error('Anthropic Claude login not found. Use Settings to log in with Claude, then retry.');
  }
  if (Date.now() < credentials.expires - REFRESH_SKEW_MS) return credentials;
  const refreshed = await refreshAnthropicOAuthCredentials(credentials.refresh, signal);
  await persistAnthropicOAuthCredentials(refreshed);
  return refreshed;
}

function createOAuthSdkModel(modelId: string, accessToken: string) {
  const client = createAnthropic({
    authToken: accessToken,
    headers: {
      'anthropic-beta': ANTHROPIC_OAUTH_BETA_HEADER,
    },
  });
  return client(modelId);
}

export function createAnthropicOAuthLanguageModel(modelId: string): unknown {
  let sdkModel: LanguageModelV3 = createOAuthSdkModel(modelId, resolveAnthropicOAuthCredentials().access);
  let lastAccessToken = resolveAnthropicOAuthCredentials().access;

  async function refreshModel(signal?: AbortSignal) {
    const credentials = await getFreshAnthropicOAuthCredentials(signal);
    if (credentials.access !== lastAccessToken) {
      sdkModel = createOAuthSdkModel(modelId, credentials.access);
      lastAccessToken = credentials.access;
    }
  }

  return new Proxy(
    {},
    {
      get(_target, property) {
        if (property === 'doGenerate') {
          return async (options: Parameters<LanguageModelV3['doGenerate']>[0]) => {
            await refreshModel(options?.abortSignal);
            return sdkModel.doGenerate(options);
          };
        }
        if (property === 'doStream') {
          return async (options: Parameters<LanguageModelV3['doStream']>[0]) => {
            await refreshModel(options?.abortSignal);
            return sdkModel.doStream(options);
          };
        }
        const value = Reflect.get(sdkModel, property);
        return typeof value === 'function' ? value.bind(sdkModel) : value;
      },
    },
  );
}
