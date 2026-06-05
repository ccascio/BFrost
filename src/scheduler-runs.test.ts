import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { config } from './config';
import { closeDb } from './sqlite';
import {
  abandonRunningSchedulerRuns,
  finishSchedulerRun,
  listSchedulerRuns,
  startSchedulerRun,
} from './scheduler-runs';

test('scheduler runs persist start and finish records', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-scheduler-runs-'));
  const previousDbPath = config.appDbPath;
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    const run = await startSchedulerRun({
      job: 'news-digest',
      label: 'News Digest',
      trigger: 'manual',
      modelAlias: 'local-model',
      startedAt: '2026-04-24T08:00:00.000Z',
    });

    assert.equal(run.status, 'running');
    assert.equal(run.finishedAt, null);

    await finishSchedulerRun(run.id, {
      finishedAt: '2026-04-24T08:01:30.000Z',
      status: 'success',
      summary: 'News digest completed.',
      itemCount: 3,
    });

    const runs = await listSchedulerRuns();
    assert.equal(runs.length, 1);
    assert.equal(runs[0].job, 'news-digest');
    assert.equal(runs[0].status, 'success');
    assert.equal(runs[0].summary, 'News digest completed.');
    assert.equal(runs[0].itemCount, 3);
  } finally {
    config.appDbPath = previousDbPath;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});

test('scheduler runs list newest first', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-scheduler-runs-'));
  const previousDbPath = config.appDbPath;
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    await startSchedulerRun({
      job: 'tweet-post',
      label: 'Tweet Post',
      trigger: 'schedule',
      modelAlias: 'local-model',
      startedAt: '2026-04-24T08:00:00.000Z',
    });
    await startSchedulerRun({
      job: 'personal-research',
      label: 'Personal Research',
      trigger: 'manual',
      modelAlias: 'local-model',
      startedAt: '2026-04-24T09:00:00.000Z',
    });

    const runs = await listSchedulerRuns();
    assert.deepEqual(
      runs.map((run) => run.job),
      ['personal-research', 'tweet-post'],
    );
  } finally {
    config.appDbPath = previousDbPath;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});

test('scheduler runs can reconcile abandoned running records', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-scheduler-runs-'));
  const previousDbPath = config.appDbPath;
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    await startSchedulerRun({
      job: 'news-digest',
      label: 'News Digest',
      trigger: 'schedule',
      modelAlias: 'local-model',
      startedAt: '2026-04-24T08:00:00.000Z',
    });
    const completed = await startSchedulerRun({
      job: 'tweet-post',
      label: 'Tweet Post',
      trigger: 'schedule',
      modelAlias: 'local-model',
      startedAt: '2026-04-24T09:00:00.000Z',
    });
    await finishSchedulerRun(completed.id, {
      finishedAt: '2026-04-24T09:00:03.000Z',
      status: 'success',
      summary: 'Tweet posted.',
    });

    const result = await abandonRunningSchedulerRuns({
      finishedAt: '2026-04-24T10:00:00.000Z',
      error: 'BFrost stopped before this scheduler run finished.',
    });

    assert.equal(result.count, 1);
    assert.deepEqual(result.abandoned, [
      {
        job: 'news-digest',
        label: 'News Digest',
        startedAt: '2026-04-24T08:00:00.000Z',
      },
    ]);
    const runs = await listSchedulerRuns();
    const abandoned = runs.find((run) => run.job === 'news-digest');
    assert.ok(abandoned);
    assert.equal(abandoned.status, 'error');
    assert.equal(abandoned.finishedAt, '2026-04-24T10:00:00.000Z');
    assert.equal(abandoned.error, 'BFrost stopped before this scheduler run finished.');
    assert.equal(runs.find((run) => run.job === 'tweet-post')?.status, 'success');
  } finally {
    config.appDbPath = previousDbPath;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});
