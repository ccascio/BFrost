import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { config } from './config';
import { closeDb } from './sqlite';
import { acquireSchedulerExecutionLock, schedulerExecutionLockKey } from './scheduler-locks';

test('scheduler execution locks allow only one owner per command and scheduled time', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-scheduler-locks-'));
  const previousDbPath = config.appDbPath;
  config.appDbPath = path.join(dir, 'app.sqlite');

  // Slots must stay inside the lock retention window, so derive them from now.
  const slotA = new Date().toISOString();
  const slotB = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  try {
    const first = await acquireSchedulerExecutionLock({
      commandKey: 'job:news-digest',
      scheduledAt: slotA,
    });
    const duplicate = await acquireSchedulerExecutionLock({
      commandKey: 'job:news-digest',
      scheduledAt: slotA,
    });
    const nextSlot = await acquireSchedulerExecutionLock({
      commandKey: 'job:news-digest',
      scheduledAt: slotB,
    });
    const differentCommand = await acquireSchedulerExecutionLock({
      commandKey: 'job:tweet-post',
      scheduledAt: slotA,
    });

    assert.equal(first, true);
    assert.equal(duplicate, false);
    assert.equal(nextSlot, true);
    assert.equal(differentCommand, true);
  } finally {
    config.appDbPath = previousDbPath;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});

test('scheduler execution lock keys are stable command slots', () => {
  assert.equal(
    schedulerExecutionLockKey('job:news-digest', '2026-05-21T22:00:00.000Z'),
    'job:news-digest@2026-05-21T22:00:00.000Z',
  );
});
