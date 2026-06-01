# BFrost Workers

BFrost workers are local, inspectable capability bundles. Today the public contract is manifest-only: BFrost can discover a worker, show it in the dashboard, track enable/disable state, report compatibility issues, and expose declared ownership for jobs, settings, health checks, and dashboard routes.

Executable third-party worker loading is intentionally not part of the first GitHub-ready slice. Built-in jobs are the reference implementation for runtime behavior while local workers establish the metadata and lifecycle contract.

## Local Worker Layout

A local worker is a directory containing `worker.json`:

```text
workers/
  my-worker/
    worker.json
```

By default BFrost scans `./workers/local` first, then `./workers`. Uploaded local workers are installed under `./workers/local`, which is ignored by git. You can override this with:

```bash
BFROST_WORKER_PATHS=./workers/local,./workers,../my-bfrost-workers
```

The dashboard Workers tab has a rescan button for local development.

## Manifest Fields

Required fields:

- `id`: stable lowercase ID, for example `local.simple-job`
- `name`: display name
- `version`: worker version
- `description`: one-sentence purpose

Optional fields:

- `manifestVersion`: currently `1`
- `bfrostApiVersion`: currently `0.1`
- `owner`: person or organization
- `backendEntrypoint`: experimental relative path to a future backend module file
- `requiredCredentials`, `optionalCredentials`: health requirements keyed to BFrost health checks
- `requiredDependencies`, `optionalDependencies`: local tool requirements keyed to BFrost health checks
- `chatPrompts`: natural-language example requests shown as buttons on the dashboard chat welcome screen
- `ownedSettings`: persisted settings or state the worker owns
- `dashboard.settings`: dashboard settings surfaces the worker owns
- `dashboard.routes`: dashboard/API routes or dashboard tabs the worker uses

Configuration surfaces can declare a `fields` array. The dashboard renders these fields centrally in the Config tab and seeds drafts from each field's `defaultValue` when the worker is discovered or installed. Supported field types are `text`, `textarea`, `number`, `boolean`, `select`, `string-list`, and `secret-reference`. Secrets should only use placeholders or empty defaults in the manifest; real values belong in local storage such as `.env` or a trusted worker backend endpoint.

Every field can additionally declare `seedPath`, a dotted path into the dashboard's `workerData` bag (e.g. `core.news.sourceRules.minScore`). When the path resolves, the form initialises with the live value from the worker's data slice instead of the manifest's static default. This is how a worker lets the user *edit current settings* without writing any extra client code — the news worker's `source-quality-rules` surface is a complete example.

Local manifest-only workers do not declare executable jobs yet. Built-in workers show the full job contract in `src/workers/builtin/*/manifest.ts`, and `src/workers/registry.ts` only aggregates those manifests.

`backendEntrypoint` is reserved for the executable worker module contract. Discovery validates that it is a relative `.js`, `.cjs`, or `.mjs` path inside the worker directory, but BFrost does not load it unless executable local worker loading is explicitly implemented and enabled. The intended shape is the same as built-in backend modules: a module that exports worker manifest, API routes, dashboard data hooks, and job runners through typed contribution points.

Backend modules must pass central validation before they can be trusted by the scheduler or admin API. The validator rejects duplicate worker IDs, duplicate job IDs, invalid default params, route conflicts, and routes that point at unknown worker owners.

## Lifecycle

1. Place a worker directory under one of the configured worker paths.
2. Click Rescan in the dashboard Workers tab.
3. Enable or disable the worker from the dashboard.
4. If worker files are removed, BFrost keeps historical state visible and marks the worker missing.

Built-in workers cannot be removed. Local workers can be disabled and their files can disappear without corrupting history.

## Safety Rules

- Do not commit `.env`, database files, logs, model files, generated research notes, or private worker scratch directories.
- Do not load arbitrary remote worker code into BFrost.
- Keep `BFROST_ENABLE_LOCAL_WORKER_CODE=false` unless you are deliberately testing a trusted local backend module.
- Keep local worker manifests boring and reviewable.
- Prefer schema-only dashboard controls before custom UI.
- Treat credentials as local environment values, never manifest values.

