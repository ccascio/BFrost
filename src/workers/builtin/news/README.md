# `core.news`

Scheduled harvesting of AI/tech news. Scores sources, deduplicates near-identical articles, and publishes items onto the Item Bus for downstream consumers (X Publisher, ConvertPrivately, and any community-authored publisher).

## What it produces

- `itemType: news.article`
- `tags: ['news', ...]`
- `payload`: `{ source, sourceHost, sourceScore, sourceLabel, sourceReasons, article: { title, description, excerpt, finalUrl, fetched }, digestRunId }`

Consumers should read these through the `newsPayloadFields(item)` helper in `news/payload.ts` rather than indexing into `payload` directly.

## Settings

- **News digest job** — cron, model, prompt, parameter settings.
- **Source quality rules** — schema-driven dashboard form. Min source score, must-have categories, banned hosts. Edited in the Config tab; values seeded from live state via `seedPath`.

## Credentials

- `requiredCredentials`: Google Custom Search (`GOOGLE_API_KEY`, `GOOGLE_SEARCH_ENGINE_ID`). Used for source discovery.

## Operational notes

- Near-duplicate detection lives in `near-duplicates.ts` (canonical URL + title-token Jaccard). It runs per digest, not globally — re-runs can re-surface earlier items if the queue has been pruned.
- `runs.ts` persists digest runs in worker-owned state for the dashboard's run history view.
- Owns `/api/google-credentials` (the credentials form on the dashboard). The `core.search.google` worker imports the same credentials at runtime.
