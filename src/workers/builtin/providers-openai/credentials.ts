let apiKey = process.env.OPENAI_API_KEY || '';

export function resolveOpenAIApiKey(): string {
  return apiKey.trim();
}

export function setOpenAIApiKey(value: string): void {
  apiKey = value.trim();
}
