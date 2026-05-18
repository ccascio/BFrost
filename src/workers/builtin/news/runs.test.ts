import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { config } from '../../../config';
import { listNewsRuns, saveNewsRun } from './runs';

test('news runs persist to SQLite and list newest first', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-news-runs-'));
  const previousDbPath = config.appDbPath;
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    await saveNewsRun({
      ranAt: '2026-04-24T08:00:00.000Z',
      fetchedCount: 10,
      articleFetchSuccessCount: 8,
      articleFetchFailureCount: 2,
      sourceQualifiedCount: 5,
      allowlistedCount: 1,
      blockedSourceCount: 2,
      lowScoreRejectedCount: 3,
      queuedCount: 2,
      rejectedCount: 3,
      seenCount: 1,
      nearDuplicateCount: 1,
    });
    await saveNewsRun({
      ranAt: '2026-04-24T09:00:00.000Z',
      fetchedCount: 7,
      articleFetchSuccessCount: 7,
      articleFetchFailureCount: 0,
      sourceQualifiedCount: 6,
      allowlistedCount: 2,
      blockedSourceCount: 0,
      lowScoreRejectedCount: 1,
      queuedCount: 4,
      rejectedCount: 2,
      seenCount: 0,
      nearDuplicateCount: 0,
    });

    const runs = await listNewsRuns(2);
    assert.equal(runs.length, 2);
    assert.equal(runs[0].ranAt, '2026-04-24T09:00:00.000Z');
    assert.equal(runs[0].queuedCount, 4);
    assert.equal(runs[1].ranAt, '2026-04-24T08:00:00.000Z');
  } finally {
    config.appDbPath = previousDbPath;
    await rm(dir, { recursive: true, force: true });
  }
});
