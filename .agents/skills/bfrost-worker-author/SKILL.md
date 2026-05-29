---
name: bfrost-worker-author
description: Scaffold and review a new BFrost worker without touching the core. Use when the user asks to "add a worker", "create a BFrost worker", "build a publisher/producer/consumer for the Item Bus", or otherwise extend BFrost with a new capability. Enforces the worker-first contract — no edits to `src/` outside `src/workers/` and no edits to `web/src/` outside `web/src/workers/`.
---

# BFrost worker author

This skill helps an operator add a new BFrost worker — a producer, a consumer, an assistant tool, a channel adapter, or a model provider — without modifying core code. Every capability in BFrost is a worker. The platform never needs a core change to gain a feature; if a worker can't express what the user wants, that's a contract gap to surface, not a reason to patch `src/`.

## Trigger criteria

Activate this skill when the user asks to:

- create, scaffold, or add a new BFrost worker
- add a producer or consumer to the Item Bus
- add an assistant tool, channel adapter, or model provider
- "publish to X / Mastodon / BlueSky" or any similar new destination
- extend BFrost with a capability that the existing built-in workers don't cover

Do **not** activate this skill for: bug fixes inside an existing worker, modifications to the registry/scheduler/admin server, frontend refactors, or anything that is clearly core work the user has explicitly framed as core.

## Hard rules — non-negotiable

The whole point of BFrost is that adding a feature does not touch the core. While operating under this skill:

1. **Never edit files in `src/` outside `src/workers/`.** No edits to `src/admin-server.ts`, `src/agent.ts`, `src/bot.ts`, `src/cron.ts`, `src/jobs/queue.ts`, `src/jobs/item-bus.ts`, `src/llm.ts`, `src/scheduler.ts`, `src/job-runner.ts`, `src/index.ts`, `src/config.ts`, `src/health.ts`, `src/workers/registry.ts`, `src/workers/validation.ts`, `src/workers/loader.ts`, `src/workers/build.ts`, `src/workers/bootstrap.ts`, `src/workers/storage.ts`, `src/workers/db.ts`, `src/workers/local.ts`, `src/workers/types.ts`, `src/sdk.ts`, or `src/sdk-runtime.ts`. If the worker seems to require it, **stop and surface the contract gap to the user** — do not paper over it with a core edit.

2. **Never edit files in `web/src/` outside `web/src/workers/`.** Worker dashboards live in `web/src/workers/builtin/<id>/dashboard.tsx` (built-in) or ship inside the worker directory as `dashboard.tsx` (local). `web/src/App.tsx`, `web/src/styles.css`, and `web/src/workers/registry.ts` are off-limits.

3. **Prefer local workers under `workers/local/<id>/` for new contributions.** Built-in workers under `src/workers/builtin/` are reserved for reference examples shipped with the platform; only add one when the user explicitly asks for a built-in.

4. **Never bundle a private copy of `react`, `react-dom`, `react/jsx-runtime`, or the `bfrost` SDK.** The host owns those singletons. The build pipeline already externalises them.

5. **Never commit secrets to `worker.json`.** Credentials live in `.env` and are read at runtime. The manifest only declares `secret-reference` fields with placeholder defaults.

6. **Never add code that loads workers from remote URLs.** Loading is local-disk only by design.

If the user explicitly overrides one of these rules, restate the rule, ask the user to confirm with a one-line "yes I want to break this for reason X", and only then proceed. Log the decision in the resulting PR description so a reviewer sees it.

## Workflow

Follow these steps in order. Stop and confirm with the user between any step where the next decision is irreversible (file layout, worker ID, builtin vs local).

### 1. Establish the worker's role

Ask the user, in one short message, only what you cannot infer from context:

- **Producer or consumer?** (or both, or neither — neither = tool/channel/provider worker)
- **What `itemType` does it produce or subscribe to?** If consuming, default to `news.article` and confirm.
- **Does it need credentials?** (Google, X, an HTTP API key, etc.)
- **Dashboard tab, worker-wide Config settings, or scheduled-job parameters in Jobs?** Scheduled workers and output-producing workers must have a dashboard tab; only ask about Config/Jobs details when unclear.
- **Built-in or local?** Default to local. Only choose built-in if the user names a `core.*` ID and explicitly asks for one.

Don't ask the user to invent things `workers/README.md` already specifies (manifest version, API version, lifecycle hooks, storage APIs). Read those from the docs and propose defaults.

### 2. Pick the worker ID

- Local: `local.<short-noun>` (e.g. `local.mastodon-publisher`, `local.bookmark-feeder`).
- Built-in (rare): `core.<category>.<short-noun>` (e.g. `core.publisher.mastodon`).

