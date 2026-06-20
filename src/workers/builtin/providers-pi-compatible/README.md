# Pi-compatible Providers

This worker ports the OpenAI-compatible provider catalog used by `earendil-works/pi`
into BFrost's worker/provider abstraction. Each provider is registered as a normal
BFrost provider, while credentials are owned by this worker and saved to `.env`.

OpenAI remains owned by `core.providers.openai`. Anthropic remains owned by
`core.providers.anthropic` because BFrost already has native API-key and Claude CLI
subscription support there.
