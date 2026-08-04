import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { config } from '../config';
import { closeDb } from '../sqlite';
import {
  createQueueItem,
  invalidateQueueReadCache,
  loadQueue,
  loadQueueForRead,
  saveQueue,
  type QueueItem,
} from './queue';

function itemNamed(title: string): QueueItem {
  return createQueueItem({
    title,
    shortDesc: `${title} description.`,
    url: `https://example.com/${encodeURIComponent(title)}`,
    addedAt: '2026-04-24T08:00:00.000Z',
    state: 'queued',
    stateChangedAt: '2026-04-24T08:00:00.000Z',
  });
}

async function withTempStore(run: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'BFrost-queue-cache-'));
  const previousDir = config.itemBusStoreDir;
  const previousDbPath = config.appDbPath;
  config.itemBusStoreDir = dir;
  config.appDbPath = path.join(dir, 'app.sqlite');
  invalidateQueueReadCache();

  try {
    await run();
  } finally {
    config.itemBusStoreDir = previousDir;
    config.appDbPath = previousDbPath;
    invalidateQueueReadCache();
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
}

test('loadQueueForRead serves repeat readers the same array without re-parsing', async () => {
  await withTempStore(async () => {
    await saveQueue([itemNamed('Shared')]);

    const first = await loadQueueForRead();
    const second = await loadQueueForRead();

    // Identity, not just equality: sharing one array is the whole point — a private copy per
    // reader is what drove the resident set.
    assert.equal(first, second);
    assert.equal(first.length, 1);
  });
});

test('loadQueue keeps handing mutators a private array', async () => {
  await withTempStore(async () => {
    await saveQueue([itemNamed('Private')]);

    const cached = await loadQueueForRead();
    const mutable = await loadQueue();

    assert.notEqual(cached, mutable);
    // Mutating a `loadQueue` result must not reach into the shared read cache — mutators edit
    // items in place, so a shared reference would leak uncommitted edits to every reader.
    mutable[0].state = 'approved';
    assert.equal(cached[0].state, 'queued');
  });
});

test('saveQueue drops the read cache so the next reader sees the write', async () => {
  await withTempStore(async () => {
    await saveQueue([itemNamed('Before')]);
    const before = await loadQueueForRead();
    assert.equal(before.length, 1);

    await saveQueue([itemNamed('Before'), itemNamed('After')]);

    const after = await loadQueueForRead();
    assert.equal(after.length, 2);
    assert.notEqual(before, after);
  });
});

test('a reader piggybacking on an in-flight read cannot cache rows a save superseded', async () => {
  await withTempStore(async () => {
    await saveQueue([itemNamed('Original')]);

    // All three start in the same tick, deliberately un-awaited: reader A creates the
    // in-flight promise, `saveQueue` bumps the generation synchronously before its first
    // await, and reader B then piggybacks on A's promise while it is still pending. Awaiting
    // the save here instead would let A resolve first and no piggyback would occur.
    const readerA = loadQueueForRead();
    const save = saveQueue([itemNamed('Original'), itemNamed('Added mid-read')]);
    // Reader B arrives after the generation bump but must inherit A's generation, not the
    // post-save one, or it seeds the cache with rows that predate the save — stale until some
    // later write happens to clear it.
    const readerB = loadQueueForRead();

    await Promise.all([readerA, save, readerB]);

    const next = await loadQueueForRead();
    assert.equal(next.length, 2, 'cache served rows that predate the mid-read save');
    assert.ok(next.some((item) => item.title === 'Added mid-read'));
  });
});

test('the read cache does not leak across a database path swap', async () => {
  await withTempStore(async () => {
    await saveQueue([itemNamed('First db')]);
    const first = await loadQueueForRead();
    assert.equal(first.length, 1);

    // Repoint storage without invalidating, the way a test harness swapping temp databases
    // would. The cache keys on the path, so it must refuse to serve the previous db's rows.
    const otherDir = await mkdtemp(path.join(os.tmpdir(), 'BFrost-queue-cache-alt-'));
    const previousDbPath = config.appDbPath;
    config.appDbPath = path.join(otherDir, 'app.sqlite');
    closeDb();

    try {
      await saveQueue([itemNamed('Second db'), itemNamed('Second db extra')]);
      const second = await loadQueueForRead();
      assert.equal(second.length, 2);
      assert.equal(second[0].title, 'Second db');
    } finally {
      config.appDbPath = previousDbPath;
      closeDb();
      await rm(otherDir, { recursive: true, force: true });
    }
  });
});

