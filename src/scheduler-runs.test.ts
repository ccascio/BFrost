import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CronRunsSectionSchema } from './admin-api';
import { config } from './config';
import { closeDb } from './sqlite';
import {
  abandonRunningSchedulerRuns,
  dismissSkippedSchedulerRun,
  dismissSkippedScheduledRunsForJobs,
  finishSchedulerRun,
  listSkippedScheduledRuns,
  listSchedulerRuns,
  recordMissedScheduledRun,
  recordSchedulerRunAttempt,
  startSchedulerRun,
} from './scheduler-runs';

test('scheduler runs persist start and finish records', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'BFrost-scheduler-runs-'));
  const previousDbPath = config.appDbPath;
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    const run = await startSchedulerRun({
      job: 'finance-news-scan',
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
    assert.equal(runs[0].job, 'finance-news-scan');
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
  const dir = await mkdtemp(path.join(os.tmpdir(), 'BFrost-scheduler-runs-'));
  const previousDbPath = config.appDbPath;
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    await startSchedulerRun({
      job: 'ops-digest',
      label: 'Ops Digest',
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
      ['personal-research', 'ops-digest'],
    );
  } finally {
    config.appDbPath = previousDbPath;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});

test('operators can dismiss a skipped scheduled run without deleting other history', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'BFrost-scheduler-runs-'));
  const previousDbPath = config.appDbPath;
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    const skipped = await startSchedulerRun({
      job: 'finance-news-scan',
      label: 'News Digest',
      trigger: 'schedule',
      modelAlias: '',
      startedAt: '2026-04-24T08:00:00.000Z',
    });
    await finishSchedulerRun(skipped.id, {
      finishedAt: '2026-04-24T08:01:00.000Z',
      status: 'skipped',
      error: 'Automatic recovery is disabled.',
      skipReason: 'missed',
    });
    const retained = await startSchedulerRun({
      job: 'ops-digest',
      label: 'Ops Digest',
      trigger: 'manual',
      modelAlias: '',
      startedAt: '2026-04-24T09:00:00.000Z',
    });
    await finishSchedulerRun(retained.id, {
      finishedAt: '2026-04-24T09:01:00.000Z',
      status: 'success',
    });

    assert.equal((await dismissSkippedSchedulerRun(skipped.id))?.id, skipped.id);
    assert.equal(await dismissSkippedSchedulerRun(retained.id), null);
    assert.deepEqual((await listSchedulerRuns()).map((run) => run.id), [retained.id]);
  } finally {
    config.appDbPath = previousDbPath;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});

test('a concurrent run start cannot resurrect a dismissed skipped record', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'BFrost-scheduler-runs-'));
  const previousDbPath = config.appDbPath;
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    const skipped = await startSchedulerRun({
      job: 'finance-news-scan',
      label: 'News Digest',
      trigger: 'schedule',
      modelAlias: '',
      startedAt: '2026-04-24T08:00:00.000Z',
    });
    await finishSchedulerRun(skipped.id, {
      finishedAt: '2026-04-24T08:01:00.000Z',
      status: 'skipped',
      skipReason: 'missed',
    });

    const [dismissed, manual] = await Promise.all([
      dismissSkippedSchedulerRun(skipped.id),
      startSchedulerRun({
        job: 'finance-news-scan',
        label: 'News Digest',
        trigger: 'manual',
        modelAlias: '',
        startedAt: '2026-04-24T08:02:00.000Z',
      }),
    ]);

    assert.equal(dismissed?.id, skipped.id);
    const runs = await listSchedulerRuns();
    assert.equal(runs.some((run) => run.id === skipped.id), false);
    assert.equal(runs.some((run) => run.id === manual.id), true);
  } finally {
    config.appDbPath = previousDbPath;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});

test('lists only retained skipped scheduled runs for manual recovery', async () => {
  const previousDbPath = config.appDbPath;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-scheduler-runs-'));
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    const skipped = await startSchedulerRun({
      job: 'finance-news-scan', label: 'News Digest', trigger: 'schedule', modelAlias: '', startedAt: '2026-04-24T08:00:00.000Z',
    });
    await finishSchedulerRun(skipped.id, {
      finishedAt: '2026-04-24T08:01:00.000Z',
      status: 'skipped',
      skipReason: 'missed',
    });
    const manual = await startSchedulerRun({
      job: 'ops-digest', label: 'Ops Digest', trigger: 'manual', modelAlias: '', startedAt: '2026-04-24T09:00:00.000Z',
    });
    await finishSchedulerRun(manual.id, { finishedAt: '2026-04-24T09:01:00.000Z', status: 'skipped' });
    const noWork = await startSchedulerRun({
      job: 'ops-digest', label: 'Ops Digest', trigger: 'schedule', modelAlias: '', startedAt: '2026-04-24T10:00:00.000Z',
    });
    await finishSchedulerRun(noWork.id, {
      finishedAt: '2026-04-24T10:01:00.000Z',
      status: 'skipped',
      skipReason: 'no_work',
    });

    assert.deepEqual((await listSkippedScheduledRuns()).map((run) => run.id), [skipped.id]);
  } finally {
    config.appDbPath = previousDbPath;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});

