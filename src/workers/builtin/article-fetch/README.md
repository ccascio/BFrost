# `core.article-fetch`

HTML article fetch + extraction behind a single assistant tool. Reference implementation of a minimal stateless tool worker.

## Tools

- `fetchArticle(url: string)` — fetches the URL, follows redirects, and returns `{ title, description, excerpt, finalUrl }`.

## Operational notes

- No credentials, no storage, no scheduled job. The worker exists purely so the extraction logic has an owner on the worker map and can be disabled cleanly.
- `core.news` and `core.convertprivately` import `fetchArticle` from this worker module at runtime.
- Disabling this worker disables article enrichment in News and ConvertPrivately — the dashboard health row surfaces that dependency.