The ID is permanent — it appears in `worker.<id>.<key>` KV namespaces, `worker_<safeId>_<table>` SQLite table prefixes, and `metadata[id]` Item Bus namespaces. Renaming an ID later orphans state. Choose carefully and confirm with the user before scaffolding.

### 3. Scaffold the directory

Local worker (default):

```
workers/local/<id-without-prefix>/
  worker.json
  src/
    index.ts        ← BackendWorkerModule
  dashboard.tsx     ← required for scheduled or output-producing workers; omit only for manifest-only/config-only workers with no operator-facing output
  README.md         ← what it does, what it produces/consumes, what env vars it reads
```

Built-in worker (only on explicit request):

```
src/workers/builtin/<id>/
  manifest.ts
  module.ts
  job.ts            ← only if it owns a scheduled job
  routes.ts         ← only if it owns admin API routes
  dashboard.tsx     ← required for scheduled or output-producing workers, or place the built-in dashboard view under web/src/workers/builtin/<id>/dashboard.tsx if that is the established local pattern
  README.md
```

Then read `workers/examples/complete-capability/worker.json` and copy the structure — every field is documented inline.

If you author in a registry repo such as `BFrost-Workers/packages/<id>/`, packaging is not installation. Also mirror or install the worker into BFrost's `workers/local/<id>/` (or use the product's worker-store install flow), then rescan/restart before calling it visible in the app.

### 4. Write the manifest

Use this checklist before writing code. BFrost has two related manifest shapes:

**Local `worker.json` required fields**
- `manifestVersion: 1`
- `bfrostApiVersion: "0.1"`
- `id` — stable lowercase id matching `[a-z0-9][a-z0-9._-]*`
- `name`
- `version`
- `description`

**Local `worker.json` optional fields**
- `owner`, `kind`
- `language`, `backendSource`, `backendEntrypoint`
- `dashboardSource`, `dashboardEntrypoint`
- `requiredCredentials`, `optionalCredentials`
- `requiredDependencies`, `optionalDependencies`
- `ownedSettings`
- `dashboard.settings`, `dashboard.routes`

For any scheduled worker (`jobs.length > 0`) or worker that produces/consumes operator-facing output (Item Bus items, files, notifications, external posts, tool history), a dashboard route is required, not optional. The dashboard is where low-code users inspect cron output and failures.

For executable TypeScript workers, set all of these together:

```json
{
  "language": "typescript",
  "backendSource": "src/index.ts",
  "backendEntrypoint": "dist/index.js"
}
```

If the worker ships a React dashboard bundle, set both:

```json
{
  "dashboardSource": "dashboard.tsx",
  "dashboardEntrypoint": "dist/dashboard.js"
}
```

Scheduled/output-producing TypeScript workers should normally set these too:

```json
{
  "dashboardSource": "dashboard.tsx",
  "dashboardEntrypoint": "dist/dashboard.js"
}
```

**Runtime `WorkerManifest` required fields in `src/index.ts`**
- `manifestVersion: 1`
- `bfrostApiVersion: "0.1"`
- `id`, `name`, `version`, `description`
- `builtIn: false`
- `jobs: []` — include an empty array when the worker owns no jobs

**Runtime `WorkerManifest` optional fields**
- `displayName`, `tagline`, `owner`, `kind`
- `permissions`
- `requiredCredentials`, `optionalCredentials`
- `requiredDependencies`, `optionalDependencies`
- `ownedSettings`
- `dashboard`
- `channels`, `tools`, `providers`
- `summarizeForAssistant`

**Dashboard settings field requirements**
- Use `dashboard.settings` only for worker-wide configuration. Scheduled job inputs belong in `jobs[].dashboardFields`.
- Every field requires `key`, `label`, `type`, and `defaultValue`.
- `text`, `textarea`, `select`, and `secret-reference` defaults must be strings.
- `number` defaults must be numbers, not quoted strings.
- `boolean` defaults must be booleans.
- `string-list` defaults must be string arrays.
- `select` fields also require `options: [{ value, label }]`.
- `seedPath` is optional but recommended so low-code users edit current state, not stale defaults.

