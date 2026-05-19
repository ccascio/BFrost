import { LanguageModel } from 'ai';
import { type ModelOption } from './config';

// Imported lazily to break a CJS cycle: registry → builtin/workers → publisher-x/job → llm.
function lookupProvider(providerId: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./workers/registry').getProviderAdapter(providerId);
}

export function isModelProviderConfigured(model: ModelOption): boolean {
  const adapter = lookupProvider(model.provider);
  return Boolean(adapter && adapter.isConfigured());
}

export function getChatModel(model: ModelOption): LanguageModel {
  const adapter = lookupProvider(model.provider);
  if (!adapter) {
    throw new Error(
      `No provider worker is registered for "${model.provider}". Install or enable the matching provider worker to use model ${model.alias}.`,
    );
  }
  if (!adapter.isConfigured()) {
    throw new Error(
      `Provider "${model.provider}" is not configured. Add the required credentials before using model ${model.alias}.`,
    );
  }
  return adapter.getChatModel(model.id) as LanguageModel;
}
