# BFrost Code Roadmap — Simplification & Reliability

> Companion to [`ROADMAP.md`](./ROADMAP.md) (the product / "wow" roadmap) and [`UX_ROADMAP.md`](./UX_ROADMAP.md). This document is strictly about the **engine**: making the code smaller, harder to break, and more faithful to the one law that defines BFrost. Nothing here changes user-visible behaviour by itself — but almost every "wow" item in the other two roadmaps is currently gated by a structural problem listed below.

## The lens: the worker-first contract is the metric

BFrost has exactly one load-bearing rule (see [`CLAUDE.md`](./CLAUDE.md)): *every capability is a worker; the core only installs, configures, schedules, runs, observes, and uninstalls them.* So the question for every refactor in this document is not "is this cleaner?" but **"does this make `src/` (outside `src/workers/`) more worker-agnostic, or less?"** A change that shrinks a file but leaves core owning worker-shaped logic is a half-fix. Each item below is framed as contract-reinforcing.

This roadmap began with two pressure points. As of **2026-06-19**, **Phase 1 is complete**: the backend HTTP monolith is dissolved, the frontend shell/helper pressure points are below the ~600 LOC threshold, and the design-token layer exit criterion is already met. **Phase 2 is complete**: process-level crash/rejection handling, scheduled-job retry/backoff, and raw HTTP body hardening are in place. **Phase 3.1 and 3.2 are also complete**: the worker-first contract is now machine-enforced across production core files, the main provider/channel/config leaks have been moved behind generic or worker-owned contracts, and fragile double-unknown casts are removed from production code. The next meaningful work is Phase 4 testing/observability.

| File | Original LOC | Current LOC | Status |
|---|---:|---:|---|
| `src/admin-server.ts` | 2,365 | 164 | **Done**: thin HTTP shell; core and worker routes share `HttpRouter`. |
| `src/admin-routes.ts` | 967 after first split | 18 | **Done**: aggregator over domain route modules. |
| `web/src/App.tsx` | 7,076 | 594 | **Done**: core shell delegates data, overview, chat, store, operations, routes, queue/detail, auth, and special-mode banners to focused modules. |
| `web/src/app-types.ts` | 677 after extraction | 593 | **Done**: compatibility barrel; store permission/schema types moved to `web/src/app-types/store.ts`. |
| `web/src/app-helpers.tsx` | 1,008 after extraction | 10 | **Done**: compatibility barrel over focused helper modules; largest helper module is 206 LOC. |
| `web/src/Wizard.tsx` | 1,197 | 235 | **Done**: shell split from step modules; provider-specific assumptions moved behind worker/provider contracts in Phase 3.1. |

Everything else is comparatively healthy. This roadmap deliberately does **not** invent rot that isn't there — Phase 1 and Phase 3.1 are done, and the remaining work is a small set of real reliability gaps plus typed-adapter and observability hardening.

---

## Phase 1 — Dissolve the monoliths (the contract-reinforcing refactors)

### 1.1 Replace `handleRequest` with a declarative route table that workers register into
**Problem.** `src/admin-server.ts:235-1106` is a manual raw-`http` dispatcher: every route is an `if` arm matching `url.pathname` + `req.method` by hand. Adding any endpoint means editing the core dispatcher. Worker `apiRoutes` (already a first-class concept in `src/workers/module.ts`) are spliced into this same imperative wall, so the place core code and worker code mix is also the least testable code in the repo.

**Fix.** Introduce a tiny internal router (`Map<method, Array<{ pattern, handler }>>`, path params via `URLPattern`) in a new `src/http/router.ts`. Core endpoints register declaratively; **worker `apiRoutes` register through the exact same API**. `handleRequest` becomes: parse → auth gate → `router.dispatch`. No framework dependency required (or adopt a micro-router if a dep is acceptable).

