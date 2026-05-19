# `core.providers.openai`

Model provider worker that serves OpenAI chat models through the OpenAI HTTP API.

## What it provides

- A `ProviderAdapter` with `providerId: 'openai'`.
- `getChatModel(modelId)` returns an AI SDK chat model handle built from `@ai-sdk/openai`.
- `isConfigured()` returns `true` when `OPENAI_API_KEY` is set.

No local runtime, no embeddings, no vision capability yet.

## Credentials

- `OPENAI_API_KEY` — required. Configurable from the dashboard System tab; persisted to `.env`.

## Models

Models are declared in `src/config.ts` (`builtInModels`) with `provider: 'openai'`. Adding a new
OpenAI model is a one-line change to that list; no change to this worker is required.

## Operational notes

- The adapter caches a single `createOpenAI` client and rebuilds it if `config.openaiApiKey` changes.
- Cloud providers coexist freely with the active local-runtime provider. The user can pick any
  configured model on a per-job basis.
