---
name: Worker proposal
about: Propose a new worker — producer, consumer, channel, provider, or assistant tool
title: "[Worker proposal] "
labels: worker, proposal
---

## Worker ID

Proposed id (e.g. `local.mastodon-publisher` for a community worker, `core.providers.ollama` for a built-in reference worker).

- [ ] Local worker (default — lives in `workers/local/`)
- [ ] Built-in reference worker (rare — lives in `src/workers/builtin/`)

## What it does

One paragraph. What capability does it add to BFrost?

## Role on the Item Bus

- **Produces** (itemType, tags):
- **Consumes** (itemType, filters):
- **Neither** — tool / channel / provider only

## Surfaces

- [ ] Cron job(s)
- [ ] Settings form on the Configuration tab
- [ ] Custom dashboard tab (`dashboardSource` bundle)
- [ ] Assistant tool(s) callable from the agent
- [ ] Channel adapter (text/image/audio/files/markdown)
- [ ] Model provider (chat/embeddings/vision/local-runtime)

## Credentials and dependencies

What secrets, env vars, binaries, or other workers does it need?

## Why a worker (and not a core change)?

Confirm this fits inside the worker contract. If you think it requires a core change, open a **Feature request** instead.

## References

Existing examples or workers you'd model this after (e.g. `workers/examples/wordpress-publisher` for a consumer worker, `core.providers.lmstudio` for a provider worker).