**Why it reinforces the contract.** Core stops *knowing* routes; it owns a mechanism, and capabilities (core or worker) contribute routes uniformly — the worker-first model applied to HTTP. Each handler becomes independently unit-testable.

**Exit criterion.** `admin-server.ts` < 600 LOC; the route list is data; a worker can add an endpoint with zero edits to `admin-server.ts`; a test asserts core registers no route naming a specific worker id.

**Status — DONE (2026-06-18).** `admin-server.ts` went 2,342 → **164 LOC** (thin shell: lifecycle + `handleRequest` = auth middleware → router dispatch → static/404 + the static server). Core routes are split by domain and worker `apiRoutes` flow through the same `HttpRouter`:
- `src/http/router.ts` (104) — the `HttpRouter` mechanism + 9 unit tests.
- `src/http/responses.ts` (63) — `sendJson` / `readJsonBody` / body limits.
- `src/admin-routes.ts` (18) — domain-route aggregator.
- `src/http/routes/*` (923 LOC total; largest module 201 LOC) — declarative core route modules.
- `src/admin-dashboard-state.ts` (672) — `buildDashboardState` + section builders + worker health.
- `src/admin-worker-ops.ts` (701) — catalog / upload / describe-scaffold / store install / dashboard-bundle / archive-safety.
- `src/admin-auth.ts` (243) — single-owner `sessions` Map + cookie/password helpers (kept cohesive; consumed by `handleRequest` and the core-settings route).

Verified: `npm run build:server && node --test dist/worker-first-contract.test.js` clean on 2026-06-18, plus full `npm test` clean (203 backend tests + frontend typecheck), route collision tests, and the recursive worker-first production-core scan. Remaining backend monolith work is no longer Phase 1.1; reliability and observability follow-ups belong under Phase 2 / Phase 4.

### 1.2 Split `App.tsx` into a core shell + per-tab feature modules
**Problem.** `web/src/App.tsx:681` is the entire app in one function: every tab (`overview`, `channels`, `workers`, `jobs`, `config`, `chat`, `system`, `store`, `actions`, `health`, `pipeline`) renders from the same 105-hook component. Any tab re-renders on any state change; the frontend has **no typecheck gate** (vite build skips `web/src`, see memory `frontend-has-no-typecheck-gate`) so this size is unguarded.

**Fix.** Carve each `CoreDashboardTab` into `web/src/tabs/<Tab>.tsx` with its own data hooks and local state. `App.tsx` keeps only: shell, tab routing, auth/session, and the cross-cutting toast/error surface. Shared types move to `web/src/types.ts`. This is mechanical and can be done one tab per PR behind no behaviour change.

**Why it reinforces the contract.** `web/src/` outside `web/src/workers/` must not reference specific workers; a 7k-line file is exactly where that rule silently erodes. Smaller core tabs make leaks visible in review.

**Exit criterion.** No file in `web/src/` (excluding `workers/`) over ~600 LOC; each tab independently mountable; the contract test (1.4 of the wow roadmap) still passes.

**Status — DONE (2026-06-18).** The tab split is structurally real and committed in `82e815f refactor dashboard monolith panels`; follow-up extraction finished the shell/helpers to the exit criterion.