## Author Checklist

- [ ] Choose a stable namespaced ID, such as `local.my-worker`.
- [ ] Add `manifestVersion: 1` and `bfrostApiVersion: "0.1"`.
- [ ] Declare credentials and dependencies the operator must check before use.
- [ ] Declare owned settings for central Config, standard Jobs controls, and worker output.
- [ ] Declare Config fields and safe defaults in `dashboard.settings[].fields`.
- [ ] Declare dashboard surfaces only when the worker has a real view.
- [ ] Keep cron enablement in standard job settings rather than custom UI.
- [ ] Keep manual execution in standard job controls unless the worker dashboard has a clear reason to expose a shortcut.
- [ ] Keep secrets out of `worker.json`.
- [ ] Test discovery with `npm test`.
- [ ] Verify the worker appears in the dashboard after Rescan.

## Item Bus — Producers And Consumers

Workers exchange work through a shared **Item Bus**: a typed queue any worker can produce into and any worker can subscribe to. The bus is how the built-in News worker feeds the X Publisher (and how the bundled `wordpress-publisher` example posts the same items to a WordPress site). Adding a Mastodon or BlueSky publisher works the same way — declare a consumer subscription, no existing worker changes.

### Item Shape

Every item on the bus carries:

- `id` — stable, deterministic.
- `producerWorkerId` — the worker that emitted it (e.g. `core.news`).
- `itemType` — dotted name describing what the item *is* (`news.article`, `bookmark.saved`, …). Consumers subscribe by type.
- `tags` — optional free-form labels for finer filtering (`['news', 'breaking']`).
- `payload` — producer-owned JSON. Read-only from a consumer's perspective.
- `state` — one of `queued`, `approved`, `posted`, `rejected`, `failed`, `seen`.
- `metadata` — `Record<consumerWorkerId, Record<string, unknown>>`. **Each consumer writes only under its own worker id**, so two consumers of the same item never collide.

### Producing An Item

```ts
import { publishItem } from 'bfrost/jobs/item-bus';

await publishItem({
  producerWorkerId: 'my.bookmarks',
  itemType: 'bookmark.saved',
  tags: ['bookmark'],
  title: 'How BFrost workers work',
  shortDesc: 'A short summary for the dashboard.',
  url: 'https://example.com/post',
  payload: { source: 'manual', addedBy: 'me' },
});
```

Producers should choose a stable `itemType` namespace (`<workerId-or-domain>.<noun>`) so consumer authors can subscribe predictably.

### Consuming Items

```ts
import {
  listItemsForConsumer,
  applyConsumerSuccess,
  applyConsumerFailure,
  setConsumerMetadata,
  withQueueLock,
  saveQueue,
  loadQueue,
} from 'bfrost/jobs/item-bus';

await withQueueLock(async () => {
  const candidates = await listItemsForConsumer('my.mastodon', {
    itemType: 'news.article',
    states: ['queued', 'approved'],
    excludeAlreadyHandled: true, // skip items this consumer has already touched
  });

  const target = candidates[0];
  if (!target) return;

  try {
    const result = await postToMastodon(target);
    const queue = await loadQueue();
    const live = queue.find((it) => it.id === target.id)!;
    applyConsumerSuccess(live, 'my.mastodon', {
      postedId: result.id,
      metadata: { tootId: result.id, tootUrl: result.url },
    });
    await saveQueue(queue);
  } catch (err) {
    const queue = await loadQueue();
    const live = queue.find((it) => it.id === target.id)!;
    applyConsumerFailure(live, 'my.mastodon', {
      errorMessage: err instanceof Error ? err.message : String(err),
      maxAttempts: 3,
    });
    await saveQueue(queue);
  }
});
```

### Metadata Namespacing Rules