test('repeated misses of one job collapse into a single recovery entry', async () => {
  const previousDbPath = config.appDbPath;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-scheduler-runs-'));
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    const first = await recordMissedScheduledRun({
      job: 'portfolio-sync-reconcile',
      label: 'Portfolio Sync',
      modelAlias: '',
      scheduledAt: '2026-04-24T08:15:00.000Z',
      recordedAt: '2026-04-24T08:21:00.000Z',
      error: 'Portfolio Sync missed its scheduled execution.',
    });
    assert.equal(first.missedSlotCount, 1);

    const second = await recordMissedScheduledRun({
      job: 'portfolio-sync-reconcile',
      label: 'Portfolio Sync',
      modelAlias: '',
      scheduledAt: '2026-04-24T09:15:00.000Z',
      recordedAt: '2026-04-24T09:23:00.000Z',
      error: 'Portfolio Sync missed its scheduled execution.',
    });
    // A dashboard holding the first id must still be able to dismiss the entry.
    assert.equal(second.id, first.id);
    assert.equal(second.missedSlotCount, 2);
    // The marker points at the most recent miss, not the first one.
    assert.equal(second.startedAt, '2026-04-24T09:15:00.000Z');

    // A different job is a different entry.
    await recordMissedScheduledRun({
      job: 'ops-digest',
      label: 'Ops Digest',
      modelAlias: '',
      scheduledAt: '2026-04-24T09:00:00.000Z',
      recordedAt: '2026-04-24T09:24:00.000Z',
      error: 'Ops Digest missed its scheduled execution.',
    });

    const recoverable = await listSkippedScheduledRuns();
    assert.deepEqual(recoverable.map((run) => run.job).sort(), ['ops-digest', 'portfolio-sync-reconcile']);
    assert.equal(await listSchedulerRuns().then((runs) => runs.length), 2);

    assert.equal((await dismissSkippedSchedulerRun(first.id))?.id, first.id);
    assert.deepEqual((await listSkippedScheduledRuns()).map((run) => run.job), ['ops-digest']);
  } finally {
    config.appDbPath = previousDbPath;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});

test('a backlog written before collapsing existed is absorbed by the next miss', async () => {
  const previousDbPath = config.appDbPath;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-scheduler-runs-'));
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    // Three separate records for one job, the shape this store held before collapsing.
    for (const hour of ['08', '09', '10']) {
      const legacy = await startSchedulerRun({
        job: 'shared-sync', label: 'Shared Sync', trigger: 'schedule', modelAlias: '',
        startedAt: `2026-04-24T${hour}:20:00.000Z`,
      });
      await finishSchedulerRun(legacy.id, {
        finishedAt: `2026-04-24T${hour}:26:00.000Z`, status: 'skipped', skipReason: 'missed',
      });
    }
    assert.equal((await listSkippedScheduledRuns()).length, 3);

    const collapsed = await recordMissedScheduledRun({
      job: 'shared-sync',
      label: 'Shared Sync',
      modelAlias: '',
      scheduledAt: '2026-04-24T11:20:00.000Z',
      recordedAt: '2026-04-24T11:27:00.000Z',
      error: 'Shared Sync missed its scheduled execution.',
    });

    assert.deepEqual((await listSkippedScheduledRuns()).map((run) => run.id), [collapsed.id]);
    assert.equal(collapsed.missedSlotCount, 4);
    assert.equal(collapsed.startedAt, '2026-04-24T11:20:00.000Z');
  } finally {
    config.appDbPath = previousDbPath;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});

test('a collapsed record survives the dashboard API schema', async () => {
  const previousDbPath = config.appDbPath;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-scheduler-runs-'));
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    for (const hour of ['08', '09']) {
      await recordMissedScheduledRun({
        job: 'etoro-sync', label: 'eToro Sync', modelAlias: '',
        scheduledAt: `2026-04-24T${hour}:30:00.000Z`,
        recordedAt: `2026-04-24T${hour}:38:00.000Z`,
        error: 'eToro Sync missed its scheduled execution.',
      });
    }

    // `src/admin-api.ts` keeps its own strict copy of the run schema, so a field added
    // to the store but not to that copy would throw here — and only here. The dashboard
    // is the only reason `missedSlotCount` exists; this is the boundary it must cross.
    const section = CronRunsSectionSchema.parse({ runs: await listSchedulerRuns(), jobs: [] });
    assert.equal(section.runs[0].missedSlotCount, 2);
  } finally {
    config.appDbPath = previousDbPath;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});