Done:
- ✅ Render harness built — `web/src/__smoke__/render-smoke.tsx` + `scripts/web-smoke.mjs` (`npm run smoke:web`): esbuild-bundles and renders components via `react-dom/server`, failing loudly on render-time throws.
- ✅ Frontend typecheck gate added — `npm test` now runs `npm run check:web`; web type errors fail CI.
- ✅ Shared types/constants moved to `web/src/app-types.ts`.
- ✅ Major tabs extracted to `web/src/tabs/*`: Actions, Health, Store, Channels, Chat, System, Workers, Jobs, Config, Overview.
- ✅ Large tab subpanels extracted: `OverviewSetupPanels`, `OverviewRecipesPanel`, `OverviewModelPanel`, `DashboardFieldEditor`, `JobOperationsPanel`, `PlatformConfigPanels`, `WorkerConfigPage`.
- ✅ `app-helpers.tsx` split into focused modules under `web/src/app-helpers/*`; the barrel is 10 LOC and all helper modules are under 206 LOC.
- ✅ `Wizard.tsx` split into a 235 LOC shell plus focused step modules under `web/src/wizard/*`; largest step module is 323 LOC.
- ✅ App shell extracted into focused `web/src/app-shell/*` controllers/components:
  - `useDashboardData` owns auth/session, polling, lazy section refresh, `mutate`, run triggering, and model save.
  - `useOverviewController` owns demo narration, first-result delight state, recipes, local-runtime adoption, and quick-connect state.
  - `useChatController`, `useStoreController`, and `useDashboardOperations` own tab-side effects and mutations.
  - `DashboardRoutes`, `QueueViews`, `AuthScreens`, and `SpecialModeBanners` own render-only shell surfaces.
- ✅ `app-types.ts` split below threshold; store permission/schema types live in `web/src/app-types/store.ts`.
- ✅ Worker-first contract scan now recursively covers production core files under `src/` and `web/src`, excluding worker trees and tests.
- ✅ Size exit criterion met: no non-worker `web/src` TS/TSX file is over ~600 LOC (`App.tsx` 594, `app-types.ts` 593; next largest smoke/test fixture 549).
- ✅ Latest verification: `npm run build:web && npm run smoke:web` green (25 render-smoke components), `npm run build:server && node --test dist/worker-first-contract.test.js` green, `git diff --check` green, and full `npm test` green (203 backend tests + `check:web`).
- **App.tsx: 7,076 → 594 LOC** (about -92%).

Remaining follow-up (not Phase 1.2):
- [x] Finish the embedding-provider/config/health contract cleanup under Phase 3.1; the wizard credential step itself is generic and scanned.

### 1.3 Extract a design-token layer under `styles.css`
**Problem.** `web/src/styles.css` is **5,945 lines** of hand-rolled CSS with no token system, no router, no UI framework. Visual consistency is maintained by copy-paste.

**Fix.** Lift colours, spacing, radius, typography, motion into CSS custom properties (`:root` tokens) and refactor components to consume them. This is the substrate the UX roadmap's polish/motion phase depends on — do it here so UX work isn't blocked on plumbing. (Out of scope: adopting Tailwind/Radix — decide separately; tokens are framework-agnostic and reversible.)

**Exit criterion.** A documented token set in one place; dark/contrast theming becomes a token swap, not a sweep.

**Status — substantially PRE-EXISTING + hardened (2026-06-15).** This item was written off a stale `wc -l` assumption. `styles.css` already ships a real token layer: a full `:root` palette + semantic aliases (`--border`, `--accent`, `--surface`, `--fg`, radius, shadows, sizing, motion) with **533 `var(--…)` usages**; many apparent "hardcoded" hexes are `var(--brand, #fallback)` fallbacks or `:root` definitions. Hardening done: added a `--danger` token and mapped the 5 `#892f1e` usages to it. Left intentionally: `#fff` (~27×) is light-background in some rules and text-on-dark in others — blind-mapping inverts colors; case-by-case only. Net: the exit criterion is met; residual standalone-color consolidation is optional cleanup.

---

## Phase 2 — Reliability gaps (small, real, verified)

### 2.1 Global crash & rejection handlers
**Problem.** `src/index.ts` registers only `SIGINT`/`SIGTERM`. There is **no `unhandledRejection` / `uncaughtException` handler**, while there are ~20 fire-and-forget `void …` / `.catch(() => …)` call sites in backend code (including the new startup catch-up, `src/index.ts`). A rejected detached promise today is silent or fatal depending on Node flags.

**Fix.** Add process-level `unhandledRejection` / `uncaughtException` handlers in `src/index.ts` that log structured context and decide fail-fast vs. degrade per type. Audit the 20 `void`/`.catch` sites: each should either be awaited, or have an explicit logging `.catch`, never a swallow.

