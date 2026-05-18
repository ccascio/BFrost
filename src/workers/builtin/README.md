# Built-In Workers

Each folder in this directory is a built-in worker boundary.

```text
builtin/
  news/
    manifest.ts
    job.ts
    runs.ts
    source-quality.ts
  publisher-x/
    manifest.ts
    job.ts
  research/
    manifest.ts
    job.ts
  convertprivately/
    manifest.ts
    job.ts
```

The pattern is:

- `manifest.ts` declares worker identity, owned settings, health requirements, dashboard surfaces, jobs, default params, and the job runner hook.
- `job.ts` contains the runtime implementation for that worker's scheduled job.
- `routes.ts` contains worker-owned admin API handlers when the worker has backend settings or actions.
- Extra worker-owned state helpers stay beside the worker, for example News digest runs and source-quality rules.

Each built-in folder exports a `module.ts` object. That object is the backend plug-in shape: manifest, optional API routes, and optional dashboard data hooks. `src/workers/registry.ts` is intentionally small. It aggregates module manifests and builds job lookup indexes for the scheduler, admin API, and dashboard. `src/workers/builtin/api-routes.ts` aggregates worker-owned admin API routes and lets `admin-server.ts` dispatch without knowing every worker-specific handler.

All backend worker modules pass through `src/workers/validation.ts`, which rejects duplicate worker IDs, duplicate job IDs, bad job ownership, invalid default params, missing dashboard defaults, duplicate route method/path pairs, and routes owned by unknown workers.

Shared queue primitives still live in `src/jobs/` because News, X Publisher, and ConvertPrivately all read or mutate that queue. If one worker eventually owns the queue contract fully, move those shared primitives behind that worker's boundary with a compatibility shim.
