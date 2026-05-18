import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { config } from './config';
import {
  approveQueueItem,
  createQueueItem,
  loadQueue,
  markQueueItemDuplicateRejected,
  markQueueItemPostFailed,
  markQueueItemPosted,
  pruneQueue,
  queuePath,
  rejectQueueItem,
  saveQueue,
} from './jobs/queue';

test('loadQueue normalizes legacy queued items', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-queue-'));
  const previousDir = config.newsStoreDir;
  const previousDbPath = config.appDbPath;
  config.newsStoreDir = dir;
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
    config.newsStoreDir = previousDir;
    config.appDbPath = previousDbPath;
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
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-queue-'));
  const previousDir = config.newsStoreDir;
  const previousDbPath = config.appDbPath;
  config.newsStoreDir = path.join(dir, 'nested', 'news');
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    await saveQueue([]);
    assert.deepEqual(await loadQueue(), []);
  } finally {
    config.newsStoreDir = previousDir;
    config.appDbPath = previousDbPath;
    await rm(dir, { recursive: true, force: true });
  }
});

test('loadQueue surfaces invalid queue files instead of returning an empty queue', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-queue-'));
  const previousDir = config.newsStoreDir;
  const previousDbPath = config.appDbPath;
  config.newsStoreDir = dir;
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    await writeFile(queuePath(), '{not valid json', 'utf8');
    await assert.rejects(() => loadQueue(), /Failed to read/);
  } finally {
    config.newsStoreDir = previousDir;
    config.appDbPath = previousDbPath;
    await rm(dir, { recursive: true, force: true });
  }
});
