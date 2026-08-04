import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { config } from './config';
import { closeDb, getAppDb } from './sqlite';
import {
  approveQueueItem,
  createQueueItem,
  deleteQueueItems,
  insertQueueItem,
  loadQueue,
  markQueueItemDuplicateRejected,
  markQueueItemPostFailed,
  markQueueItemPosted,
  pruneQueue,
  queryQueue,
  queuePath,
  reapExpiredQueueItems,
  rejectQueueItem,
  saveQueue,
  upsertQueueItems,
  withQueueLock,
} from './jobs/queue';
import { loadKvJson, saveKvJson } from './sqlite';

async function assertNormalizedBusRows(expected: number): Promise<void> {
  const db = await getAppDb();
  const row = db.prepare('SELECT count(*) AS count FROM item_bus_items').get() as { count: number };
  assert.equal(row.count, expected);
  assert.equal(await loadKvJson('item-bus.queue'), null, 'the monolithic legacy blob must be removed');
}

test('loadQueue normalizes legacy queued items', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'BFrost-queue-'));
  const previousDir = config.itemBusStoreDir;
  const previousDbPath = config.appDbPath;
  config.itemBusStoreDir = dir;
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    await writeFile(
      queuePath(),
      JSON.stringify([
        {
          title: 'Example',
          shortDesc: 'A useful item.',
          url: 'https://example.com/story',
          addedAt: '2026-04-24T08:00:00.000Z',
        },
      ]),
      'utf8',
    );

    const queue = await loadQueue();
    assert.equal(queue.length, 1);
    assert.match(queue[0].id, /^q_[a-f0-9]{18}$/);
    assert.equal(queue[0].state, 'queued');
    assert.equal(queue[0].stateChangedAt, queue[0].addedAt);
  } finally {
    config.itemBusStoreDir = previousDir;
    config.appDbPath = previousDbPath;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});

test('loadQueue migrates a legacy KV queue into the Item Bus store', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'BFrost-queue-'));
  const previousDir = config.itemBusStoreDir;
  const previousDbPath = config.appDbPath;
  config.itemBusStoreDir = path.join(dir, 'item-bus');
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    await saveKvJson('legacy.queue', [
      {
        title: 'From legacy KV',
        shortDesc: 'Migrated into the generic bus.',
        url: 'https://example.com/legacy-kv',
        addedAt: '2026-04-24T08:00:00.000Z',
      },
    ]);

    const queue = await loadQueue();

    assert.equal(queue.length, 1);
    assert.equal(queue[0].title, 'From legacy KV');
    assert.equal(queue[0].state, 'queued');
    await assertNormalizedBusRows(1);
  } finally {
    config.itemBusStoreDir = previousDir;
    config.appDbPath = previousDbPath;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});

test('loadQueue atomically normalizes the former item-bus.queue blob', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'BFrost-queue-'));
  const previousDir = config.itemBusStoreDir;
  const previousDbPath = config.appDbPath;
  config.itemBusStoreDir = path.join(dir, 'item-bus');
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    await saveKvJson('item-bus.queue', [
      {
        id: 'q_normalize_me',
        title: 'Normalize me',
        shortDesc: 'Stored as one large JSON blob by the previous release.',
        url: 'https://example.com/normalize-me',
        addedAt: '2026-04-24T08:00:00.000Z',
        state: 'approved',
        stateChangedAt: '2026-04-24T08:00:00.000Z',
        producerWorkerId: 'test.producer',
        itemType: 'test.large',
        payload: { body: 'large payload' },
      },
    ]);

    const queue = await loadQueue();

    assert.deepEqual(queue.map((item) => item.id), ['q_normalize_me']);
    await assertNormalizedBusRows(1);
  } finally {
    config.itemBusStoreDir = previousDir;
    config.appDbPath = previousDbPath;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});

test('queryQueue treats explicit empty filters as matching no items', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'BFrost-queue-'));
  const previousDir = config.itemBusStoreDir;
  const previousDbPath = config.appDbPath;
  config.itemBusStoreDir = path.join(dir, 'item-bus');
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    await saveQueue([createQueueItem({
      id: 'q_present',
      title: 'Present',
      shortDesc: 'Must not leak through an empty filter.',
      url: 'https://example.com/present',
      addedAt: '2026-04-24T08:00:00.000Z',
      state: 'queued',
      stateChangedAt: '2026-04-24T08:00:00.000Z',
    })]);

    assert.deepEqual(await queryQueue({ ids: [] }), []);
    assert.deepEqual(await queryQueue({ itemTypes: [] }), []);
    assert.deepEqual(await queryQueue({ states: [] }), []);
  } finally {
    config.itemBusStoreDir = previousDir;
    config.appDbPath = previousDbPath;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});