**Runtime dashboard view requirements**
- Scheduled workers and output-producing workers must declare a dashboard route/surface. The dashboard should show latest run status, recent produced/consumed output, errors/skips, relevant approvals/actions, and a read-only summary of current job/config context. Include a standard Run now shortcut when the worker owns a job.
- Register with `window.bfrost.registerDashboardView(...)`.
- Required to show a tab: `workerId`, `kind`, `surfaceIds`, and `render`.
- `surfaceIds` must match at least one `dashboard.routes[].id` or `dashboard.settings[].id`.
- Optional: `menu`, `count`, `queueItemDetail`.
- If there is no badge count, still provide `count: () => undefined` for compatibility with older hosts.
- Dashboard code must tolerate missing data from `ctx.dashboard`, `ctx.dashboard.workerData[workerId]`, `ctx.StatusPill`, `ctx.Detail`, and any helper callbacks. Use optional chaining and local fallbacks.
- Never assume arrays exist. Normalize with `Array.isArray(value) ? value : []`.
- Never let a missing worker-data slice crash the dashboard; render an empty/configure state instead.
- If a dashboard is shown to operators, include a folded Guide section below the operational content using `details.panel.tab-page.worker-help-footer`. Keep the top of the dashboard action/status-first, then document:
  - what the worker does
  - where to configure it (Jobs vs Config)
  - inputs and outputs (`itemType`, files, assistant tools, or external API)
  - one copyable example setup or prompt
  - the most likely FAQ/troubleshooting case

**Job, cron, and settings placement**
- Every scheduled worker must declare its schedule through the job manifest: `jobs[].defaultCron`, `defaultEnabled`, `defaultParams`, `paramsSchema`, `dashboardFields`, `prompt`, `approvalRequiredDefault`, and related job fields.
- Job parameters that affect a run belong on the job: `paramsSchema`, `defaultParams`, and `dashboardFields`. BFrost renders those fields in the Jobs panel for low-code users. Examples: query, filters, max results/items, output folder/template for that job, and include/exclude flags.
- Worker-wide settings that are not per-run inputs belong in `dashboard.settings` / Config. Examples: API base URL, account/workspace/site id, credential reference, shared folder used by multiple jobs, and webhook secret reference.
- Do not duplicate a field in both `jobs[].dashboardFields` and `dashboard.settings`. Pick one owner.
- Do not build custom cron, enable/disable, model, prompt, approval, or job-parameter controls inside the worker dashboard. Those belong in BFrost's dedicated Jobs panel.
- Worker dashboards may show read-only job status, last-run summaries, recent output, and a `Run now` shortcut that calls the standard cron-job run endpoint.

Decision tree:

- **Worker takes scheduled action** → declare `jobs: [...]` with `defaultCron`, `paramsSchema` (Zod), `defaultParams`, `dashboardFields`, optional `prompt`. The fields in `dashboardFields` are what low-code users edit in Jobs.
- **Worker is callable by the assistant** → declare `tools: [...]` with `inputSchema` and `execute`.
- **Worker reaches a chat surface** → declare `channels: [...]` with capability flags and lifecycle methods.
- **Worker provides an inference backend** → declare `providers: [...]` with capability flags and a `ProviderAdapter`.
- **Worker needs operator config** → declare `dashboard.settings[].fields` with `text` / `textarea` / `number` / `boolean` / `select` / `string-list` / `secret-reference` field types only for worker-wide config. Use `seedPath` to seed the form from live state.
- **Worker needs credentials** → declare `requiredCredentials` / `optionalCredentials` keyed to the health check the user must satisfy.
- **Worker needs an external binary** → declare `requiredDependencies` / `optionalDependencies`.

For the job runner contract, prompt template, and lifecycle hooks, follow `docs/worker-authoring.md` and copy the matching reference (news for producers, publisher-x or `workers/examples/wordpress-publisher/` for consumers, memory for tools, channels-telegram for channels, providers-lmstudio for providers).

### 5. Wire storage and the Item Bus

- Private state: `import { openWorkerKv, openWorkerDb } from 'bfrost'`. Never reach for a raw better-sqlite3 handle. See `docs/item-bus.md` for shape and migration rules.
- Cross-worker communication: `import { publishItem, listItemsForConsumer, applyConsumerSuccess, applyConsumerFailure, setConsumerMetadata, readConsumerMetadata, withQueueLock, loadQueue, saveQueue } from 'bfrost'`.
- A consumer writes only into `metadata[<its-own-workerId>]`. Never write into another worker's namespace.
- For a producer, choose a stable `itemType` namespace (`<workerId-or-domain>.<noun>`).

### 6. LLM calls

When a worker calls `generateText` (or `streamText`), follow this pattern to stay compatible with local models served by LMStudio:

**Prepend `/no_think` to the user prompt.** Qwen3 and similar local models with extended-thinking mode enabled will otherwise put all their output in the reasoning/thinking block and return an empty `text` field. Other models (OpenAI, Anthropic) silently ignore this prefix.

```ts
const { text } = await generateText({
  model: getChatModel(modelOption),
  system: SYSTEM_PROMPT,
  prompt: '/no_think\n' + buildPrompt(input),
  timeout: config.jobLlmTimeoutMs,
});
```

