import { loadKvJson, saveKvJson } from './sqlite';

const PIN_KV_KEY = 'localRuntime.pinnedModel';

interface PinPayload {
  modelId: string | null;
}

let cache: string | null | undefined; // undefined = not hydrated yet

async function hydrate(): Promise<void> {
  if (cache !== undefined) return;
  const stored = await loadKvJson<PinPayload>(PIN_KV_KEY);
  cache = stored?.modelId ?? null;
}

export async function getPinnedModelId(): Promise<string | null> {
  await hydrate();
  return cache ?? null;
}

/** Synchronous getter usable inside hot paths once hydrated. Returns null if not yet hydrated. */
export function getPinnedModelIdSync(): string | null {
  return cache ?? null;
}

export async function setPinnedModelId(modelId: string | null): Promise<void> {
  await hydrate();
  cache = modelId;
  await saveKvJson(PIN_KV_KEY, { modelId });
}
