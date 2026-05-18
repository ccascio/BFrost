# `core.providers.lmstudio`

Local OpenAI-compatible chat model server managed by the LM Studio CLI. Reference implementation of a **model provider worker** — exposes a `ProviderAdapter` rather than scheduled jobs or tools.

## Capabilities

- `chat`, `local-runtime`. No embeddings or vision yet — workers that need those should declare `optional` provider capability flags and fall back gracefully when the active provider doesn't supply them.

## Adapter surface

- `getChatModel(modelId)` — returns the model handle used by `src/llm.ts`.
- `startRuntime()` / `stopRuntime()` — boots/stops the LM Studio CLI.
- `getRuntimeStatus()` — reports server health for the dashboard.
- `listLoadedModels()`, `loadModel(id)`, `unloadModel(id)`, `unloadAllModels()` — surface the operator controls in the Models tab.

`src/llm.ts` dispatches the local branch through `getActiveLocalProvider()`. Adapter instances are cached per provider id so the LM Studio server keeps coherent state across requests.

## Operational notes

- This worker assumes the LM Studio CLI binary is available on `PATH` (or at a configured path). The health row surfaces a clear failure when it is missing.
- Disabling this worker surfaces a "no provider available" health failure. The rest of BFrost continues to run — the chat surface and any worker that calls the local LLM will fail gracefully until another provider worker is enabled.
- An `core.providers.ollama` worker can slot into the same contract without any core change. The wish list in `ROADMAP.md` tracks that work.
