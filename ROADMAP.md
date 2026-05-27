# BFrost Roadmap

## Objective

Publish BFrost on GitHub as a **worker-first local AI operations platform** that a sizeable community of contributors can extend without touching the core.

The product promise the README and this roadmap must be able to defend:

> Every capability in BFrost is a worker. The core only knows how to install, configure, schedule, run, observe, and uninstall workers. Removing a worker removes the feature; adding one adds the feature — no core changes required.

Today the project is close, but not yet honest about that promise: several capabilities began as hard-coded features and were retrofitted as workers. This roadmap is the punch list to close that gap and reach a state where BFrost is worth a public launch.

For the historical roadmap (Phases 1–6 of the personal project, channel adapter extraction, the original worker migration) see `WORKER_JOBS_ROADMAP.md`. That document describes what was built. This document describes what is still missing.

---

## Guiding Principles

1. **No worker names in core.** `src/` outside `src/workers/` must never reference `news`, `tweet-post`, `publisher-x`, `research`, `convertprivately`, `telegram`, etc. The core ships with zero domain knowledge.
2. **Workers are self-sufficient.** A worker owns its manifest, jobs, tools, channels, routes, settings, storage, dashboard surfaces, health checks, and tests. Disable it and nothing in core breaks.
3. **Configuration lives in manifests.** Behaviour that varies between workers (prompts, fields, cron defaults, credentials, dependencies, queue shape extensions) is declared, not coded.
4. **Local-first, permissioned.** No code is loaded from the internet by default. Local workers declare permissions; the runtime enforces them.
5. **The built-in workers are reference examples.** They prove the contract is expressive enough; they must not be load-bearing for any core abstraction.

---

## Current Hard-Coded Coupling (Inventory)

These are the concrete points where core still knows about specific workers. Each is a blocker for the GitHub launch.

### Backend

- `src/admin-config.ts:11` re-exports `DEFAULT_TWEET_POST_PROMPT` from the X publisher worker. Core should not import worker internals.
- `src/workers/builtin/dashboard-data.ts` enumerates `news` and `research` `kind` discriminators and merges their data shapes into a single response. The aggregator should be content-agnostic.
- `src/workers/builtin/api-routes.ts` imports `googleSearchApiRoutes` as a top-level cross-cutting concern. Web search belongs to a worker, not to the registry's wiring file.
- `src/admin-server.ts` exposes worker-specific fields on the dashboard payload (`recentRuns` from news, `research.settings`, `research.notes`, event filter `category === 'research'`). The dashboard payload should be generic: each worker contributes its own slice keyed by worker id.
- `src/tools/` (`memory.ts`, `web-search.ts`, `article-fetch.ts`) live outside the worker tree. Assistant tools are not yet a worker type — they should be.
- `src/bot.ts` and `src/index.ts` instantiate Telegram directly. Channels are not yet a worker type — they should be.
- `src/jobs/queue.ts` has worker-specific columns (`tweetId`, `convertPrivatelyUrl`, news source/article provenance) on the shared queue. The queue should expose a generic per-item metadata bag workers can read/write under their namespace.
- `src/llm.ts` / `src/lmstudio.ts` assume LM Studio. Model providers are not yet a worker type.
- `src/workers/local.ts` discovers manifests but does not load executable worker code. Local workers cannot ship behaviour yet.

### Frontend

- `web/src/App.tsx` (≈2.5k lines) renders `tweetId`, `convertPrivatelyUrl`, and other worker-specific queue fields directly.
- `web/src/workers/types.ts` hard-codes `WorkerDashboardViewKind = 'queue' | 'research' | 'custom'`. The view-kind union should be open or removed.
- `web/src/workers/registry.ts` uses a build-time `import.meta.glob` over `./builtin/*/dashboard.{ts,tsx}`. Local workers cannot ship a UI bundle at all.
- Several App-level surfaces (Queue tab, Overview composition) still assume the news/X workflow rather than reading what enabled workers declare.

### Tests & Docs

- No scheduler integration test using a fake worker (Phase 6 leftover).
- No frontend smoke test for schema-rendered job forms.
- No public-facing docs site or per-worker documentation generated from manifests.
- `README.md` describes built-in workflows as primary capabilities rather than as examples of what workers do.

