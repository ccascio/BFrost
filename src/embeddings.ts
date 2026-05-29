import { config } from './config';

export interface EmbeddingResult {
  provider: 'local' | 'openai';
  model: string;
  embedding: number[];
  dimensions: number;
}

function parseEmbeddingResponse(data: unknown): number[] {
  const value = data as {
    data?: Array<{ embedding?: unknown }>;
    embedding?: unknown;
    embeddings?: unknown[];
  };

  if (Array.isArray(value.data) && Array.isArray(value.data[0]?.embedding)) {
    return value.data[0].embedding.map(Number);
  }
  if (Array.isArray(value.embedding)) {
    return value.embedding.map(Number);
  }
  if (Array.isArray(value.embeddings) && Array.isArray(value.embeddings[0])) {
    return value.embeddings[0].map(Number);
  }
  throw new Error('Embedding endpoint returned an unsupported response shape.');
}

export async function embedText(text: string): Promise<EmbeddingResult> {
  const input = text.trim();
  if (!input) throw new Error('Cannot embed empty text.');

  const provider = config.embeddingProvider;
  const model = config.embeddingModel;
  const isOpenAI = provider === 'openai';
  const baseUrl = isOpenAI ? 'https://api.openai.com/v1' : config.ollamaBaseUrl.replace(/\/$/, '');
  const endpoint = `${baseUrl}/embeddings`;

  if (isOpenAI && !config.openaiApiKey) {
    throw new Error('OpenAI API key is not configured. Set it in Config -> Cloud API keys.');
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (isOpenAI) headers.Authorization = `Bearer ${config.openaiApiKey}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, input }),
  });
  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(`Embedding request failed (${response.status}): ${message || response.statusText}`);
  }

  const embedding = parseEmbeddingResponse(await response.json());
  if (!embedding.length || embedding.some((value) => !Number.isFinite(value))) {
    throw new Error('Embedding endpoint returned an empty or invalid vector.');
  }
  return {
    provider,
    model,
    embedding,
    dimensions: embedding.length,
  };
}