**Do not set `maxOutputTokens` in the SDK call.** LMStudio's OpenAI-compatible server treats `max_tokens` as part of the total context budget (input + output). If the prompt is large and `max_tokens` is set explicitly, the server may return an empty response when `input_tokens + max_tokens` approaches the context window. Rely on the server-level context length (`LMSTUDIO_CONTEXT_LENGTH`, default 16 384) to provide headroom.

**Cap content excerpts in prompts to ~1000 chars per item.** With a 16 384-token context window and several enriched items in the prompt, full article text (up to 4 000 chars each) will exhaust the budget before the model can generate its response. 1000 chars is enough for relevance judgement. Store the full content in the queue payload for downstream workers that need it.

**Improve the error log on parse failure.** When the model returns something that can't be parsed, log the raw output with clear delimiters before throwing — this makes the problem immediately visible when you re-run the job:

```ts
} catch (err) {
  const preview = text.length > 3000 ? text.slice(0, 3000) + `\n… (truncated, total ${text.length} chars)` : text;
  console.log('[WorkerName] LLM parse error — raw output follows:\n--- LLM OUTPUT BEGIN ---\n' + preview + '\n--- LLM OUTPUT END ---');
  throw new Error(`LLM output not valid: ${err instanceof Error ? err.message : err}`);
}
```

### 7. Tests

Local workers should ship a unit test next to the job/tool that exercises the public manifest contract and any non-trivial parsing or scoring. Built-in workers add a `*.test.ts` next to their `manifest.ts` / `job.ts` — see `news/runs.test.ts` for the pattern.

Run:

```bash
npx tsc --noEmit
npm test
```

before declaring done. Both must pass.

### 8. Verify the worker loads and is usable

```bash
npm run build
npm start
```

Then in the dashboard's Workers tab: rescan, find the new worker, enable it, click Run now (if it owns a job), inspect the run, then disable it. If anything fails (manifest validation, compile error, runtime error), the error appears next to the worker row.

If the worker owns a dashboard bundle, confirm it loads:

```bash
curl -s -o /tmp/<id>-dashboard.js -w '%{http_code}\n' http://127.0.0.1:3030/api/workers/<id>/dashboard.js
```

If the worker owns a scheduled job, confirm the Jobs panel can see its fields:

```bash
curl -s http://127.0.0.1:3030/api/dashboard | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s); console.log(d.cron?.jobs?.find(j=>j.id=="<job-id>")?.dashboardFields?.map(f=>f.key) ?? [])})'
```

After changing backend manifest or job definitions for an already-loaded local worker, restart BFrost or disable/re-enable the worker. Dashboard-only TSX can rebuild on fetch, but server-side manifest and job metadata are loaded at startup/enable time.

### 9. Document

Every worker ships a one-page `README.md` inside its directory covering: what it does, what `itemType` it produces or consumes, which credentials it reads, which env vars it expects, which settings it owns, and any non-obvious operational caveats. Treat this as a hard requirement for the contract — operators rely on it.

## Calibration

- A new producer/consumer worker is usually **one manifest, one job runner, one README, one test, < 300 LOC**. If you find yourself writing more than that, you are probably re-implementing something core already provides. Stop and re-read `workers/README.md`.
- If the proposed worker requires editing the dashboard payload shape, the queue schema, the scheduler, or the registry, **the design is wrong**. Workers contribute slices through declared hooks. Surface the contract gap; do not patch core.

## When stuck

If the worker contract genuinely can't express what the user needs:

1. Stop writing code.
2. State the gap in plain language: "I'd need to write into `metadata[other-worker]` to coordinate, but the contract forbids it" — quote the rule.
3. Offer the user two paths: (a) reshape the worker to fit the contract, (b) open a roadmap issue for a contract extension and pause this work.

Never close the gap by editing core silently. That is exactly the failure mode this skill exists to prevent.

## References

- `workers/README.md` — manifest fields, lifecycle, storage, Item Bus, examples.
- `docs/worker-authoring.md` — consolidated authoring guide (scaffold-to-ship walkthrough).
- `docs/item-bus.md` — Item Bus and per-worker storage reference.
- `workers/examples/simple-job/` — minimal manifest-only worker.
- `workers/examples/research-style-job/` — manifest with health, settings, dashboard route.
- `workers/examples/complete-capability/` — full anatomy reference.
- `workers/examples/wordpress-publisher/` — full consumer worker with backend routes, LLM-driven content generation, configurable prompt, and WP REST integration.
- `workers/examples/dashboard-view/` — runtime-loaded React dashboard view.
- `src/workers/builtin/news/` — reference producer.
- `src/workers/builtin/publisher-x/` — reference consumer.
- `src/workers/builtin/memory/` — reference assistant-tool worker.
- `src/workers/builtin/channels-telegram/` — reference channel worker.
- `src/workers/builtin/providers-lmstudio/` — reference provider worker.