test('loadQueue migrates a legacy sibling queue file into the Item Bus store', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'BFrost-queue-'));
  const previousDir = config.itemBusStoreDir;
  const previousDbPath = config.appDbPath;
  config.itemBusStoreDir = path.join(dir, 'item-bus');
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    const legacyDir = path.join(dir, 'old-bucket');
    await mkdir(legacyDir, { recursive: true });
    await writeFile(
      path.join(legacyDir, 'queue.json'),
      JSON.stringify([
        {
          title: 'From legacy file',
          shortDesc: 'Migrated from an older queue bucket.',
          url: 'https://example.com/legacy-file',
          addedAt: '2026-04-24T08:00:00.000Z',
        },
      ]),
      'utf8',
    );

    const queue = await loadQueue();

    assert.equal(queue.length, 1);
    assert.equal(queue[0].title, 'From legacy file');
    assert.equal(queue[0].state, 'queued');
    await assertNormalizedBusRows(1);
  } finally {
    config.itemBusStoreDir = previousDir;
    config.appDbPath = previousDbPath;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});

test('pruneQueue removes stale items and keeps recent items', () => {
  const now = Date.parse('2026-04-24T12:00:00.000Z');
  const queue = pruneQueue(
    [
      {
        id: 'q_recent',
        title: 'Recent',
        shortDesc: 'Still relevant.',
        url: 'https://example.com/recent',
        addedAt: '2026-04-24T08:00:00.000Z',
        state: 'queued',
        stateChangedAt: '2026-04-24T08:00:00.000Z',
      },
      {
        id: 'q_old',
        title: 'Old',
        shortDesc: 'Too old.',
        url: 'https://example.com/old',
        addedAt: '2026-04-01T08:00:00.000Z',
        state: 'queued',
        stateChangedAt: '2026-04-01T08:00:00.000Z',
      },
    ],
    now,
  );

  assert.deepEqual(
    queue.map((item) => item.title),
    ['Recent'],
  );
});

test('queue transition helpers approve and reject by stable id', () => {
  const queue = [
    createQueueItem({
      title: 'Needs Review',
      shortDesc: 'Awaiting approval.',
      url: 'https://example.com/review',
      addedAt: '2026-04-24T08:00:00.000Z',
      state: 'queued',
      stateChangedAt: '2026-04-24T08:00:00.000Z',
    }),
  ];

  approveQueueItem(queue, queue[0].id, '2026-04-24T09:00:00.000Z');
  assert.equal(queue[0].state, 'approved');
  assert.equal(queue[0].stateChangedAt, '2026-04-24T09:00:00.000Z');

  rejectQueueItem(queue, queue[0].id, '2026-04-24T10:00:00.000Z');
  assert.equal(queue[0].state, 'rejected');
  assert.equal(queue[0].rejectionReason, 'Rejected from the dashboard.');
});

test('queue transition helpers mark successful posts', () => {
  const item = createQueueItem({
    title: 'Ready',
    shortDesc: 'Approved for posting.',
    url: 'https://example.com/ready',
    addedAt: '2026-04-24T08:00:00.000Z',
    state: 'approved',
    stateChangedAt: '2026-04-24T08:00:00.000Z',
  });

  markQueueItemPosted(item, 'Published downstream.', '2026-04-24T09:00:00.000Z');

  assert.equal(item.state, 'posted');
  assert.equal(item.postedAt, '2026-04-24T09:00:00.000Z');
  assert.equal(item.stateReason, 'Published downstream.');
  assert.equal(item.lastAttemptAt, '2026-04-24T09:00:00.000Z');
  assert.equal(item.lastError, undefined);
});

