import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { config } from '../config';
import { closeDb } from '../sqlite';
import {
  applyConsumerFailure,
  applyConsumerSuccess,
  filterItemsForConsumer,
  listItemsForConsumer,
  publishItem,
  readConsumerMetadata,
  setConsumerMetadata,
} from './item-bus';
import { createQueueItem } from './queue';

function withTempStore<T>(fn: () => Promise<T>): Promise<T> {
  return (async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-bus-'));
    const previousDir = config.newsStoreDir;
    const previousDbPath = config.appDbPath;
    config.newsStoreDir = dir;
    config.appDbPath = path.join(dir, 'app.sqlite');
    try {
      return await fn();
    } finally {
      config.newsStoreDir = previousDir;
      config.appDbPath = previousDbPath;
      closeDb();
      await rm(dir, { recursive: true, force: true });
    }
  })();
}

test('publishItem persists a producer-tagged item with payload', async () => {
  await withTempStore(async () => {
    const created = await publishItem({
      producerWorkerId: 'core.news',
      itemType: 'news.article',
      tags: ['news', 'ai'],
      title: 'Some news',
      shortDesc: 'Short summary.',
      url: 'https://example.com/news/1',
      payload: { source: { host: 'example.com', score: 5 } },
    });

    assert.equal(created.producerWorkerId, 'core.news');
    assert.equal(created.itemType, 'news.article');
    assert.deepEqual(created.tags, ['news', 'ai']);
    assert.equal((created.payload as any).source.host, 'example.com');
    assert.equal(created.state, 'queued');
  });
});

test('filterItemsForConsumer matches itemType, tags, state, and excludeAlreadyHandled', () => {
  const items = [
    createQueueItem({
      title: 'A',
      shortDesc: 'a',
      url: 'https://a.test',
      addedAt: '2026-05-01T00:00:00.000Z',
      state: 'queued',
      stateChangedAt: '2026-05-01T00:00:00.000Z',
      producerWorkerId: 'core.news',
      itemType: 'news.article',
      tags: ['news'],
    }),
    createQueueItem({
      title: 'B',
      shortDesc: 'b',
      url: 'https://b.test',
      addedAt: '2026-05-01T00:00:00.000Z',
      state: 'approved',
      stateChangedAt: '2026-05-01T00:00:00.000Z',
      producerWorkerId: 'core.news',
      itemType: 'news.article',
      tags: ['news', 'breaking'],
      metadata: { 'core.publisher.x': { tweetId: 't_1' } },
    }),
    createQueueItem({
      title: 'C',
      shortDesc: 'c',
      url: 'https://c.test',
      addedAt: '2026-05-01T00:00:00.000Z',
      state: 'queued',
      stateChangedAt: '2026-05-01T00:00:00.000Z',
      producerWorkerId: 'other.producer',
      itemType: 'other.thing',
      tags: ['other'],
    }),
  ];

  const newsForXAll = filterItemsForConsumer(items, 'core.publisher.x', {
    itemType: 'news.article',
  });
  assert.deepEqual(newsForXAll.map((i) => i.title), ['A', 'B']);

  const fresh = filterItemsForConsumer(items, 'core.publisher.x', {
    itemType: 'news.article',
    excludeAlreadyHandled: true,
  });
  assert.deepEqual(fresh.map((i) => i.title), ['A']);

  const queuedOnly = filterItemsForConsumer(items, 'core.publisher.x', {
    itemType: 'news.article',
    states: ['queued'],
  });
  assert.deepEqual(queuedOnly.map((i) => i.title), ['A']);

  const breaking = filterItemsForConsumer(items, 'core.publisher.x', {
    tags: ['breaking'],
  });
  assert.deepEqual(breaking.map((i) => i.title), ['B']);
});

test('setConsumerMetadata namespaces by consumer worker id', () => {
  const item = createQueueItem({
    title: 'x',
    shortDesc: 'x',
    url: 'https://x.test',
    addedAt: '2026-05-01T00:00:00.000Z',
    state: 'queued',
    stateChangedAt: '2026-05-01T00:00:00.000Z',
  });

  setConsumerMetadata(item, 'core.publisher.x', { tweetId: 't_1' });
  setConsumerMetadata(item, 'local.publisher.wordpress', { publishedUrl: 'https://cp.test/a' });
  setConsumerMetadata(item, 'core.publisher.x', { tone: 'serious' });

  assert.deepEqual(readConsumerMetadata(item, 'core.publisher.x'), {
    tweetId: 't_1',
    tone: 'serious',
  });
  assert.deepEqual(readConsumerMetadata(item, 'local.publisher.wordpress'), {
    publishedUrl: 'https://cp.test/a',
  });
});

test('applyConsumerSuccess posts an item and records consumer metadata', () => {
  const item = createQueueItem({
    title: 'post me',
    shortDesc: 'desc',
    url: 'https://post.test',
    addedAt: '2026-05-01T00:00:00.000Z',
    state: 'queued',
    stateChangedAt: '2026-05-01T00:00:00.000Z',
  });

  applyConsumerSuccess(item, 'core.publisher.x', {
    postedId: 't_9',
    postedTone: 'punchy',
    metadata: { tweetId: 't_9', tweetUrl: 'https://x.com/i/status/t_9' },
    nowIso: '2026-05-02T00:00:00.000Z',
  });

  assert.equal(item.state, 'posted');
  assert.equal(readConsumerMetadata<{ tweetId: string }>(item, 'core.publisher.x')?.tweetId, 't_9');
});

test('applyConsumerFailure records failures with consumer metadata', () => {
  const item = createQueueItem({
    title: 'fail me',
    shortDesc: 'desc',
    url: 'https://fail.test',
    addedAt: '2026-05-01T00:00:00.000Z',
    state: 'queued',
    stateChangedAt: '2026-05-01T00:00:00.000Z',
  });

  applyConsumerFailure(item, 'core.publisher.x', {
    errorMessage: 'rate limited',
    maxAttempts: 3,
    metadata: { lastErrorCode: 429 },
    nowIso: '2026-05-02T00:00:00.000Z',
  });

  assert.equal(item.state, 'failed');
  assert.equal(item.attemptCount, 1);
  assert.equal(item.lastError, 'rate limited');
  assert.equal(readConsumerMetadata<{ lastErrorCode: number }>(item, 'core.publisher.x')?.lastErrorCode, 429);
});

test('listItemsForConsumer roundtrips through saveQueue/loadQueue', async () => {
  await withTempStore(async () => {
    await publishItem({
      producerWorkerId: 'core.news',
      itemType: 'news.article',
      tags: ['news'],
      title: 'Hello',
      shortDesc: 'World',
      url: 'https://hello.test/world',
    });
    await publishItem({
      producerWorkerId: 'other',
      itemType: 'other.thing',
      title: 'Skip me',
      shortDesc: 'noop',
      url: 'https://skip.test',
    });

    const newsItems = await listItemsForConsumer('core.publisher.x', { itemType: 'news.article' });
    assert.equal(newsItems.length, 1);
    assert.equal(newsItems[0].title, 'Hello');
  });
});
