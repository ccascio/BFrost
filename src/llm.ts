import { AsyncLocalStorage } from 'node:async_hooks';
import { LanguageModel, type ToolSet } from 'ai';
import { resolveReasoningLevel, type ModelOption } from './config';
import type { NativeWebSearchOptions } from './workers/module';

// Imported lazily to break a CJS cycle between the worker registry and model dispatch.
function lookupProvider(providerId: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./workers/registry').getProviderAdapter(providerId);
}

interface ReasoningContext {
  modelAlias: string;
  reasoningLevel: string;
}

// Job runs carry their configured reasoning level ambiently so the many existing
// `getChatModel(model)` call sites inside worker jobs pick it up without a signature
// change. The alias check keeps the level scoped to the job's primary model.
const reasoningContext = new AsyncLocalStorage<ReasoningContext>();

function requestedReasoningLevel(model: ModelOption, explicit?: string): string | undefined {
  const ambient = reasoningContext.getStore();
  const requested = explicit
    ?? (ambient && ambient.modelAlias === model.alias ? ambient.reasoningLevel : undefined);
  return resolveReasoningLevel(model, requested);
}

export function runWithReasoningLevel<T>(
  context: { modelAlias: string; reasoningLevel?: string },
  fn: () => Promise<T>,
): Promise<T> {
  const level = context.reasoningLevel?.trim();
  if (!level) return fn();
  return reasoningContext.run({ modelAlias: context.modelAlias, reasoningLevel: level }, fn);
}

export function isModelProviderConfigured(model: ModelOption): boolean {
  const adapter = lookupProvider(model.provider);
  return Boolean(adapter && adapter.isConfigured());
}

export function getChatModel(
  model: ModelOption,
  options?: { reasoningLevel?: string },
): LanguageModel {
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
  const reasoningLevel = requestedReasoningLevel(model, options?.reasoningLevel);
  return adapter.getChatModel(
    model.id,
    reasoningLevel ? { reasoningLevel } : undefined,
  ) as LanguageModel;
}

/**
 * Resolves a model handle plus native web-search tool(s) for providers that can search the
 * web themselves. Returns undefined for providers without that capability (e.g. local
 * runtimes) so callers fall back to a worker-provided search tool instead.
 */
export function resolveNativeWebSearch(
  model: ModelOption,
  options?: NativeWebSearchOptions,
): { model: LanguageModel; tools: ToolSet } | undefined {
  const adapter = lookupProvider(model.provider);
  if (!adapter?.getNativeWebSearch) return undefined;
  const reasoningLevel = requestedReasoningLevel(model, options?.reasoningLevel);
  const resolved = adapter.getNativeWebSearch(model.id, {
    ...options,
    ...(reasoningLevel ? { reasoningLevel } : {}),
  });
  return resolved ? { model: resolved.model as LanguageModel, tools: resolved.tools as ToolSet } : undefined;
}