**Exit criterion.** No detached promise can fail silently; a forced rejection produces one structured log line and a defined process outcome.

**Status — DONE (2026-06-19).** Added `src/process-lifecycle.ts` as the single owner for process fault handling:
- `unhandledRejection` and `uncaughtException` now emit one structured JSON `process_fault` log line, attempt cleanup, and exit with code 1.
- Startup fatal errors use the same structured path instead of ad hoc logging and swallowed cleanup failures.
- `detach(promise, label)` records rejected background work with a named `detached_promise_rejection` log.
- Core detached runtime paths now use `detach`: admin request dispatch, scheduler/manual/catch-up jobs, signal shutdown, hot reload, factory reset, and channel launch.
- Former silent cleanup/default catches in lifecycle-adjacent paths now either log explicitly or intentionally ignore only expected absence cases.

Verified: `npm run build:server && node --test dist/process-lifecycle.test.js` passes; full `npm test` passes with **208 backend tests** plus `npm run check:web`.

### 2.2 Scheduled-job retry with backoff
**Problem.** Verified: the `maxAttempts`/`attemptCount` machinery in `src/jobs/queue.ts:174-201` is the **Item Bus posting** path only. A failed *scheduled job* (`src/job-runner.ts`, `scheduler.ts runJobWork`) simply records a `status: 'error'` run — no retry, no backoff. A transient provider blip (the exact cold-boot risk noted in memory `job-runner-requires-provider`) means the user just doesn't get that run. This is the same class of failure as the missing ops digest that started this work.

**Fix.** Add bounded retry-with-backoff around the job execution in `runJobWork`: N attempts, exponential backoff + jitter, configurable per job via the manifest (default e.g. 2 retries). Record attempts on the existing `SchedulerRunRecord` rather than adding a worker-specific column. Pairs naturally with the startup catch-up already shipped.

**Exit criterion.** A job whose provider is briefly unavailable at the scheduled instant succeeds on retry; the run record shows the attempt history; behaviour is opt-out per manifest.

**Status — DONE (2026-06-19).** `runJobWork` now executes jobs through a manifest-configurable retry policy:
- Default policy is 2 retries with exponential backoff and jitter.
- Workers can opt out with `retryPolicy: { maxRetries: 0 }`, or tune `initialBackoffMs`, `maxBackoffMs`, and `jitterRatio`.
- Queue-lock/duplicate-run skips still finish immediately as `skipped` rather than retrying.
- `SchedulerRunRecord.attempts` records every attempt with status, timestamps, error/summary, item count, and next retry delay.
- The Jobs timeline displays retry counts and expandable attempt history for runs with more than one attempt.

Verified: focused scheduler tests pass, including a transient job that fails once and succeeds on retry with two recorded attempts. Full `npm test` passes with **212 backend tests** plus `npm run check:web`; `npm run smoke:web` passes with 25 rendered components.

### 2.3 Harden the raw HTTP surface
**Problem.** `src/admin-server.ts` reads request bodies without an obvious size cap; auth is an inline check inside the dispatcher (`handleRequest` early arms). Local-first, but the worker-generation and zip-upload endpoints (`uploadLocalWorkerZip`, `generateWorkerFromDescription`) accept untrusted-ish input.

**Fix.** Centralize in the Phase-1.1 router: max body size, content-type validation, and the auth gate as one middleware step instead of a per-handler concern. Keep the existing zip safety checks (`assertSafeArchiveNames`, `assertNoSymlinkEntries`) — they're good; just route everything through one choke point.

**Exit criterion.** Oversized/malformed bodies are rejected uniformly before any handler runs; auth is enforced in exactly one place.

