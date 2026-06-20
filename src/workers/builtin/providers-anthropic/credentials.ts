export type AnthropicAuthMode = 'api' | 'subscription';

let apiKey = process.env.ANTHROPIC_API_KEY || '';
let authMode: AnthropicAuthMode = process.env.BFROST_ANTHROPIC_AUTH_MODE === 'subscription' ? 'subscription' : 'api';
let claudeCliPath = process.env.BFROST_ANTHROPIC_CLAUDE_CLI || 'claude';
let claudeCliModel = process.env.BFROST_ANTHROPIC_CLAUDE_MODEL || 'sonnet';

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
  return claudeCliModel.trim() || 'sonnet';
}

export function setAnthropicClaudeCliModel(value: string): void {
  claudeCliModel = value.trim() || 'sonnet';
}

export function anthropicSettingsSnapshot() {
  return {
    authMode: resolveAnthropicAuthMode(),
    claudeCliPath: resolveAnthropicClaudeCliPath(),
    claudeCliModel: resolveAnthropicClaudeCliModel(),
  };
}