test('queue items carry producer payload through the Item Bus contract', () => {
  const item = createQueueItem({
    title: 'Provenance',
    shortDesc: 'Carries source metadata.',
    url: 'https://example.com/provenance',
    addedAt: '2026-04-24T08:00:00.000Z',
    state: 'queued',
    stateChangedAt: '2026-04-24T08:00:00.000Z',
    producerWorkerId: 'core.news',
    itemType: 'news.article',
    payload: {
      digestRunId: '2026-04-24T08-00-00-000Z.json',
      source: {
        host: 'example.com',
        score: 4,
        label: 'high',
        reasons: ['Preferred host: example.com.'],
      },
      article: {
        fetched: true,
        title: 'Article title',
        description: 'Article description.',
        excerpt: 'Article body excerpt.',
        finalUrl: 'https://example.com/final',
      },
    },
  });

  const payload = item.payload as any;
  assert.equal(item.producerWorkerId, 'core.news');
  assert.equal(item.itemType, 'news.article');
  assert.equal(payload.source.host, 'example.com');
  assert.equal(payload.source.score, 4);
  assert.equal(payload.source.label, 'high');
  assert.deepEqual(payload.source.reasons, ['Preferred host: example.com.']);
  assert.equal(payload.article.fetched, true);
  assert.equal(payload.article.finalUrl, 'https://example.com/final');
  assert.equal(payload.digestRunId, '2026-04-24T08-00-00-000Z.json');
});

test('queue transition helpers mark duplicate post rejections', () => {
  const item = createQueueItem({
    title: 'Duplicate',
    shortDesc: 'X will reject this.',
    url: 'https://example.com/duplicate',
    addedAt: '2026-04-24T08:00:00.000Z',
    state: 'approved',
    stateChangedAt: '2026-04-24T08:00:00.000Z',
  });

  markQueueItemDuplicateRejected(item, 'duplicate content', 3, '2026-04-24T09:00:00.000Z');

  assert.equal(item.state, 'rejected');
  assert.equal(item.attemptCount, 3);
  assert.equal(item.lastAttemptAt, '2026-04-24T09:00:00.000Z');
  assert.equal(item.lastError, 'duplicate content');
  assert.equal(item.rejectionReason, 'X rejected the generated post as duplicate content.');
});

test('queue transition helpers mark retryable and permanent post failures', () => {
  const item = createQueueItem({
    title: 'Flaky',
    shortDesc: 'Posting may fail.',
    url: 'https://example.com/flaky',
    addedAt: '2026-04-24T08:00:00.000Z',
    state: 'approved',
    stateChangedAt: '2026-04-24T08:00:00.000Z',
  });

  markQueueItemPostFailed(item, 'network error', 2, '2026-04-24T09:00:00.000Z');

  assert.equal(item.state, 'failed');
  assert.equal(item.attemptCount, 1);
  assert.equal(item.stateReason, 'Posting failed on attempt 1: network error');

  markQueueItemPostFailed(item, 'still down', 2, '2026-04-24T10:00:00.000Z');

  assert.equal(item.state, 'failed');
  assert.equal(item.attemptCount, 2);
  assert.equal(item.lastAttemptAt, '2026-04-24T10:00:00.000Z');
  assert.equal(item.stateReason, 'Posting failed permanently after 2 attempts: still down');
});

test('saveQueue creates the configured queue directory', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'BFrost-queue-'));
  const previousDir = config.itemBusStoreDir;
  const previousDbPath = config.appDbPath;
  config.itemBusStoreDir = path.join(dir, 'nested', 'news');
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    await saveQueue([]);
    assert.deepEqual(await loadQueue(), []);
  } finally {
    config.itemBusStoreDir = previousDir;
    config.appDbPath = previousDbPath;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});

test('loadQueue surfaces invalid queue files instead of returning an empty queue', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'BFrost-queue-'));
  const previousDir = config.itemBusStoreDir;
  const previousDbPath = config.appDbPath;
  config.itemBusStoreDir = dir;
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    await writeFile(queuePath(), '{not valid json', 'utf8');
    await assert.rejects(() => loadQueue(), /Failed to read/);
  } finally {
    config.itemBusStoreDir = previousDir;
    config.appDbPath = previousDbPath;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});

test('concurrent in-process queue-lock holders serialise instead of failing', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'BFrost-queue-lock-'));
  const previousDir = config.itemBusStoreDir;
  const previousDbPath = config.appDbPath;
  config.itemBusStoreDir = dir;
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    // Jobs run concurrently now, so several holders contend for the one queue file. The
    // old fail-fast lock rejected every loser outright ("another job may be running"),
    // which surfaced as spurious worker failures rather than as waiting.
    let concurrent = 0;
    let maxConcurrent = 0;
    const order: number[] = [];
    await Promise.all(
      [0, 1, 2, 3, 4].map((i) =>
        withQueueLock(async () => {
          concurrent += 1;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          order.push(i);
          await new Promise((resolve) => setTimeout(resolve, 5));
          concurrent -= 1;
        }),
      ),
    );

    assert.equal(maxConcurrent, 1, 'the lock must grant exclusive access');
    assert.deepEqual(order, [0, 1, 2, 3, 4], 'admission is FIFO, so no caller is starved');
  } finally {
    closeDb();
    config.itemBusStoreDir = previousDir;
    config.appDbPath = previousDbPath;
    await rm(dir, { recursive: true, force: true });
  }
});

