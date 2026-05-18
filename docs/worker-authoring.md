# Worker Authoring Guide

This is the consolidated walkthrough for adding a new worker to BFrost. Read `workers/README.md` first for the contract reference; this guide is the *workflow*.

The core promise this guide protects: **adding a feature to BFrost is adding a worker. It is never editing core.** If the worker you want to write seems to require a core change, that is a contract gap to surface, not a reason to patch `src/`.

## Decide the shape

Before writing anything, answer four questions:

| Question | Why it matters |
| --- | --- |
| Producer, consumer, both, or neither? | Decides whether you publish or subscribe on the Item Bus, or skip the bus entirely (tools, channels, providers). |
| Built-in or local? | Built-in lives under `src/workers/builtin/<id>/` and ships with BFrost. Local lives under `workers/local/<id>/` and is the right answer for almost every contribution. |
| Scheduled, on-demand, or event-driven? | Scheduled workers declare `jobs` with `defaultCron`. On-demand workers declare `tools`. Event-driven workers consume Item Bus items from a producer's cron. |
| Stateful or stateless? | Stateful workers use `openWorkerKv` for small values and `openWorkerDb` for tables. Stateless workers don't touch storage at all. |

If you can't answer these, the worker is not ready to write.

## Pick an ID

The ID is permanent. It is baked into:

- KV namespace: `worker.<id>.<key>`
- SQLite table prefix: `worker_<safeId>_<localName>`
- Item Bus metadata namespace: `metadata[<id>]`
- Lifecycle records: `installedVersion` keyed by `<id>`

Conventions:

- Local: `local.<short-noun>` — e.g. `local.mastodon-publisher`, `local.bookmark-feeder`.
- Built-in: `core.<category>.<short-noun>` — e.g. `core.publisher.x`, `core.providers.lmstudio`.

Renaming an ID later orphans every row of state. Choose deliberately.

## Scaffold

### Local worker (the common case)

```
workers/local/mastodon-publisher/
  worker.json
  src/
    index.ts
  README.md
  dist/                 ← created by BFrost on first compile; .gitignore it
```

Minimum `worker.json`:

```json
{
  "manifestVersion": 1,
  "bfrostApiVersion": "0.1",
  "id": "local.mastodon-publisher",
  "name": "Mastodon Publisher",
  "version": "0.1.0",
  "description": "Consumes news.article items and posts them to a Mastodon instance.",
  "language": "typescript",
  "backendSource": "src/index.ts",
  "backendEntrypoint": "dist/index.js"
}
```

`src/index.ts` exports the backend module:

```ts
import type { BackendWorkerModule } from 'bfrost';
import { runJob } from './job.js';

const module: BackendWorkerModule = {
  manifest: {
    manifestVersion: 1,
    bfrostApiVersion: '0.1',
    id: 'local.mastodon-publisher',
    name: 'Mastodon Publisher',
    version: '0.1.0',
    description: 'Consumes news.article items and posts them to a Mastodon instance.',
    builtIn: false,
    jobs: [
      {
        id: 'mastodon-publish',
        workerId: 'local.mastodon-publisher',
        label: 'Publish to Mastodon',
        description: 'Posts approved queue items to Mastodon.',
        defaultEnabled: false,
        defaultCron: '*/15 * * * *',
        approvalRequiredDefault: true,
        paramsSchema: /* zod schema */,
        defaultParams: {},
        permissions: [],
        eventTypes: ['mastodon.posted', 'mastodon.failed'],
      },
    ],
  },
  jobs: { 'mastodon-publish': runJob },
};

export default module;
```

### Built-in worker (only on explicit request)

```
src/workers/builtin/<id>/
  manifest.ts     ← exports a typed manifest
  module.ts       ← exports { manifest, jobs, apiRoutes?, dashboardData? }
  job.ts          ← the runner
  routes.ts       ← if it owns admin API routes
  README.md
```

Then register the module in `src/workers/builtin/index.ts`. This is the **only** core edit allowed when adding a built-in worker, and it's a one-line addition to a registration list.

## Manifest building blocks

Pick the building blocks the worker actually needs. Don't declare empty arrays or speculative fields.

### Settings

```ts
dashboard: {
  settings: [
    {
      id: 'mastodon-config',
      title: 'Mastodon Instance',
      description: 'Instance URL and posting defaults.',
      fields: [
        { id: 'instanceUrl', label: 'Instance URL', type: 'text', defaultValue: '' },
        { id: 'visibility',  label: 'Default visibility', type: 'select',
          options: [
            { value: 'public',   label: 'Public' },
            { value: 'unlisted', label: 'Unlisted' },
          ],
          defaultValue: 'public' },
        { id: 'accessToken', label: 'Access token', type: 'secret-reference',
          defaultValue: '', secretEnvVar: 'MASTODON_ACCESS_TOKEN' },
      ],
    },
  ],
},
```

`seedPath` lets a field initialise from live state instead of the manifest default — see the news worker's `source-quality-rules` surface for a complete example.

### Credentials and dependencies

```ts
requiredCredentials: [
  { id: 'mastodon', label: 'Mastodon access token', envVar: 'MASTODON_ACCESS_TOKEN' },
],
requiredDependencies: [], // e.g. ['ffmpeg'] when the worker shells out
```

