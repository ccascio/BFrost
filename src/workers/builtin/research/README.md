# `core.research`

Scheduled personal research notes on configured topics. Synthesises Markdown notes with the local model and indexes them in SQLite.

## What it produces

- Persistent Markdown notes on disk under `RESEARCH_STORE_DIR`.
- Recent-notes index in worker-owned SQLite (visible in the Research tab).
- Operational events with `metadata.workerId === 'core.research'`.

Does **not** publish onto the Item Bus today — research notes are end-user artefacts, not work items. If a use case appears for "feed research notes into another worker", expose them through an `itemType: research.note` producer.

## Settings

- **Personal research job** — cron, model, prompt, parameter settings.
- **Research topics** — schema-driven dashboard form. Each topic gets its own cadence.

## Credentials

- `requiredCredentials`: Google Custom Search (shared with `core.news`).

## Operational notes

- Notes are stored in `RESEARCH_STORE_DIR` (defaults under `data/`). Backups must include this directory.
- The dashboard's Research tab is rendered through this worker's `dashboard.tsx` slice — no core changes were needed to add it.