---

## Workstreams

The remaining work splits into seven workstreams. They are roughly parallel; only Workstream 1 must land before a launch can credibly be called "worker-first."

### Workstream 1 — Decouple Core From Built-In Worker Names

**Goal:** delete every hard-coded worker reference outside `src/workers/` and `web/src/workers/`.

- [x] Remove the `DEFAULT_TWEET_POST_PROMPT` re-export from `src/admin-config.ts`; consumers resolve the default through the manifest.
- [x] Replace `src/workers/builtin/dashboard-data.ts` with a generic aggregator: each worker module returns an opaque slice keyed by its worker id.
- [x] Move `google-search-routes.ts` registration into the news worker module's `apiRoutes` (still declares both news and research as owners). The `api-routes.ts` aggregator no longer has any special-case import.
- [x] Add a generic `workerData: Record<workerId, unknown>` slot on the dashboard payload so workers ship arbitrary state to the frontend without core knowing the shape. (Legacy `queue.recentRuns`, `sourceRules`, `research` keys remain populated for now to avoid breaking the existing React UI; they are scheduled for removal once the dashboard reads from `workerData` exclusively — see Workstream 3 and the follow-up below.)
- [x] Replace worker-name-based event filtering (`event.category === 'research'`) in `admin-server.ts` with `event.metadata.workerId === 'core.research'` — events already carry that field.
- [x] Widen `WorkerDashboardViewKind` from a closed `'queue' | 'research' | 'custom'` union to `string` so frontend workers can declare any view kind.
- [x] **Follow-up (closed):** every legacy worker-specific queue field is gone from `web/src/App.tsx` (`tweetId`, `tone`, `convertPrivatelyUrl`, `sourceHost`, `sourceScore`, `sourceLabel`, `sourceReasons`, `articleFetched`, `articleTitle`, `articleDescription`, `articleExcerpt`, `articleFinalUrl`, `digestRunId`). Worker dashboards (news, publisher-x, convertprivately) read producer fields through `web/src/workers/builtin/news/payload.ts` and consumer fields through their own `metadata[workerId]` namespace. News owns its `selectedRun`/`selectedRunItems` derivation; `sourceScoreLabel` and the news-specific items in `workerViewContext` are deleted. `dashboard.research` and `dashboard.sourceRules` are gone from top-level — research reads via `workerData['core.research']`, source rules via `workerData['core.news'].sourceRules` (consumed by the schema-driven form via `seedPath`). `renderSourceRulesEditor`, `sourceRulesDraft`, `saveSourceRules`, and the `SourceRulesDraft` type are all deleted; the form lives entirely in the news manifest now.

**Exit criteria:** `grep -ri "news\|tweet\|publisher\|convertprivately\|research\|telegram" src web --exclude-dir=workers` returns only generic/incidental hits (e.g. the word "research" in a comment, the Telegram adapter inside its worker folder).

**Status (this session):** the backend is clean — `src/` outside `src/workers/` no longer imports worker internals or names worker ids except where listed in the follow-up above. The frontend still renders two worker-specific queue fields directly; that is the remaining hold-out and tracks with the Item Bus refactor.

### Workstream 2 — Worker Types: Tools, Channels, Providers

Three capability classes are still in `src/` rather than under a worker. Each becomes a new worker type with a manifest schema, a registry, and migration of the existing implementation into a built-in worker.

- [x] **Assistant tools** (`WorkerToolManifest`): dedicated worker category for LLM-callable tools. Each tool declares `id`, `workerId`, `name`, `description`, `inputSchema`, `permissions`, `defaultEnabled`, and `execute`. Registry exposes `listRegisteredTools` / `getRegisteredTool`. Migrated:
  - `src/memory.ts` and `src/tools/memory.ts` → `core.memory` worker (`saveMemory`, `recallMemory` tools).
  - `src/tools/web-search.ts` → `core.search.google` worker (`webSearch` tool, also owns `/api/google-credentials` and the Google credentials manifest entry).
  - `src/tools/article-fetch.ts` → `core.article-fetch` worker (`fetchArticle` tool).
  - News, research, and ConvertPrivately workers import `searchGoogle` / `fetchArticle` from the new worker module paths.
  - `src/agent.ts` builds the tool catalog dynamically from `listRegisteredTools()`; the closed `webSearchTool` / `saveMemoryTool` / `recallMemoryTool` imports are gone.
  - `src/tools/` and `src/memory.ts` deleted.
  - Tools are explicitly *not* a generic "every worker function callable by every worker/agent" surface. Async worker-to-worker comms goes through the Item Bus; synchronous worker-to-worker function calls (a dedicated `services` contract) are deferred until a real use case appears.