test('saveQueue collapses items that share an id, keeping the newer and unioning metadata', async () => {
  await withTempStore(async () => {
    // Same deterministic id (same producer fact), published twice a minute apart with a
    // different consumer's handled-stamp on each copy — the shape of the real ownership incident.
    const older = createQueueItem({
      id: 'q_ownership_acn_2eba50654ec7',
      title: 'ACN ownership',
      shortDesc: 'older copy',
      url: 'https://example.com/acn',
      addedAt: '2026-07-17T00:31:37.500Z',
      state: 'approved',
      stateChangedAt: '2026-07-17T00:31:37.500Z',
      producerWorkerId: 'desk.ownership',
      itemType: 'finance.ownership',
      metadata: { 'desk.profiler': { handledAt: '2026-07-17T00:31:40.000Z' } },
    });
    const newer = createQueueItem({
      id: 'q_ownership_acn_2eba50654ec7',
      title: 'ACN ownership',
      shortDesc: 'newer copy',
      url: 'https://example.com/acn',
      addedAt: '2026-07-17T00:32:36.916Z',
      state: 'approved',
      stateChangedAt: '2026-07-17T00:32:36.916Z',
      producerWorkerId: 'desk.ownership',
      itemType: 'finance.ownership',
      metadata: { 'desk.quant': { handledAt: '2026-07-17T00:32:40.000Z' } },
    });

    await saveQueue([older, newer]);
    const stored = await loadQueue();

    assert.equal(stored.length, 1, 'the two same-id rows collapse to one');
    const [item] = stored;
    assert.equal(item.shortDesc, 'newer copy', 'the newer row wins the scalar fields');
    assert.equal(item.addedAt, '2026-07-17T00:32:36.916Z');
    // Neither consumer's handled-stamp may be dropped — losing one would re-process the item.
    assert.ok(item.metadata?.['desk.profiler'], 'the older copy\'s stamp survives the merge');
    assert.ok(item.metadata?.['desk.quant'], 'the newer copy\'s stamp survives the merge');
  });
});

test('saveQueue metadata merge lets the newer copy win a shared consumer namespace', async () => {
  await withTempStore(async () => {
    const base = {
      id: 'q_dup_shared',
      title: 'Dup', shortDesc: 'x', url: 'https://example.com/dup',
      state: 'approved' as const,
      producerWorkerId: 'desk.ownership', itemType: 'finance.ownership',
    };
    const older = createQueueItem({ ...base, addedAt: '2026-07-17T00:00:00.000Z', stateChangedAt: '2026-07-17T00:00:00.000Z', metadata: { 'desk.quant': { note: 'old' } } });
    const newer = createQueueItem({ ...base, addedAt: '2026-07-17T01:00:00.000Z', stateChangedAt: '2026-07-17T01:00:00.000Z', metadata: { 'desk.quant': { note: 'new' } } });

    await saveQueue([older, newer]);
    const [item] = await loadQueue();

    assert.equal((item.metadata?.['desk.quant'] as { note?: string })?.note, 'new', 'the newer copy wins a shared consumer');
  });
});

test('saveQueue preserves the position of the first occurrence of each id', async () => {
  await withTempStore(async () => {
    const a = itemNamed('A');
    const dup1 = createQueueItem({ id: 'q_dup', title: 'D', shortDesc: 'x', url: 'https://example.com/d', addedAt: '2026-07-17T00:00:00.000Z', state: 'queued', stateChangedAt: '2026-07-17T00:00:00.000Z' });
    const c = itemNamed('C');
    const dup2 = createQueueItem({ id: 'q_dup', title: 'D', shortDesc: 'x', url: 'https://example.com/d', addedAt: '2026-07-17T02:00:00.000Z', state: 'queued', stateChangedAt: '2026-07-17T02:00:00.000Z' });

    await saveQueue([a, dup1, c, dup2]);
    const stored = await loadQueue();

    assert.deepEqual(stored.map((i) => i.title), ['A', 'D', 'C'], 'order stays stable; the id keeps its first slot');
  });
});
