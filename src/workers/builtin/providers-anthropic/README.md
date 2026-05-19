# `core.providers.anthropic`

Model provider worker that serves Anthropic Claude chat models through the Anthropic HTTP API.

## What it provides

- A `ProviderAdapter` with `providerId: 'anthropic'`.
- `getChatModel(modelId)` returns an AI SDK chat model handle built from `@ai-sdk/anthropic`.
- `isConfigured()` returns `true` when `ANTHROPIC_API_KEY` is set.

No local runtime, no embeddings, no vision capability yet.

## Credentials

- `ANTHROPIC_API_KEY` — required. Configurable from the dashboard System tab; persisted to `.env`.

## Models

Models are declared in `src/config.ts` (`builtInModels`) with `provider: 'anthropic'`. Adding a new
Claude model is a one-line change to that list; no change to this worker is required.

## Operational notes

- The adapter caches a single `createAnthropic` client and rebuilds it if `config.anthropicApiKey`
  changes.
- Cloud providers coexist freely with the active local-runtime provider. The user can pick any
  configured model on a per-job basis.
