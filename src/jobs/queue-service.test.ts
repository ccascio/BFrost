import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { config } from '../config';
import { closeDb } from '../sqlite';
import { listRecentEvents } from '../event-log';
import { createQueueItem, loadQueue, saveQueue } from './queue';
import { loadQueueSnapshot, updateDashboardQueueItem } from './queue-service';

test('loadQueueSnapshot returns pruned counts and newest items first', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-queue-service-'));
  const previousDir = config.newsStoreDir;
  const previousDbPath = config.appDbPath;
  config.newsStoreDir = dir;
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    await saveQueue([
      createQueueItem({
        title: 'Queued',
        shortDesc: 'Waiting.',
        url: 'https://example.com/queued',
        addedAt: '2026-04-24T08:00:00.000Z',
        state: 'queued',
        stateChangedAt: '2026-04-24T08:00:00.000Z',
      }),
      createQueueItem({
        title: 'Failed',
        shortDesc: 'Will retry.',
        url: 'https://example.com/failed',
        addedAt: '2026-04-24T08:00:00.000Z',
        state: 'failed',
        stateChangedAt: '2026-04-24T09:00:00.000Z',
        attemptCount: 1,
      }),
      createQueueItem({
        title: 'Old',
        shortDesc: 'Expired.',
        url: 'https://example.com/old',
        addedAt: '2026-04-01T08:00:00.000Z',
        state: 'queued',
        stateChangedAt: '2026-04-01T08:00:00.000Z',
      }),
    ]);

    const snapshot = await loadQueueSnapshot(Date.parse('2026-04-24T12:00:00.000Z'));

    assert.equal(snapshot.total, 2);
    assert.equal(snapshot.queued, 1);
    assert.equal(snapshot.failed, 1);
    assert.equal(snapshot.retrying, 1);
    assert.deepEqual(
      snapshot.recentItems.map((item) => item.title),
      ['Failed', 'Queued'],
    );
  } finally {
    config.newsStoreDir = previousDir;
    config.appDbPath = previousDbPath;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});

test('updateDashboardQueueItem persists transition and records an event', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-queue-service-'));
  const previousDir = config.newsStoreDir;
  const previousDbPath = config.appDbPath;
  config.newsStoreDir = dir;
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    const item = createQueueItem({
      title: 'Needs approval',
      shortDesc: 'Dashboard action.',
      url: 'https://example.com/approval',
      addedAt: '2026-04-24T08:00:00.000Z',
      state: 'queued',
      stateChangedAt: '2026-04-24T08:00:00.000Z',
    });
    await saveQueue([item]);

    await updateDashboardQueueItem(item.id, 'approve');

    const queue = await loadQueue();
    assert.equal(queue[0].state, 'approved');

    const events = await listRecentEvents(5);
    assert.equal(events[0].category, 'queue');
    assert.equal(events[0].action, 'approved');
    assert.equal(events[0].metadata.id, item.id);
  } finally {
    config.newsStoreDir = previousDir;
    config.appDbPath = previousDbPath;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});
