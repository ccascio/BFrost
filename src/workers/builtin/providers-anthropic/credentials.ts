let apiKey = process.env.ANTHROPIC_API_KEY || '';

export function resolveAnthropicApiKey(): string {
  return apiKey.trim();
}

export function setAnthropicApiKey(value: string): void {
  apiKey = value.trim();
}
