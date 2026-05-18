import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { LanguageModel } from 'ai';
import { config, type ModelOption } from './config';

// Imported lazily to break a CJS cycle: registry → builtin/workers → publisher-x/job → llm.
function activeLocalProvider() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./workers/registry').getActiveLocalProvider();
}

export function isModelProviderConfigured(model: ModelOption): boolean {
  if (model.provider === 'openai') return Boolean(config.openaiApiKey);
  if (model.provider === 'anthropic') return Boolean(config.anthropicApiKey);
  const local = activeLocalProvider();
  return Boolean(local && local.providerId === model.provider && local.isConfigured());
}

export function getChatModel(model: ModelOption): LanguageModel {
  if (model.provider === 'openai') {
    if (!config.openaiApiKey) {
      throw new Error(`OPENAI_API_KEY is required for ${model.alias}.`);
    }
    const openai = createOpenAI({ apiKey: config.openaiApiKey });
    return openai.chat(model.id);
  }

  if (model.provider === 'anthropic') {
    if (!config.anthropicApiKey) {
      throw new Error(`ANTHROPIC_API_KEY is required for ${model.alias}.`);
    }
    const anthropic = createAnthropic({ apiKey: config.anthropicApiKey });
    return anthropic(model.id);
  }

  const local = activeLocalProvider();
  if (!local || local.providerId !== model.provider) {
    throw new Error(
      `No active local provider worker is configured to serve model ${model.alias}. Enable or select provider "${model.provider}".`,
    );
  }
  return local.getChatModel(model.id) as LanguageModel;
}