- [x] **Channel adapters** (`WorkerChannelManifest`): capability flags (text/image/audio/files/markdown/buttons), `isConfigured` / `start` / `stop` lifecycle, optional `notifyOperator` for proactive delivery. Telegram migrated to `core.channels.telegram`. `src/index.ts` boots channels from the registry; `src/bot.ts` deleted. `src/cron.ts` uses `notifyOperatorChannels` instead of importing `telegraf` directly. Dashboard chat adapter migration deferred to a follow-up since it does not require a runtime owner the way Telegram does.
- [x] **Model providers** (`WorkerProviderManifest`): chat/embeddings/vision/local-runtime capability flags plus a `ProviderAdapter` interface with `getChatModel` and optional `startRuntime` / `stopRuntime` / `getRuntimeStatus` / `listLoadedModels` / `loadModel` / `unloadModel` / `unloadAllModels`. LM Studio migrated to `core.providers.lmstudio`; `src/lmstudio.ts` deleted; `src/llm.ts` dispatches the local branch through `getActiveLocalProvider()`; `index.ts`, `job-runner.ts`, and `admin-server.ts` all go through the registry. Adapter instances are cached per provider id so the LM Studio server keeps coherent state.
- [x] `/api/telegram-settings` route + body schema moved into `core.channels.telegram` worker (`apiRoutes`). `TelegramSettingsBodySchema` removed from `admin-api.ts`; the route handler is gone from `admin-server.ts`. `src/x.ts` (Twitter HTTP client) moved into the `core.publisher.x` worker as `x-client.ts`.
- [ ] **Channel follow-ups (still pending):** `setTelegramSettings` / `telegramBotToken` in `src/config.ts` and `telegramConfigured` in `src/health.ts` remain because they need per-worker secrets/env access — that's a Workstream 4 dependency.

**Exit criteria:** Disabling `core.channels.telegram` cleanly stops Telegram without breaking the rest of the app. Disabling `core.providers.lmstudio` surfaces a "no provider available" health failure but does not crash core.

### Workstream 3 — Shared Item Bus And Worker Storage

The publishing queue is currently a core table with worker-specific columns. It is also a **producer/consumer interface between workers**: News produces items, X Publisher and ConvertPrivately consume them. That cross-worker contract must stay, but the implementation must move out of worker internals.

**Decision (locked in):** The queue becomes a generic **Item Bus** owned by core (or by a thin `core.items` worker shipped with the platform). Any worker can produce items into it; any worker can subscribe to items by type/tag and consume them. News, X Publisher, and ConvertPrivately become independent producers/consumers of the same bus.

- [x] Per-worker storage API: namespaced KV store (`openWorkerKv` → `worker.<id>.<key>`) **and** namespaced SQLite-table API (`openWorkerDb` → `worker_<safeId>_<table>`). Tables come with structured CRUD (`insert`, `upsert`, `update`, `delete`, `findOne`, `findAll`, `count`) and a `raw()` escape hatch with `${table}` substitution scoped to the worker's own tables. `defineTable` is idempotent and migrates via `ALTER TABLE ADD COLUMN`. Eight unit tests in `src/workers/db.test.ts` cover roundtrip, isolation, migration, identifier validation, and upsert semantics.
- [x] Design the Item Bus contract (`src/jobs/item-bus.ts`):
  - `Item { id, producerWorkerId, itemType, tags[], payload (JSON), state, stateReason, metadata (JSON namespaced by consumerWorkerId), ... }`
  - producer API: `publishItem({ producerWorkerId, itemType, tags?, title, shortDesc, url, payload? })`
  - consumer API: `listItemsForConsumer(consumerId, { itemType?, tags?, states?, excludeAlreadyHandled? })`, `applyConsumerSuccess`, `applyConsumerFailure`, `setConsumerMetadata`, `readConsumerMetadata`.