**Status — DONE (2026-06-19).** The auth gate is centralized in `handleRequest`, JSON bodies flow through `readJsonBody`, and raw bodies flow through `readRawBody`.
- JSON endpoints now accept only JSON media types (`application/json` and `application/*+json`) when a body is present, while empty optional bodies remain possible.
- Body-limit failures now return HTTP **413** and unsupported media types return HTTP **415** through the shared `BadRequestError` envelope.
- Worker upload explicitly accepts only zip/octet-stream media types, requires a content type, and keeps the 25 MB route-specific cap before archive extraction.
- Worker generation, worker update, and store-install routes use tighter endpoint-specific JSON caps instead of the generic 1 MB default.
- Existing archive traversal and symlink checks remain in place.

Verified: helper-level and HTTP integration tests cover JSON media-type rejection, oversized JSON, worker-upload media-type rejection, and oversized worker uploads. Full `npm test` passes with **218 backend tests** plus `npm run check:web`.

---

## Phase 3 — Type safety & contract guards (cheap, high-leverage)

### 3.1 Turn the worker-first contract into an automated test
**Problem.** The "no worker ids in core" rule is enforced today by `CLAUDE.md`, the author skill, and human review — nothing in CI. It's the single most important invariant and it's untested.

**Fix.** A test that greps `src/` (excluding `src/workers/`) and `web/src/` (excluding `web/src/workers/`) for the forbidden tokens listed in `CLAUDE.md` (`news`, `tweet-post`, `publisher-x`, `telegram`, `openai`, `anthropic`, `lmstudio`, …) and fails on any hit. Source the deny-list from one shared constant so the skill and the test agree.

**Exit criterion.** Reintroducing a worker name into core fails `npm test`.

**Status — DONE (2026-06-18).** `src/worker-first-contract.test.ts` now recursively scans production core files under `src/` and `web/src`, excluding worker trees and tests. The deny-list covers the explicit worker/provider/channel names from the contract, legacy worker route names, and provider-specific core endpoints such as `/api/lmstudio`, `/api/dashboard/lmstudio-models`, and `/api/workers/providers-*`.

Contract cleanup completed alongside the broader scan:
- Core UI uses generic local-runtime endpoints and payloads (`/api/local-runtime`, `/api/dashboard/local-runtime-models`, `dashboard.localRuntime`) instead of provider-specific names.
- Provider credentials, default model seeds, local-runtime settings, embedding dispatch, and provider capability summaries are now owned by provider workers or generic provider contracts.
- Health dependencies are collected dynamically from provider/channel adapters plus worker-owned health checks instead of fixed provider/channel rows.
- Item Bus storage/config paths, queue keys, comments, CSS classes, and frontend copy no longer encode worker names in production core.
- Channel id normalization, factory-reset credential cleanup, and dashboard dependency rendering are generic.

Verified on 2026-06-18: the manual forbidden-token production-core scan is clean; `node --test dist/worker-first-contract.test.js` passes; full `npm test` passes with **203 backend tests** plus `npm run check:web`.

### 3.2 Eliminate the `as unknown as` internal-API casts
**Problem.** 6 `as unknown as` in non-test backend code. The load-bearing one is `getMissedSlotTime` in `scheduler.ts` reaching into node-cron's undocumented `timeMatcher`. It's guarded by try/catch, but it's a silent-break risk on dependency upgrade.

**Fix.** Wrap the node-cron internals access in one typed adapter module with a runtime assertion + a focused test that fails loudly if the shape changes, instead of scattering casts. Re-audit the other 5.

**Exit criterion.** Internal-API access lives in one typed, tested seam; a node-cron upgrade that changes the shape fails a test, not production.

