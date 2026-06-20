export type AnthropicAuthMode = 'api' | 'subscription';

let apiKey = process.env.ANTHROPIC_API_KEY || '';
let authMode: AnthropicAuthMode = process.env.BFROST_ANTHROPIC_AUTH_MODE === 'subscription' ? 'subscription' : 'api';
let claudeCliPath = process.env.BFROST_ANTHROPIC_CLAUDE_CLI || 'claude';
let subscriptionModel =
  process.env.BFROST_ANTHROPIC_SUBSCRIPTION_MODEL ||
  process.env.BFROST_ANTHROPIC_CLAUDE_MODEL ||
  'claude-sonnet-4-6';

export interface AnthropicOAuthCredentials {
  access: string;
  refresh: string;
  expires: number;
}

let oauthCredentials: AnthropicOAuthCredentials = {
  access: process.env.ANTHROPIC_OAUTH_TOKEN || '',
  refresh: process.env.BFROST_ANTHROPIC_OAUTH_REFRESH_TOKEN || '',
  expires: Number(process.env.BFROST_ANTHROPIC_OAUTH_EXPIRES_AT || '0'),
};

export function resolveAnthropicApiKey(): string {
  return apiKey.trim();
}

export function setAnthropicApiKey(value: string): void {
  apiKey = value.trim();
}

export function resolveAnthropicAuthMode(): AnthropicAuthMode {
  return authMode;
}

export function setAnthropicAuthMode(value: string): void {
  authMode = value === 'subscription' ? 'subscription' : 'api';
}

export function resolveAnthropicClaudeCliPath(): string {
  return claudeCliPath.trim() || 'claude';
}

export function setAnthropicClaudeCliPath(value: string): void {
  claudeCliPath = value.trim() || 'claude';
}

export function resolveAnthropicClaudeCliModel(): string {
  return resolveAnthropicSubscriptionModel();
}

export function setAnthropicClaudeCliModel(value: string): void {
  setAnthropicSubscriptionModel(value);
}

export function resolveAnthropicSubscriptionModel(): string {
  return subscriptionModel.trim() || 'claude-sonnet-4-6';
}

export function setAnthropicSubscriptionModel(value: string): void {
  subscriptionModel = value.trim() || 'claude-sonnet-4-6';
}

export function resolveAnthropicOAuthCredentials(): AnthropicOAuthCredentials {
  return {
    access: oauthCredentials.access.trim(),
    refresh: oauthCredentials.refresh.trim(),
    expires: Number.isFinite(oauthCredentials.expires) ? oauthCredentials.expires : 0,
  };
}

export function setAnthropicOAuthCredentials(credentials: AnthropicOAuthCredentials): void {
  oauthCredentials = {
    access: credentials.access.trim(),
    refresh: credentials.refresh.trim(),
    expires: Number.isFinite(credentials.expires) ? credentials.expires : 0,
  };
}

export function readAnthropicOAuthReady(): boolean {
  const credentials = resolveAnthropicOAuthCredentials();
  return Boolean(credentials.access && credentials.refresh);
}

export function anthropicSettingsSnapshot() {
  return {
    authMode: resolveAnthropicAuthMode(),
    oauthConfigured: readAnthropicOAuthReady(),
    subscriptionModel: resolveAnthropicSubscriptionModel(),
    claudeCliPath: resolveAnthropicClaudeCliPath(),
  };
}
