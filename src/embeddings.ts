import { config } from './config';
import { getActiveLocalProvider, getProviderAdapter } from './workers/registry';

export interface EmbeddingResult {
  provider: string;
  model: string;
  embedding: number[];
  dimensions: number;
}

export async function embedText(text: string): Promise<EmbeddingResult> {
  const input = text.trim();
  if (!input) throw new Error('Cannot embed empty text.');

  const provider = config.embeddingProvider || 'local';
  const model = config.embeddingModel;

  const adapter = provider === 'local'
    ? getActiveLocalProvider()
    : getProviderAdapter(provider);
  if (!adapter?.embedText) {
    throw new Error(`Embedding provider "${provider}" does not support embeddings.`);
  }

  const embedding = await adapter.embedText(model, input);
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