test('a miss reported out of order counts but never moves the marker backwards', async () => {
  const previousDbPath = config.appDbPath;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-scheduler-runs-'));
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    await recordMissedScheduledRun({
      job: 'filings-watch',
      label: 'Filings Watch',
      modelAlias: '',
      scheduledAt: '2026-04-24T12:15:00.000Z',
      recordedAt: '2026-04-24T12:20:00.000Z',
      error: 'newest slot',
    });
    // The startup sweep can report a slot older than one node-cron already reported.
    const older = await recordMissedScheduledRun({
      job: 'filings-watch',
      label: 'Filings Watch',
      modelAlias: '',
      scheduledAt: '2026-04-24T07:15:00.000Z',
      recordedAt: '2026-04-24T12:25:00.000Z',
      error: 'older slot',
    });

    assert.equal(older.startedAt, '2026-04-24T12:15:00.000Z');
    assert.equal(older.error, 'newest slot');
    assert.equal(older.missedSlotCount, 2);
  } finally {
    config.appDbPath = previousDbPath;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});

test('bulk dismissal clears only recovered jobs from the skipped-schedule list', async () => {
  const previousDbPath = config.appDbPath;
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-scheduler-runs-'));
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    const recovered = await startSchedulerRun({
      job: 'finance-news-scan', label: 'News Digest', trigger: 'schedule', modelAlias: '', startedAt: '2026-04-24T08:00:00.000Z',
    });
    const retained = await startSchedulerRun({
      job: 'ops-digest', label: 'Ops Digest', trigger: 'schedule', modelAlias: '', startedAt: '2026-04-24T09:00:00.000Z',
    });
    await finishSchedulerRun(recovered.id, {
      finishedAt: '2026-04-24T08:01:00.000Z',
      status: 'skipped',
      skipReason: 'missed',
    });
    await finishSchedulerRun(retained.id, {
      finishedAt: '2026-04-24T09:01:00.000Z',
      status: 'skipped',
      skipReason: 'missed',
    });

    assert.deepEqual((await dismissSkippedScheduledRunsForJobs(['finance-news-scan'])).map((run) => run.id), [recovered.id]);
    assert.deepEqual((await listSkippedScheduledRuns()).map((run) => run.id), [retained.id]);
  } finally {
    config.appDbPath = previousDbPath;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});

test('scheduler runs append attempt history', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'BFrost-scheduler-runs-'));
  const previousDbPath = config.appDbPath;
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    const run = await startSchedulerRun({
      job: 'finance-news-scan',
      label: 'News Digest',
      trigger: 'schedule',
      modelAlias: 'local-model',
      startedAt: '2026-04-24T08:00:00.000Z',
    });

    await recordSchedulerRunAttempt(run.id, {
      attempt: 1,
      startedAt: '2026-04-24T08:00:00.000Z',
      finishedAt: '2026-04-24T08:00:01.000Z',
      status: 'error',
      error: 'provider not ready',
      nextDelayMs: 1000,
    });
    await recordSchedulerRunAttempt(run.id, {
      attempt: 2,
      startedAt: '2026-04-24T08:00:02.000Z',
      finishedAt: '2026-04-24T08:00:03.000Z',
      status: 'success',
      summary: 'Recovered.',
      itemCount: 1,
    });

    const runs = await listSchedulerRuns();
    assert.equal(runs[0].attempts.length, 2);
    assert.deepEqual(
      runs[0].attempts.map((attempt) => attempt.status),
      ['error', 'success'],
    );
    assert.equal(runs[0].attempts[0].nextDelayMs, 1000);
  } finally {
    config.appDbPath = previousDbPath;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});

test('scheduler runs can reconcile abandoned running records', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'BFrost-scheduler-runs-'));
  const previousDbPath = config.appDbPath;
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    await startSchedulerRun({
      job: 'finance-news-scan',
      label: 'News Digest',
      trigger: 'schedule',
      modelAlias: 'local-model',
      startedAt: '2026-04-24T08:00:00.000Z',
    });
    const completed = await startSchedulerRun({
      job: 'ops-digest',
      label: 'Ops Digest',
      trigger: 'schedule',
      modelAlias: 'local-model',
      startedAt: '2026-04-24T09:00:00.000Z',
    });
    await finishSchedulerRun(completed.id, {
      finishedAt: '2026-04-24T09:00:03.000Z',
      status: 'success',
      summary: 'Ops digest sent.',
    });

    const result = await abandonRunningSchedulerRuns({
      finishedAt: '2026-04-24T10:00:00.000Z',
      error: 'BFrost stopped before this scheduler run finished.',
    });

    assert.equal(result.count, 1);
    assert.deepEqual(result.abandoned, [
      {
        job: 'finance-news-scan',
        label: 'News Digest',
        startedAt: '2026-04-24T08:00:00.000Z',
      },
    ]);
    const runs = await listSchedulerRuns();
    const abandoned = runs.find((run) => run.job === 'finance-news-scan');
    assert.ok(abandoned);
    assert.equal(abandoned.status, 'error');
    assert.equal(abandoned.finishedAt, '2026-04-24T10:00:00.000Z');
    assert.equal(abandoned.error, 'BFrost stopped before this scheduler run finished.');
    assert.equal(runs.find((run) => run.job === 'ops-digest')?.status, 'success');
  } finally {
    config.appDbPath = previousDbPath;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});