- [x] QueueItem schema extended additively with `producerWorkerId`, `itemType`, `tags`, `payload`, and `metadata` (consumer-namespaced). Legacy worker-specific columns retained during the migration window.
- [x] News worker now stamps every produced item with the producer triple and writes source/article provenance into `payload` in addition to the legacy fields.
- [x] X Publisher reads `core.convertprivately` consumer metadata for the article URL (falling back to the legacy field) and writes its own metadata under `core.publisher.x` on success.
- [x] ConvertPrivately reads its own consumer metadata to skip already-handled items and writes `publishedUrl` / `publishedSlug` / `publishedAt` under `core.convertprivately` on success.
- [x] Six unit tests cover publish, filter, namespace isolation, success, failure, and load/save roundtrip.
- [x] Documented in `workers/README.md` — producer pattern, consumer pattern, metadata namespacing rules.
- [x] **Item Bus v2 — done:**
  - `src/jobs/near-duplicates.ts` moved into the news worker (`workers/builtin/news/near-duplicates.ts`); publisher-x imports `canonicalizeUrl` from the news worker's namespace.
  - Legacy worker-specific queue columns removed from `RawQueueItemSchema`: `tweetId`, `tone`, `convertPrivatelyUrl`, `sourceHost`, `sourceScore`, `sourceLabel`, `sourceReasons`, `articleFetched`, `articleTitle`, `articleDescription`, `articleExcerpt`, `articleFinalUrl`, `digestRunId`. The schema is purely Item Bus: `producerWorkerId`, `itemType`, `tags`, `payload`, `metadata`.
  - `markQueueItemPosted(item, reason, now)` is now generic — no `tweetId`/`tone` arguments. Publisher-x writes its identifiers into `metadata['core.publisher.x']`.
  - News producer encodes everything (source assessment, article extraction, digest run id) into `payload`. Consumers (publisher-x, convertprivately) read producer fields through a `newsPayloadFields(item)` helper.
  - `queue-service` no longer hardcodes `[core.news, core.publisher.x, core.convertprivately]` in dashboard event metadata — attribution is derived dynamically from the item's `producerWorkerId` plus any consumers that have written into `metadata`.
  - Frontend Queue detail panel renders through worker-provided `queueItemDetail` renderers (`web/src/workers/types.ts` + `workerQueueItemDetails` in `registry.ts`). News exposes a source/article provenance renderer; publisher-x renders tweet id / tone / link from `metadata['core.publisher.x']`; convertprivately renders article title / slug / link from `metadata['core.convertprivately']`. App.tsx no longer reads `tweetId`, `convertPrivatelyUrl`, `sourceHost`, etc. directly.
  - Per-worker namespaced KV storage API: `openWorkerKv(workerId)` in `src/workers/storage.ts`. Keys are prefixed `worker.<id>.<key>` on the shared SQLite KV; cross-namespace collisions are impossible and per-worker state survives backups untouched. Four unit tests cover roundtrip, namespace isolation, clear, and validation.
- [ ] **Still deferred:** multi-consumer fan-out (multiple consumers completing on the same item without contention). The shared queue still has a single terminal state; consumers agree by convention. Will surface when a real fan-out use case appears.

**Exit criteria:** Adding a new "publish to Mastodon" worker requires only declaring a consumer subscription on `news.article` and shipping a publisher routine. Adding a new "publish to BlueSky" producer (e.g. promoting popular bookmarks) requires no change to existing publisher workers. No core SQL migration, no core React change.

**Status (this session):** Item Bus v1 contract is in place and runtime-tested. Built-in producers and consumers communicate through the new API while still co-writing legacy fields, so the dashboard and existing tests continue to work unchanged. The follow-up list above is the path to removing the legacy fields and the news-specific helpers from `src/jobs/`.

### Workstream 4 — Local Worker Execution Runtime

Today local workers are manifest-only. To be a real platform BFrost must safely execute local worker code.