These map to health checks. A worker with unsatisfied requirements appears as degraded in the Workers tab; its jobs are blocked from running until the operator resolves the requirement.

### Lifecycle hooks

```ts
lifecycle: {
  async onEnable({ workerId, workerDir })   { /* start timers, open sockets */ },
  async onDisable({ workerId })             { /* clean up */ },
  async onMigrate({ fromVersion, toVersion }) { /* migrate owned storage */ },
}
```

`onEnable` runs every boot, including the first one after install. `onMigrate` runs only when the manifest `version` changes. The new version is persisted only after `onEnable` succeeds — a failing migration is retried on the next boot, never silently advanced.

## Implementing a producer

A producer's job runner builds items and publishes them. The News worker is the canonical example.

```ts
import { publishItem } from 'bfrost';

export async function runJob(ctx) {
  const articles = await harvest(ctx); // your code
  for (const a of articles) {
    await publishItem({
      producerWorkerId: 'local.my-feeder',
      itemType: 'feeder.article',
      tags: ['feeder', a.kind],
      title: a.title,
      shortDesc: a.summary,
      url: a.url,
      payload: { source: a.source, fetchedAt: new Date().toISOString() },
    });
  }
}
```

Choose an `itemType` namespace (`<workerId-or-domain>.<noun>`) that consumers can subscribe to predictably. Once you publish an `itemType`, treat its `payload` shape as a public contract.

## Implementing a consumer

A consumer subscribes to an `itemType`, performs work, and writes its own outcome into `metadata[<its-own-workerId>]`. Publisher-X is the canonical example.

```ts
import {
  listItemsForConsumer,
  applyConsumerSuccess,
  applyConsumerFailure,
  withQueueLock,
  loadQueue,
  saveQueue,
} from 'bfrost';

const CONSUMER_ID = 'local.mastodon-publisher';

export async function runJob() {
  await withQueueLock(async () => {
    const candidates = await listItemsForConsumer(CONSUMER_ID, {
      itemType: 'news.article',
      states: ['queued', 'approved'],
      excludeAlreadyHandled: true,
    });

    const target = candidates[0];
    if (!target) return;

    try {
      const result = await postToMastodon(target);
      const queue = await loadQueue();
      const live = queue.find((it) => it.id === target.id)!;
      applyConsumerSuccess(live, CONSUMER_ID, {
        transition: 'posted',
        metadata: { tootId: result.id, tootUrl: result.url },
      });
      await saveQueue(queue);
    } catch (err) {
      const queue = await loadQueue();
      const live = queue.find((it) => it.id === target.id)!;
      applyConsumerFailure(live, CONSUMER_ID, {
        errorMessage: err instanceof Error ? err.message : String(err),
        maxAttempts: 3,
      });
      await saveQueue(queue);
    }
  });
}
```

Rules:

- Always wrap reads + writes in `withQueueLock` so concurrent jobs do not race.
- Reload the queue inside the lock — don't trust the snapshot from `listItemsForConsumer`.
- Write only under `metadata[CONSUMER_ID]`. Reading another worker's metadata via `readConsumerMetadata` is fine; mutating it is not.

## Tests

A worker ships a `*.test.ts` next to its runner that exercises:

- happy-path execution with a minimal `ctx`
- failure handling (item failure path, retry semantics)
- any non-trivial parsing, scoring, or dedupe logic

For built-in workers, follow the pattern in `src/workers/builtin/news/runs.test.ts` and `src/workers/builtin/publisher-x/job.test.ts`.

Run the full gate before declaring done:

```bash
npx tsc --noEmit
npm test
npm run build
```

All three must pass.

## Document

Every worker ships a one-page `README.md` in its directory, covering:

- What it does in one paragraph.
- What `itemType` it produces or consumes (with payload shape).
- Which credentials it reads from `.env`.
- Which settings it owns and where they appear in the dashboard.
- Operational caveats (rate limits, idempotency, retry behaviour, anything an operator needs to know on a Sunday at 2am).

Treat this as a hard requirement. Operators rely on it.

## Verify the worker loads

```bash
npm run build && npm start
```

In the dashboard:

1. Open the Workers tab.
2. Click **Rescan** if the worker is local.
3. Find the worker row. The manifest panel should render without errors.
4. Toggle **Enable**.
5. If the worker owns a job, click **Run now**. Inspect the run output in the worker tab and the Events feed.
6. Toggle **Disable**. Confirm timers/connections stop cleanly.

Build errors, manifest validation errors, and runtime errors all surface inline next to the worker row.

## When the contract is in your way

If you cannot express what you need without editing core or writing into another worker's namespace, **stop**. State the gap in plain language and open a roadmap issue. Don't paper over it — the platform's promise is exactly that workers cannot reach out of their boundary, and a one-line core edit erases that promise.

## References

- `workers/README.md` — contract reference (manifest fields, lifecycle, examples).
- `docs/item-bus.md` — Item Bus and per-worker storage reference.
- `workers/examples/` — runnable scaffolds, including `wordpress-publisher/` (a full consumer with backend routes, LLM-driven content generation, and a configurable prompt).
- `src/workers/builtin/` — production-grade reference implementations.