test('a failing queue-lock body still releases the lock for the next waiter', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'BFrost-queue-lock-fail-'));
  const previousDir = config.itemBusStoreDir;
  const previousDbPath = config.appDbPath;
  config.itemBusStoreDir = dir;
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    const failing = withQueueLock(async () => { throw new Error('body exploded'); });
    const follower = withQueueLock(async () => 'ran');
    await assert.rejects(() => failing, /body exploded/);
    assert.equal(await follower, 'ran', 'one bad body must not wedge the queue');
  } finally {
    closeDb();
    config.itemBusStoreDir = previousDir;
    config.appDbPath = previousDbPath;
    await rm(dir, { recursive: true, force: true });
  }
});

test('a re-entrant queue-lock call passes through instead of deadlocking', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'BFrost-queue-lock-reentrant-'));
  const previousDir = config.itemBusStoreDir;
  const previousDbPath = config.appDbPath;
  config.itemBusStoreDir = dir;
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    // Nesting is a bug, but now that the lock waits it would hang rather than throw.
    // The caller already holds exclusive access, so the inner body simply runs.
    const result = await withQueueLock(async () => withQueueLock(async () => 'inner ran'));
    assert.equal(result, 'inner ran');
  } finally {
    closeDb();
    config.itemBusStoreDir = previousDir;
    config.appDbPath = previousDbPath;
    await rm(dir, { recursive: true, force: true });
  }
});

test('raw row writers reject calls outside withQueueLock', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'BFrost-queue-writer-guard-'));
  const previousDir = config.itemBusStoreDir;
  const previousDbPath = config.appDbPath;
  config.itemBusStoreDir = dir;
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    await saveQueue([]);
    const item = createQueueItem({
      id: 'q_guarded_writer',
      title: 'Guarded writer',
      shortDesc: 'Raw row writes require exclusive queue ownership.',
      url: 'https://example.com/guarded-writer',
      addedAt: '2026-07-25T00:00:00.000Z',
      state: 'approved',
      stateChangedAt: '2026-07-25T00:00:00.000Z',
    });

    await assert.rejects(() => insertQueueItem(item), /requires withQueueLock/);
    await assert.rejects(() => upsertQueueItems([item]), /requires withQueueLock/);
    await assert.rejects(() => deleteQueueItems([item.id]), /requires withQueueLock/);

    await withQueueLock(async () => {
      assert.equal((await insertQueueItem(item)).inserted, true);
      item.stateReason = 'Safely updated while holding the lock.';
      await upsertQueueItems([item]);
      assert.equal(await deleteQueueItems([item.id]), 1);
    });
  } finally {
    closeDb();
    config.itemBusStoreDir = previousDir;
    config.appDbPath = previousDbPath;
    await rm(dir, { recursive: true, force: true });
  }
});

test('reapExpiredQueueItems physically deletes stale rows without touching active rows', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'BFrost-queue-reaper-'));
  const previousDir = config.itemBusStoreDir;
  const previousDbPath = config.appDbPath;
  config.itemBusStoreDir = dir;
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    const make = (id: string, stateChangedAt: string) => createQueueItem({
      id,
      title: id,
      shortDesc: `${id} lifecycle`,
      url: `https://example.com/${id}`,
      addedAt: stateChangedAt,
      state: 'approved',
      stateChangedAt,
      payload: { body: 'The reaper does not need to parse this payload.' },
    });
    await saveQueue([
      make('q_stale', '2026-07-17T00:00:00.000Z'),
      make('q_active', '2026-07-20T00:00:00.001Z'),
      make('q_invalid_anchor', 'not-a-date'),
    ]);

    assert.equal(await reapExpiredQueueItems(Date.parse('2026-07-27T00:00:00.000Z')), 2);
    assert.deepEqual((await loadQueue()).map((item) => item.id), ['q_active']);
  } finally {
    closeDb();
    config.itemBusStoreDir = previousDir;
    config.appDbPath = previousDbPath;
    await rm(dir, { recursive: true, force: true });
  }
});
