# `core.search.google`

Google Custom Search behind a single assistant tool. Reference implementation of a **shared-credential tool worker**.

## Tools

- `webSearch(query: string, limit?: number)` — Google Custom Search results, available to the assistant and to other workers that import `searchGoogle` from this module.

## Settings

- **Google credentials** — `GOOGLE_API_KEY`, `GOOGLE_SEARCH_ENGINE_ID`. Edited from the dashboard's Google credentials form (route owned by this worker).

## Operational notes

- `core.news` and `core.research` both call `searchGoogle()` from this worker module rather than wiring the HTTP client themselves. This is the recommended pattern for "shared synchronous capability between workers" until the SDK exposes an explicit `services` contract.
- Disabling this worker breaks news source discovery and personal research. The dashboard surfaces this dependency on the affected worker rows.
