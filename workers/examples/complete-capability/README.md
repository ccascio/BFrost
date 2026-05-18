# News Worker Example

This directory documents the intended anatomy of a BFrost worker using a News-like capability as the concrete example. The current local worker contract is still manifest-only, so `worker.json` is the only file BFrost loads today. The other files in this example show the planned shape for trusted executable workers and installable dashboard views.

## Anatomy

- `worker.json`: identity, health requirements, owned settings, dashboard surfaces, and future entrypoints.
- `backend/module.js`: future trusted backend module that would export the job process, routes, schemas, and dashboard data providers.
- `frontend/dashboard.tsx`: future worker-owned dashboard view shown as a tab named after the worker.
- Configuration fields: should be declared by metadata and rendered centrally in the Config tab.
- Job enablement: belongs to the standard Jobs tab through the persisted job settings record.
- Job process: should be runnable manually and by cron when enabled.
- Dashboard output: should be owned by the worker and shown only if the worker declares a dashboard surface.
- Health checks: should be declared in the manifest and evaluated before operators run the job.

## News-Like Configuration

A real News worker needs search settings and credentials:

- Search queries, date restriction, result limits, and digest limits belong in the central Config tab.
- The job enable flag, cron schedule, model override, and manual run action belong in the standard Jobs tab.
- Google Search credentials should be presented as a worker-owned Config surface, but the manifest must contain only placeholders and ownership metadata.
- Real values belong in local environment keys such as `GOOGLE_API_KEY` and `GOOGLE_SEARCH_ENGINE_ID`.

The example `worker.json` therefore declares a `google-credentials` dashboard setting with `path: "/api/google-credentials"` but does not include any real secret.

## Current Status

This example is intentionally safe: BFrost discovers the manifest and validates `backendEntrypoint`, but it does not execute local worker code yet. Use the built-in workers under `src/workers/builtin/*` and `web/src/workers/builtin/*` as the live reference implementation.
