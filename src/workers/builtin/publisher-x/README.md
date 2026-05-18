# `core.publisher.x`

Consumes `news.article` items and posts them to X (Twitter), with an approval gate and an editable LLM prompt. Reference implementation of an Item Bus **consumer**.

## What it consumes

- `itemType: news.article` (from `core.news`)
- Selects items in `state ∈ {queued, approved}` that this consumer has not already handled.
- Optionally reads `metadata['core.convertprivately']` to attach a published article URL to the tweet.

## What it writes

- `metadata['core.publisher.x']`: `{ tweetId, tone, postedUrl }` on success.
- `state -> 'posted'` on success; `state -> 'failed'` with retry semantics on failure (`maxAttempts: 3`).

## Settings

- **X publisher job** — cron, approval defaults, model, prompt, parameter settings.
- **X credentials** — local environment values for the X API (`X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET`).

## Operational notes

- `x-client.ts` is the HTTP client. It lives inside this worker — no other worker imports it.
- Approval-gated by default. Disable approval only for trusted automation.
- `job.test.ts` covers the consumer happy path, failure retry, and metadata coordination with `core.convertprivately`.