- [x] `backendEntrypoint` loading: `src/workers/loader.ts` requires the compiled JS, validates exports against `BackendWorkerModule`, refuses manifest-id mismatches, and surfaces failures as typed `WorkerLoadError`.
- [x] **TypeScript source on upload (esbuild compile-on-load).** `src/workers/build.ts` bundles `backendSource` (a `.ts`/`.tsx`/`.mts`/`.cts` file) into the declared `backendEntrypoint` using esbuild (node target, CJS, inline source maps, `bfrost` + `node:*` external). The compile step is idempotent: it skips when the cached output is newer than the source.
- [x] Local manifest schema gained `language: 'javascript' | 'typescript'` and `backendSource`; both paths share the same relative-path containment check.
- [x] Worker lifecycle hooks defined on `BackendWorkerModule.lifecycle`: `onInstall` / `onEnable` / `onDisable` / `onUninstall`, each receiving `{ workerId, workerDir }`. The bootstrap path invokes `onEnable` automatically when a local worker loads at startup.
- [x] Boot orchestration: `src/workers/bootstrap.ts` discovers local workers, skips disabled and manifest-only ones, compiles TS workers as needed, requires their entrypoints, and registers them through `registerLoadedLocalModule`. Failures are collected as `workerIssues` rather than crashing startup. `src/index.ts` calls it once before channels/providers come up.
- [x] Registry made dynamic: `registerLoadedLocalModule` / `unregisterLocalWorkerModule` mutate the index, and `listWorkers()` returns built-in + local manifests together. Provider adapter instance cache is flushed on every registration change.
- [x] End-to-end test (`src/workers/loader.test.ts`): writes a real TS worker to a tmp dir, runs the compile pipeline, loads it through the registry, executes one of its tools, and confirms manifest-id mismatch detection.
- [x] Contributor documentation in `workers/README.md` covering compiled-JS layout, TypeScript layout, lifecycle hooks, and the local-trust model.
- [ ] Sandbox / permission model: each worker declares filesystem, network domain, shell, and credential scopes; the runtime exposes only the matching APIs. Start with deny-by-default and a clear approval log.
- [x] Frontend worker bundles: local workers can declare `dashboardSource` (TS/TSX) or `dashboardEntrypoint` (compiled IIFE). BFrost bundles the source on demand (esbuild, browser target, IIFE, `react` / `react-dom` / `react/jsx-runtime` rewired to `window.bfrost.*` so the host's React owns hooks). The bundle is served from `GET /api/workers/:id/dashboard.js` with mtime-based ETag + `Cache-Control: no-cache`. The frontend exposes React + helpers via `window.bfrost` (set in `main.tsx`), and `loadRuntimeWorkerBundle()` injects a `<script>` after the dashboard shell arrives. The view registry is now a `useSyncExternalStore`-backed list so runtime registrations rerender the host. `WorkerDashboardViewKind` was already widened to `string` in W1, so no closed union remains. Example worker at `workers/examples/dashboard-view/`; unit test in `src/workers/build-dashboard.test.ts`.
- [x] Worker lifecycle hooks: `onInstall`, `onEnable`, `onDisable`, `onUninstall`, **`onMigrate(fromVersion, toVersion)`**. The bootstrap compares the loaded manifest version against the version we last successfully enabled (`WorkerStateRecord.installedVersion`); if it differs, `onMigrate({ fromVersion, toVersion, workerId, workerDir })` runs before `onEnable`. The recorded version is only persisted after enable succeeds, so a failing migration retries on the next boot rather than silently advancing.
- [x] Worker SDK runtime: local worker TypeScript code can `import { openWorkerKv, openWorkerDb, publishItem, listItemsForConsumer, applyConsumerSuccess, applyConsumerFailure, setConsumerMetadata, readConsumerMetadata, recordEventSafe } from 'bfrost'` — plus all the manifest/lifecycle/adapter types. The public surface lives in `src/sdk.ts`; `src/sdk-runtime.ts` registers a synthetic `bfrost` module via Node's `Module._resolveFilename` hook so the import resolves to the host's singletons rather than a bundled copy. Two unit tests cover identity and idempotency.
- [x] Schema-driven manifest surfaces support **seed from runtime state**: every `dashboard.settings[].fields[]` entry can declare `seedPath: 'core.<worker>.<...>'` pointing into `workerData`. The dashboard's `buildSurfaceDraft` resolves the path and uses the live value as the initial draft; `defaultValue` is the fallback when the path doesn't resolve. The news `source-quality-rules` surface is now fully schema-driven — the bespoke editor, `sourceRulesDraft` state, `saveSourceRules` mutation, and the `dashboard.sourceRules` top-level field are all gone. `App.tsx` no longer contains any source-quality-rules code; the form lives entirely in the news manifest.

**Exit criteria:** The `workers/examples/simple-job` example can be installed, executed, and uninstalled with no source changes anywhere in `src/`.

### Workstream 5 — Permissioned Action Runtime

Original `ROADMAP.md` Phase 4. Required before workers can responsibly do real-world actions.

- [ ] Define `ActionRequest`, `ActionApproval`, `ActionResult` types.
- [ ] Add an approval queue table and a dashboard review surface (rendered through the worker UI registry).
- [ ] Action classes: `read-only`, `draft`, `approved-write`, `trusted-automation`, `blocked`.
- [ ] Per-worker / per-channel / per-agent permission scopes; filesystem, command, network-domain, credential allowlists.
- [ ] Audit every proposed and executed action with `workerId`, `actor`, `inputs`, `outputs`, `approvalState`, `timestamp`.
- [ ] Built-in safe primitives workers can compose: file read in allowed paths, file draft (patch preview), shell-with-allowlist, Playwright session for inspect/extract.

**Exit criteria:** A worker can request a file write, the user sees and approves a diff in the dashboard, the action runs, and the result is in the audit log.

### Workstream 6 — Quality, Tests, And Polish

- [x] Scheduler integration test using a fake worker job (`src/scheduler.test.ts`): registers a local fake worker, triggers it manually via `triggerJobNow`, polls the run record, and asserts the scheduler snapshot reflects both success and failure paths.
- [ ] Frontend smoke test for the schema-rendered job form (still pending).
- [x] CI: typecheck, backend tests (Node 20 + 22 matrix), frontend build, manifest validation across `workers/examples/*` on every PR. (Lint skipped: no ESLint config exists yet — add as a separate item.)
- [x] Manifest version migration tests: `src/workers/bootstrap.test.ts` covers `onMigrate` on first boot (fromVersion=null), version-unchanged skip, version-bump call, and failure-leaves-installedVersion-unchanged retry semantics. `src/admin-config.test.ts` covers job params preservation from older schemas with new-field defaults filled in. Two bugs fixed: `setWorkerInstalledVersion` now upserts on first boot (previously silently no-op'd); `bootstrap.ts` now only advances `installedVersion` when `onMigrate` succeeds (previously always advanced it).
- [x] Per-worker metrics surfaced in Health: success rate, p50/p95 run duration, last failure reason. _(Done 2026-05-27 — new "Health" sidebar tab with summary cards, per-worker grouped collapsible panels, SVG sparklines over last 20 runs, success-rate fill bars, p50/p95 duration chips, last-failure excerpt. Backend: `GET /api/dashboard/job-metrics` computes from `listSchedulerRuns(200)` + scheduler job map; `JobMetricsResponseSchema` / `WorkerRunMetricsSchema` / `JobRunMetricsSchema` added to `admin-api.ts` with matching test fixtures.)_
- [ ] Backups + restore: implement the guarded SQLite restore/import tooling promised in the older roadmap; worker-owned tables included automatically.
- [x] Accessibility pass on the dashboard (keyboard navigation, focus management, contrast). Public projects get judged on this. _(Done 2026-05-26 — global `:focus-visible` ring + `.sr-only` utility, Wizard focus trap + Escape + `aria-live` + complete ARIA tab pattern, `actions-item` body extracted to `<button>`, `btn-icon` buttons upgraded from `title=` to `aria-label=`, schedule-preview panel `autoFocus` on mount, splash `aria-busy`)_

### Workstream 7 — Community And Publication Readiness

- [x] Add a `LICENSE` file (MIT).
- [x] `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1).
- [x] `SECURITY.md` with a private disclosure path and a brief threat-model note.
- [x] `CONTRIBUTING.md` expanded: full dev loop, test expectations table, worker authoring tutorial with scaffold guide and Claude Code skill instructions. _(Done 2026-05-24)_
- [x] Issue and PR templates: `bug_report`, `feature_request`, `worker_proposal`, `plugin_bug`, `plugin_idea` + `PULL_REQUEST_TEMPLATE.md` with worker-first checklist.
- [x] README rewritten with a worker-first lede — platform story first, bundled workers as examples. _(Done 2026-05-24)_
- [x] Versioning policy: semver for core, declared `bfrostApiVersion` enforced on worker load.
- [x] First tagged release — `v0.2.0` reflecting Workstreams 1–4 complete. _(Done 2026-05-24 — git tag `v0.2.0` created)_
- [ ] A short docs site (Astro/VitePress) generated from `workers/README.md`, manifest type docstrings, and per-worker READMEs. Hosted on GitHub Pages.
- [ ] A scripted demo (asciinema or short video) showing: install a local worker, enable it, configure it, run it, see results, disable it, delete it.
- [ ] A "Worker Gallery" page in the dashboard listing built-in workers as installable examples — community workers can be linked from a curated `awesome-bfrost` repo later.

---

## Suggested Sequencing

A realistic order if working through this alone:

1. **Workstream 1** end-to-end. This is the smallest, most impactful change and unblocks honest framing.
2. **Workstream 3 first slice** (generic queue metadata) — needed before Workstream 2's publisher channels make sense.
3. **Workstream 2 — tools**, then **channels**, then **providers** (in that order; tools touch the least surface).
4. **Workstream 4** (local code execution) — the moment this lands, BFrost is a real platform.
5. **Workstream 5** (action runtime) — required before encouraging worker authors to do anything destructive.
6. **Workstreams 6 and 7** in parallel with the above; finalize before tagging `v1.0.0`.

---

## Wish List (Low Priority)

These are not blockers for v1.0 but are nice additions once the platform is published.

- **`core.providers.ollama` worker.** Mirror the LM Studio provider worker so users with Ollama installed get the same `start runtime / load model / unload model / serve chat` surface without configuration tricks. Should slot into the existing provider registry without core changes — the contract is already in place.
- **`core.providers.openai` / `core.providers.anthropic` workers.** Today `src/llm.ts` still hard-codes the cloud branches. They could move behind provider workers too so the dispatcher in `llm.ts` is a single line ("ask the registry").
- **`core.channels.dashboard` worker.** The dashboard chat path currently lives in core. It is a thin wrapper around the channel dispatcher and would migrate easily once we want full channel-worker parity.
- **`core.transcribe.whisper` worker.** Voice transcription is currently a direct dependency in `src/transcribe.ts`; making it a worker would let community contributors swap in cloud transcription (Deepgram, OpenAI Whisper API, etc.) the same way Ollama would swap in for LM Studio.

## Out Of Scope For The First Public Release

- Loading workers from arbitrary remote URLs.
- A hosted worker marketplace.
- Multi-user / multi-tenant deployment.
- Cloud-managed BFrost.
- A sandbox for workers authored by anonymous third parties.

These can become roadmap items once the local platform has a community and a maintainership model.

---

## Open Questions (Decide Before Tagging v1.0.0)

- Per-worker SQLite databases vs. namespaced tables in the shared DB? (Leaning: namespaced tables; simpler backups.)
- Permission model strictness on first release: deny-by-default with prompts, or read-only-by-default with explicit opt-in per scope?
- How aggressively to deprecate built-in worker-specific dashboard payload keys — break compatibility in `v0.x` or carry both shapes through `v1.0`?
- Item Bus subscription semantics: push (the bus calls into consumers) or pull (consumers poll the bus on their cron)? Pull is simpler and matches the current scheduler; push enables real-time consumers later.

## Resolved Decisions

- **License:** MIT (matches OpenClaw).
- **Queue / item bus:** generic Item Bus owned by core; News, X Publisher, ConvertPrivately become independent producers and consumers on the same bus.
- **Worker uploads:** accept both compiled JS and TypeScript source. TS is compiled in-process at install time with esbuild and never executed as TS at runtime.
