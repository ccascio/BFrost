# AGENTS.md

This file provides guidance to Codex when working with code in this repository.

## The contract that defines BFrost

BFrost is a **worker-first local AI operations platform**. The single load-bearing rule is:

> Every capability in BFrost is a worker. The core only knows how to install, configure, schedule, run, observe, and uninstall workers. Removing a worker removes the feature; adding one adds the feature — no core changes required.

When you find yourself wanting to edit a core file to add a feature, **stop and treat it as a contract gap to surface to the user**. Adding a worker is the answer; patching the core almost never is.

Concretely:

- `src/` outside `src/workers/` is core. It must contain **zero** references to specific worker ids, item types, channel names, model providers, or job names. The names `news`, `tweet-post`, `publisher-x`, `research`, `convertprivately`, `telegram`, `openai`, `anthropic`, `lmstudio` should never appear there.
- `web/src/` outside `web/src/workers/` is core. The main `App.tsx`, `styles.css`, and `workers/registry.ts` must not render or reference any specific worker.
- Worker code lives in one of two trees:
  - `src/workers/builtin/<id>/` for the bundled reference workers shipped with the platform.
  - `workers/local/<id>/` (or `./workers/<id>/`) for local contributions, discovered at startup and compiled on load.

A skill at `.claude/skills/bfrost-worker-author/SKILL.md` enforces this when scaffolding new workers — it lists every off-limits core file by name. For Codex, the equivalent skill is also available at `~/.codex/skills/bfrost-worker-author/SKILL.md`.

## Architecture in five concepts

These five abstractions, all defined in `src/workers/`, are what every feature reaches for. Understanding them is the prerequisite for any non-trivial change.

1. **Workers and the registry.** A `WorkerManifest` (`src/workers/types.ts`) declares a worker's id, jobs, tools, channels, providers, settings, dashboard surfaces, and health requirements. Modules ship a `BackendWorkerModule` (`src/workers/module.ts`) that pairs the manifest with `apiRoutes`, `channelAdapters`, `providerAdapters`, and lifecycle hooks. The registry in `src/workers/registry.ts` is the only place the rest of the codebase looks up workers, tools, providers, and channels — never imports a worker directly.

2. **The Item Bus** (`src/jobs/item-bus.ts`) is the shared producer/consumer queue. Producers publish items typed by `itemType` with a JSON `payload`; consumers filter and write outcomes into a namespaced `metadata[consumerWorkerId]` slot. The bus is the only sanctioned cross-worker communication channel. There is no per-worker hard-coded column on the queue table — everything generic lives in `payload`/`metadata`.

3. **Per-worker storage** (`src/workers/storage.ts` and `src/workers/db.ts`). `openWorkerKv(workerId)` gives a namespaced KV under `worker.<id>.<key>`; `openWorkerDb(workerId)` gives namespaced SQLite tables `worker_<safeId>_<table>`. Cross-namespace collisions are impossible.

4. **The local-worker runtime** (`src/workers/loader.ts`, `src/workers/build.ts`, `src/workers/bootstrap.ts`). Local workers can ship TypeScript source; esbuild compiles them on first load (idempotent — skips when cache is newer). Dashboard bundles are produced the same way and served via `GET /api/workers/:id/dashboard.js`. The `bfrost` import is provided by `src/sdk.ts` + `src/sdk-runtime.ts` so local workers see the host's singletons, not a bundled copy.

5. **Provider, channel, and tool abstractions** all live behind their manifest's adapter interface:
   - `ProviderAdapter` (`src/workers/module.ts`) — `getChatModel`, optional `listAvailableModels`, optional local-runtime lifecycle. Cloud providers leave runtime methods undefined.
   - `ChannelAdapter` — `isConfigured`, `start`, `stop`, optional `notifyOperator`.
   - Tools register through `listRegisteredTools()`; `src/agent.ts` builds the assistant tool catalog dynamically from the registry, so adding a tool worker requires zero changes to the agent.

`src/llm.ts` dispatches *every* model resolution through `getProviderAdapter(model.provider)`. There is no hard-coded provider branch.

## Commands

- `npm run build` — compile backend (`tsc`) and frontend (`vite build`).
- `npm run build:server` / `npm run build:web` — compile one side only. Use the server build when you only touched backend code; the test runner does this for you.
- `npm test` — `rm -rf dist && tsc && node --test "dist/**/*.test.js"`. There is no Jest. Run a single test file with `node --test dist/path/to/file.test.js` after a `tsc` build; pass `--test-name-pattern="<regex>"` to filter cases.
- `npm start` — runs `node dist/index.js`. Boots channels, providers, scheduler, and admin server (default `http://127.0.0.1:3030`).
- `npm run dev` — runs unit tests then starts backend + Vite dashboard together.
- `npm run dev:watch` / `npm run dev:web` — backend `tsc --watch` / frontend Vite dev mode in isolation.
- `npm run task -- --job <id>` — execute a named job manually (e.g. `news-digest`, `personal-research`).

There is **no ESLint config**. Don't try `npm run lint`. Typecheck via `tsc` is the only static gate.

## Conventions specific to this codebase

- **Adding to a manifest schema requires updating the Zod schema in `src/admin-api.ts` and the matching test fixtures in `src/admin-api.test.ts`.** Both will fail loudly if you forget.
- **The shared Bus schema (`RawQueueItemSchema` in `src/jobs/queue.ts`) is intentionally generic.** Do not add worker-specific columns. Producer payloads go in `payload`; consumer outcomes go in `metadata[consumerWorkerId]`.
- **`displayName` and `tagline` on a manifest are the user-facing strings.** Plain `name`/`description` stay as the short technical labels used in logs. UI surfaces prefer the user-facing fields with a fallback.
- **Dashboard payload is sliced per worker.** `dashboard.workerData[workerId]` is the only sanctioned slot for worker-specific state the frontend reads — no new top-level fields on the dashboard response.
- **Worker dashboards register through `useSyncExternalStore`-backed view registry** so runtime registrations rerender the host. Local worker bundles wire `react` / `react-dom` / `react/jsx-runtime` to `window.bfrost.*` — they share the host's React.
- **CJS cycle workaround in `llm.ts`.** The registry lookup is lazy-required to break a `registry → builtin/workers → publisher-x/job → llm` cycle. If you touch `llm.ts` and TypeScript starts complaining about provider types, this is why.
- **Backups stored as durable run artefacts.** `data/` holds local state, run artefacts, queue, events. Don't write to `data/` from worker code — go through `openWorkerKv` / `openWorkerDb`.

## Two roadmaps, two scopes

- [`ROADMAP.md`](./ROADMAP.md) — the technical platform punch list to `v1.0.0`. Workstreams 1–4 are done; the remaining gates are the permissioned action runtime, frontend smoke tests, per-worker metrics, accessibility, and the docs site.
- [`LOWCODE_ROADMAP.md`](./LOWCODE_ROADMAP.md) — the parallel track making BFrost usable by non-developers (installer, wizard, guided channel flows, worker catalog, recipe presets, backups). Several items are already shipped; pick from the unchecked items when the user asks for a low-code chunk.

If a change blurs the line between "platform" and "low-code," the platform contract wins — i.e. don't compromise the worker-first contract for a UX shortcut.

## What the README will tell you that this file won't repeat

Setup, public-preview status notes, the list of bundled workers, where state lives on disk, and the worker-authoring entry point are in [`README.md`](./README.md). Author-skill workflow is in `.claude/skills/bfrost-worker-author/SKILL.md`, with the Codex copy at `~/.codex/skills/bfrost-worker-author/SKILL.md` — read it before scaffolding a new worker.
