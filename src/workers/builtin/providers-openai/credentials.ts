export type OpenAIAuthMode = 'api' | 'subscription';

let apiKey = process.env.OPENAI_API_KEY || '';
let authMode: OpenAIAuthMode = process.env.BFROST_OPENAI_AUTH_MODE === 'subscription' ? 'subscription' : 'api';
let codexCliModel = process.env.BFROST_OPENAI_CODEX_MODEL || 'gpt-5.4-mini';

export function resolveOpenAIApiKey(): string {
  return apiKey.trim();
}

export function setOpenAIApiKey(value: string): void {
  apiKey = value.trim();
}

export function resolveOpenAIAuthMode(): OpenAIAuthMode {
  return authMode;
}

export function setOpenAIAuthMode(value: string): void {
  authMode = value === 'subscription' ? 'subscription' : 'api';
}

export function resolveOpenAICodexCliModel(): string {
  return codexCliModel.trim() || 'gpt-5.4-mini';
}

export function setOpenAICodexCliModel(value: string): void {
  codexCliModel = value.trim() || 'gpt-5.4-mini';
}

export function openAISettingsSnapshot() {
  return {
    authMode: resolveOpenAIAuthMode(),
    codexCliModel: resolveOpenAICodexCliModel(),
  };
}