- A consumer **must** write only under its own `workerId`. Never read or mutate another worker's metadata namespace — treat it as private.
- Reading another worker's payload (the producer's `payload`) is fine and expected.
- If two consumers want to coordinate (e.g. an X publisher attaching a WordPress publisher's article URL to its tweet), the coordinating consumer reads the other consumer's metadata through `readConsumerMetadata` but never writes to it.

### Lifecycle Notes

- The shared `state` field still belongs to the queue as a whole — `applyConsumerSuccess` with `transition: 'posted'` moves it to `posted` for the legacy single-publisher flow. Multi-consumer fan-out (multiple consumers completing independently on the same item) is on the roadmap; until then, consumers should agree which one owns the terminal transition.
- The bus piggybacks on the same shared queue store as today's News → Publisher pipeline, so backups, dashboard rendering, and queue inspection keep working unchanged.

## Per-Worker Storage

Workers keep private state in two namespaced stores. Cross-worker sharing goes through the Item Bus above — these APIs are strictly for state that belongs to a single worker.

### Key-Value (`openWorkerKv`)

```ts
import { openWorkerKv } from '../../../workers/storage';

const kv = openWorkerKv('core.my-worker');
await kv.set('last-run-at', { iso: new Date().toISOString() });
const last = await kv.get<{ iso: string }>('last-run-at');
await kv.clear('last-run-at');
```

Keys are stored under `worker.<workerId>.<key>` in the shared SQLite KV. Two workers cannot collide; the dashboard backup carries every worker's KV state.

### SQLite Tables (`openWorkerDb`)

For structured state — queues, caches, indexes — use the per-worker table API. Tables are physically created as `worker_<safeWorkerId>_<localName>`; the worker only ever sees its own handles.

```ts
import { openWorkerDb } from '../../../workers/db';

interface Memo extends Record<string, unknown> {
  id: string;
  content: string;
  pinned?: number;
  created_at: string;
}

const db = await openWorkerDb('core.my-worker');
const memos = await db.defineTable<Memo>('memos', {
  columns: [
    { name: 'id',         type: 'TEXT',    primaryKey: true },
    { name: 'content',    type: 'TEXT',    notNull: true },
    { name: 'pinned',     type: 'INTEGER', default: 0 },
    { name: 'created_at', type: 'TEXT',    notNull: true },
  ],
  indexes: [{ name: 'by_created', columns: ['created_at'] }],
});

memos.insert({ id: 'm1', content: 'hello', created_at: new Date().toISOString() });
memos.upsert({ id: 'm1', content: 'updated', created_at: new Date().toISOString() }, ['id']);
memos.update({ id: 'm1' }, { pinned: 1 });
memos.findAll({ where: { pinned: 1 }, orderBy: 'created_at DESC', limit: 10 });
memos.count();
memos.raw<{ count: number }>('SELECT COUNT(*) AS count FROM ${table} WHERE pinned = ?', [1]);
```

`defineTable` is idempotent — calling it again with extra columns runs `ALTER TABLE ADD COLUMN` for the new ones. Renames and drops are not supported and should be handled in an explicit migration on the worker's lifecycle hooks. The `raw()` helper substitutes `${table}` with the prefixed name; you can join across your own tables but cannot reach another worker's tables — you never receive their handles.

**Trust boundary:** these APIs trust the worker author. A local worker that runs Node code on the host could of course bypass the prefix and read another worker's tables directly. Sandboxing comes in Workstream 5; the prefix is for hygiene and backup ergonomics today.

## Local Workers With Executable Code

Manifest-only workers are useful for visibility but don't actually *do* anything until a backend module is loaded. Local workers can ship code in two ways:

### Compiled JavaScript

The simplest contract:

```text
my-worker/
  worker.json          ← manifestVersion, id, name, version, description, backendEntrypoint
  dist/
    index.js           ← the file BFrost requires() at load time
```

`worker.json`:

```json
{
  "manifestVersion": 1,
  "bfrostApiVersion": "0.1",
  "id": "local.my-worker",
  "name": "My Worker",
  "version": "0.1.0",
  "description": "What this worker does in one line.",
  "backendEntrypoint": "dist/index.js"
}
```

`dist/index.js` must export a `BackendWorkerModule` as `default`, `workerModule`, or `module`:

```js
exports.default = {
  manifest: {
    manifestVersion: 1,
    bfrostApiVersion: '0.1',
    id: 'local.my-worker',
    name: 'My Worker',
    version: '0.1.0',
    description: 'What this worker does in one line.',
    builtIn: false,
    jobs: [],
    tools: [/* … */],
  },
};
```

The `manifest.id` inside `dist/index.js` **must match** the `id` in `worker.json`. BFrost rejects mismatches.

### TypeScript Source (compile-on-install)

Authoring in TypeScript is supported — BFrost bundles the source with **esbuild** on first load and writes the result to the declared `backendEntrypoint`. Subsequent loads use the cached output unless the source is newer.

```text
my-worker/
  worker.json          ← language: "typescript", backendSource, backendEntrypoint
  src/
    index.ts           ← your code
  dist/                ← created by BFrost on first load; safe to .gitignore
    index.js
```

`worker.json` additions:

```json
{
  "manifestVersion": 1,
  "bfrostApiVersion": "0.1",
  "id": "local.my-worker",
  "name": "My Worker",
  "version": "0.1.0",
  "description": "What this worker does.",
  "language": "typescript",
  "backendSource": "src/index.ts",
  "backendEntrypoint": "dist/index.js"
}
```

BFrost never executes TypeScript at runtime — every worker runs as JS once compiled. Build errors surface on the dashboard's Workers tab next to the worker row.

### Lifecycle Hooks (optional)

A backend module can opt into lifecycle callbacks:

```ts
export default {
  manifest,
  lifecycle: {
    async onInstall(ctx)   { /* one-time install actions, schema migrations */ },
    async onMigrate(ctx)   { /* fromVersion/toVersion differ: migrate owned storage */ },
    async onEnable(ctx)    { /* every enable, including first boot after install */ },
    async onDisable(ctx)   { /* clean up timers, watchers, sockets */ },
    async onUninstall(ctx) { /* one-time tear-down before worker files are deleted */ },
  },
};
```

`ctx` carries `{ workerId, workerDir }`. `onMigrate` additionally receives `fromVersion` (the manifest `version` last successfully booted; `null` on first install) and `toVersion` (the version about to be enabled). The platform persists the new version only after `onEnable` succeeds, so a failing `onMigrate` is retried on the next boot rather than being silently advanced.

### Importing the BFrost SDK

Local worker TypeScript can import the public API from the synthetic `bfrost` module:

```ts
import {
  openWorkerKv,
  openWorkerDb,
  publishItem,
  listItemsForConsumer,
  applyConsumerSuccess,
  recordEventSafe,
} from 'bfrost';
import type { BackendWorkerModule, WorkerManifest } from 'bfrost';
```

The bundler keeps `bfrost` external; at runtime the host's `Module._resolveFilename` hook routes the require to the same singleton implementations the built-in workers use. Never bundle a private copy — your worker and the host share the storage prefix table and the Item Bus lock.

### Dashboard UI Bundle (optional)

A local worker can ship its own React-based dashboard view. Two layouts work:

```json
{
  "dashboardSource": "dashboard.tsx"
}
```

BFrost compiles `dashboard.tsx` with esbuild (browser target, IIFE) on demand and serves the bundle from `/api/workers/<id>/dashboard.js`. The browser injects that script after the dashboard shell loads.

Or ship a prebuilt bundle:

```json
{
  "dashboardEntrypoint": "dist/dashboard.js"
}
```

Inside the bundle, register your view via the host-provided global:

```tsx
import { useState } from 'react';

function MyView() {
  const ui = window.bfrost.ui;
  const [count, setCount] = useState(0);
  return (
    <section className={ui.classes.panel}>
      <div className={ui.classes.panelHead}>
        <div>
          <p className={ui.classes.panelKicker}>Local worker</p>
          <h2>Counter</h2>
        </div>
        <span className={ui.statusTone('info')}>{count}</span>
      </div>
      <div className={ui.classes.detailBody}>
        <button className={ui.classes.primaryButton} onClick={() => setCount(count + 1)}>
          Clicked {count} time{count === 1 ? '' : 's'}
        </button>
      </div>
    </section>
  );
}

window.bfrost.registerDashboardView({
  workerId: 'local.my-worker',
  kind: 'my-view',
  surfaceIds: ['my-view-tab'],
  count: () => undefined,
  render: () => <MyView />,
});
```

Important: `react`, `react-dom`, and `react/jsx-runtime` are externalized and rewired to `window.bfrost.*` automatically. Never bundle a second React — hook dispatchers are per-React-instance and a duplicate React breaks `useState` silently. TypeScript types for `window.bfrost` are not yet packaged; declare a local `declare global` block in your `dashboard.tsx` until a `@bfrost/worker-sdk` ships.

### Dashboard UI host contract

Dashboard bundles should use the host CSS contract instead of copying BFrost styles or importing files from `web/src`. The browser exposes `window.bfrost.ui`:

```ts
const ui = window.bfrost.ui;
```

Stable class helpers:

| Helper | Use |
| --- | --- |
| `ui.classes.surface` | Top-level dashboard surface wrapper. |
| `ui.classes.grid` | Responsive grid for repeated panels. |
| `ui.classes.panel` / `panelHead` / `panelKicker` | Standard dashboard panels and headings. |
| `ui.classes.detailBody` / `detailGrid` / `detailBlock` | Detail sections and key/value blocks. |
| `ui.classes.field` | Label + input/select/textarea form rows. |
| `ui.classes.actions` | Button rows that wrap cleanly. |
| `ui.classes.button` / `primaryButton` / `dangerButton` | Standard actions without importing a component. |
| `ui.classes.statusPill` and `ui.statusTone('good' | 'warning' | 'info' | 'muted' | 'error')` | Status chips that match the host. |
| `ui.classes.emptyState` | Empty/loading/fallback messages. |
| `ui.classes.timeline` / `timelineEvent` | Event and run timelines. |
| `ui.classes.stepHeader` | Short setup/checklist step headers. |

`ui.cx(...parts)` joins class names while dropping `false`, `null`, and `undefined`.

Keep custom CSS inside your worker bundle limited to worker-specific layout details. Do not depend on private app module paths; only the `window.bfrost` global and these CSS class names are part of the dashboard UI contract.

See `workers/examples/dashboard-view/` for a runnable example.

### Safety And Trust

- BFrost is **not** a sandbox. Local workers run with the privileges of the host user.
- Only install workers from sources you trust. There is no signing or verification yet.
- Workers should never write outside their own `workerDir` or read other workers' state.
- Sensitive credentials belong in `.env`, not in `worker.json`.

## Compatibility Policy

BFrost enforces `bfrostApiVersion` at two points:

1. **Discovery** — when `worker.json` is read, the declared `bfrostApiVersion` is compared against the running BFrost installation's supported version. A mismatch produces a load issue visible in the dashboard and prevents the worker from starting.
2. **Load** — after the compiled JS module is `require()`-ed, the `bfrostApiVersion` field in the *module's* manifest is checked again. This catches cases where the JS was built against a different API than the current `worker.json` declares.

**Pre-1.0 policy (current):** exact match required. `'0.1'` will not load a worker that declares `'0.2'` or `'1.0'`. This is intentional — the pre-1.0 contract is not yet stable enough to promise backward compatibility. When BFrost reaches 1.0, this policy will become semver-compatible (a `'1.x'` installation will accept any `'1.y'` worker, refusing only `'2.x'`).

**Current supported version:** `'0.1'`

**If your worker fails with a `bfrostApiVersion` mismatch:**
- Check which version of BFrost you are running and update your `worker.json` (and your module's manifest constant) to match.
- If you need a newer API feature, upgrade BFrost to a version that supports it.

## Examples

- `examples/simple-job/`: minimal manifest with one settings surface.
- `examples/research-style-job/`: richer manifest with health checks, owned settings, and dashboard route descriptors.
- `examples/complete-capability/`: full anatomy example for configuration, job lifecycle, health, dashboard output, and future backend/frontend entrypoints.
- `examples/wordpress-publisher/`: full WordPress publisher worker — consumes `news.article` items, generates an article body with the local model and a configurable prompt, and posts via the WP REST API. Demonstrates backend routes, lifecycle hooks, per-worker KV, secret-reference fields, and the consumer pattern.
- `examples/dashboard-view/`: minimal local worker shipping a runtime-loaded React dashboard view via `dashboardSource`.
