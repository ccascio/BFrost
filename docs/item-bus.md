# Item Bus and Per-Worker Storage

BFrost has two persistence surfaces, and they are deliberately separate:

- The **Item Bus** is for cross-worker communication. A producer publishes typed items; one or more consumers subscribe and act on them.
- **Per-worker storage** (`openWorkerKv`, `openWorkerDb`) is for state that belongs to a single worker. Other workers cannot reach it.

Workers reach for the Item Bus when they need to talk to another worker. They reach for storage when they need to remember something privately.

---

## Item Bus

### Item shape

Every item on the bus carries:

| Field | Owner | Purpose |
| --- | --- | --- |
| `id` | bus | Stable, deterministic. |
| `producerWorkerId` | producer | The worker that emitted the item. |
| `itemType` | producer | Dotted name describing the item (`news.article`, `bookmark.saved`). Consumers subscribe by type. |
| `tags` | producer | Free-form labels for finer filtering. |
| `payload` | producer | Producer-owned JSON. Public, read-only from a consumer's perspective. |
| `state` | bus | One of `queued`, `approved`, `posted`, `rejected`, `failed`, `seen`. Today single-terminal; multi-consumer fan-out is on the roadmap. |
| `metadata` | consumers | `Record<consumerWorkerId, Record<string, unknown>>`. Each consumer writes only under its own worker id. |

### Producing an item

```ts
import { publishItem } from 'bfrost';

await publishItem({
  producerWorkerId: 'local.bookmarks',
  itemType: 'bookmark.saved',
  tags: ['bookmark'],
  title: 'How BFrost workers work',
  shortDesc: 'A short summary for the dashboard.',
  url: 'https://example.com/post',
  payload: { source: 'manual', addedBy: 'me' },
});
```

Rules:

- Choose a stable `itemType` namespace: `<workerId-or-domain>.<noun>`. Subscribers depend on it.
- Once published, treat the `payload` shape as a public contract. Add fields freely; remove or rename them with care.
- The `id` is derived from the producer + url + a content fingerprint. Republishing the same content is a no-op.

### Consuming items

```ts
import {
  listItemsForConsumer,
  applyConsumerSuccess,
  applyConsumerFailure,
  setConsumerMetadata,
  readConsumerMetadata,
  withQueueLock,
  loadQueue,
  saveQueue,
} from 'bfrost';

const CONSUMER_ID = 'local.mastodon-publisher';

await withQueueLock(async () => {
  const candidates = await listItemsForConsumer(CONSUMER_ID, {
    itemType: 'news.article',
    states: ['queued', 'approved'],
    excludeAlreadyHandled: true,
  });

  const target = candidates[0];
  if (!target) return;

  try {
    const result = await post(target);
    const queue = await loadQueue();
    const live = queue.find((it) => it.id === target.id)!;
    applyConsumerSuccess(live, CONSUMER_ID, {
      transition: 'posted',
      metadata: { externalId: result.id, externalUrl: result.url },
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
```

### Namespacing rules

- A consumer writes **only** into `metadata[<its-own-workerId>]`. Never mutate another worker's namespace — treat it as private.
- Reading another worker's metadata via `readConsumerMetadata` is allowed and expected (e.g. an X publisher reading a WordPress publisher's article URL so it can attach the published link to its tweet).
- Reading the producer's `payload` is always fine — it's public by design.

### Locking

`withQueueLock` serialises queue mutations across the process. Always:

1. Acquire the lock.
2. List candidates (the snapshot may be stale — that's fine for selection).
3. Reload the queue inside the lock before applying outcomes.
4. Save and release.

Skipping the reload is a race waiting to happen.

### State and fan-out

Today the queue has a single terminal `state`. The first consumer to transition the item to `posted` "wins" the item; secondary consumers should agree by convention which one owns the terminal transition. Multi-consumer fan-out (independent terminal states per consumer) is a planned extension.

---

## Per-Worker Storage

### Key-Value (`openWorkerKv`)

For small, opaque values: cursors, last-run timestamps, feature flags.

```ts
import { openWorkerKv } from 'bfrost';

const kv = openWorkerKv('local.my-worker');

await kv.set('last-run-at', { iso: new Date().toISOString() });
const last = await kv.get<{ iso: string }>('last-run-at');
await kv.clear('last-run-at');
```

Keys are stored under `worker.<workerId>.<key>` in the shared SQLite KV. Two workers cannot collide. The shared backup carries every worker's KV state.

### SQLite Tables (`openWorkerDb`)

For structured state — queues, caches, indexes.

```ts
import { openWorkerDb } from 'bfrost';

interface Memo extends Record<string, unknown> {
  id: string;
  content: string;
  pinned?: number;
  created_at: string;
}

const db = await openWorkerDb('local.my-worker');

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

Tables are physically created as `worker_<safeWorkerId>_<localName>`; the worker only ever sees its own handles.

### Migration rules

- `defineTable` is **idempotent**. Calling it again with extra columns runs `ALTER TABLE ADD COLUMN` for the new ones.
- Renames and drops are not supported by `defineTable`. Do them explicitly in `onMigrate` — see the lifecycle section of `workers/README.md`.
- The `raw()` helper substitutes `${table}` with the prefixed name. You can join across your own tables; you cannot reach another worker's tables.

### Trust boundary

These APIs trust the worker author. A local worker running Node code on the host can bypass the prefix and read another worker's tables directly. The prefix is for hygiene, isolation in the dashboard, and clean backup ergonomics — it is not a security boundary today. Sandboxing arrives with the permissioned action runtime (Workstream 5).

---

## Quick reference

| Need | Reach for |
| --- | --- |
| Send work to another worker | `publishItem` |
| Pick up work from another worker | `listItemsForConsumer` + `applyConsumerSuccess` / `Failure` |
| Read another consumer's outcome | `readConsumerMetadata` |
| Remember something small and private | `openWorkerKv` |
| Remember something structured and private | `openWorkerDb` + `defineTable` |
| Coordinate with another consumer on a shared item | Read its `metadata` via `readConsumerMetadata`; don't write to it |
| Mutate the queue | Always inside `withQueueLock` |