**Status — DONE (2026-06-19).**
- `src/cron-internals.ts` is now the single adapter around node-cron's `InlineScheduledTask.timeMatcher` internal, using runtime checks and fail-closed `null` behavior instead of scheduler-local double casts.
- `src/cron-internals.test.ts` verifies the current node-cron task shape by computing a known previous scheduled match; a dependency shape change now fails a focused test.
- `scheduler.ts` delegates missed-slot calculation to the adapter and keeps its existing catch-up fallback behavior.
- The remaining production `as unknown as` uses were removed or narrowed: Node module resolver hook, event metadata objects, Item Bus payload access, and assistant item summaries.
- `src/worker-first-contract.test.ts` now scans production TypeScript files and fails if `as unknown as` returns.

Verified: full `npm test` passes with **221 backend tests** plus `npm run check:web`.

### 3.3 Add a frontend typecheck gate
**Problem.** Memory `frontend-has-no-typecheck-gate`: `vite build` does not typecheck `web/src`. The 7k-line `App.tsx` has been growing without `tsc` coverage.

**Fix.** Add `tsc --noEmit -p web` to `npm test` (or a `build:web:check`). Do this **after** Phase 1.2 so the split surfaces fewer errors at once.

**Exit criterion.** A type error in `web/src` fails CI.

**Status — DONE (2026-06-18).** `web/tsconfig.json` exists, `npm run check:web` runs `tsc --noEmit -p web/tsconfig.json`, and `npm test` includes `npm run check:web`.

---

## Phase 4 — Testing & observability (close ROADMAP carryovers)

These were the engineering carryovers from the v1.0 technical roadmap (originally listed in [`ROADMAP.md`](./ROADMAP.md)). This file is now their **single home** — ROADMAP.md keeps only the product/launch story. Full original context: `git show a293d11:ROADMAP.md`.

- [ ] **Frontend smoke test for schema-rendered job forms** (was ROADMAP Workstream 6) — partially complete: basic render smoke exists and covers `DashboardFieldEditor`, `JobOperationsPanel`, and config panels; still needs richer schema-field permutations and interaction-level coverage.
- [ ] **Per-worker metrics** surfaced consistently (`buildJobMetricsSection` in `admin-server.ts:1273` already computes percentiles — generalize and test).
- [ ] **Sandbox network-domain / credential-scope allowlists; Playwright session primitive** (was ROADMAP Workstream 5) — reliability + security; relevant to `src/actions/primitives.ts`.
- [ ] **Item Bus multi-consumer fan-out** (was ROADMAP Workstream 3) — when a real use case appears. Keep the queue schema generic (`RawQueueItemSchema`, `src/jobs/queue.ts`); fan-out must stay in the bus, not in worker-specific columns.
- [ ] **Per-worker secrets / env access** (was ROADMAP Workstream 2) — Phase 3.1 removed the known provider/channel credential leaks from production core; the remaining work is to formalize this as a first-class per-worker secret API instead of the current worker-owned helper modules.

---

## Doc drift to fix in passing

- `CLAUDE.md` references **`LOWCODE_ROADMAP.md`**, which does not exist in the tree. Either restore it, fold its remaining items into these roadmaps, or remove the reference. (One-line fix; flagged so it doesn't rot further.)

---

## Sequencing

1. **Phase 1 (monolith dissolution)** — done; preserve it with the typecheck, smoke harness, and worker-first contract scan.
2. **Phase 3.1 (worker-first contract guardrail)** — done; production core is scanned recursively and the main provider/channel/config leaks have been dissolved.
3. **Phase 2 reliability gaps** — done: process fault handling, scheduled-job retry/backoff, and raw HTTP hardening are all verified.
4. **Phase 3.2** — done: node-cron internals are adapter-owned/tested and production double-unknown casts are guarded against.
5. **Phase 4 testing/observability** — next: richer schema-form smoke coverage, per-worker metrics, scoped secrets, and longer-tail platform hardening.

## Global exit criterion

No core file over ~600 LOC; the worker-first contract is machine-enforced; a transient failure at a scheduled instant self-heals; no detached promise fails silently; and adding an HTTP route or a UI tab requires touching a registry, not a monolith — i.e. the codebase is as worker-first in its *own* structure as it asks workers to be.
