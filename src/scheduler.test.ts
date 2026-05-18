import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { z } from 'zod';
import { config } from './config';
import { listSchedulerRuns } from './scheduler-runs';
import { getSchedulerSnapshot, triggerJobNow } from './scheduler';
import { registerLoadedLocalModule, unregisterLocalWorkerModule } from './workers/registry';
import type { BackendWorkerModule } from './workers/module';
import type { WorkerManifest } from './workers/types';

async function pollUntil<T>(
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  timeoutMs = 2000,
  intervalMs = 20,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`pollUntil: timed out after ${timeoutMs}ms`);
}

const FAKE_WORKER_ID = 'test.fake-scheduler-worker';
const SUCCESS_JOB_ID = 'test.fake-scheduler-success';
const FAIL_JOB_ID = 'test.fake-scheduler-fail';

function buildFakeWorkerModule(): BackendWorkerModule {
  const manifest: WorkerManifest = {
    id: FAKE_WORKER_ID,
    name: 'Fake Scheduler Worker',
    version: '0.1.0',
    description: 'Fake worker used in scheduler integration tests.',
    builtIn: false,
    jobs: [
      {
        id: SUCCESS_JOB_ID,
        workerId: FAKE_WORKER_ID,
        label: 'Fake Success Job',
        description: 'A test job that always succeeds.',
        defaultEnabled: true,
        defaultCron: '0 0 * * *',
        defaultModelAlias: 'gpt-5.4-mini',
        approvalRequiredDefault: false,
        approvalRequiredEditable: false,
        defaultPrompt: '',
        prompt: { editable: false },
        paramsSchema: z.object({}),
        defaultParams: {},
        dashboardFields: [],
        run: async () => ({ summary: 'Fake job completed.', itemCount: 3 }),
      },
      {
        id: FAIL_JOB_ID,
        workerId: FAKE_WORKER_ID,
        label: 'Fake Failing Job',
        description: 'A test job that always throws.',
        defaultEnabled: true,
        defaultCron: '0 0 * * *',
        defaultModelAlias: 'gpt-5.4-mini',
        approvalRequiredDefault: false,
        approvalRequiredEditable: false,
        defaultPrompt: '',
        prompt: { editable: false },
        paramsSchema: z.object({}),
        defaultParams: {},
        dashboardFields: [],
        run: async () => {
          throw new Error('Fake job failed on purpose.');
        },
      },
    ],
  };

  return { manifest };
}

test('scheduler integration — successful job produces a success run record and correct snapshot state', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-sched-integration-'));
  const prevDbPath = config.appDbPath;
  const prevOpenaiKey = config.openaiApiKey;
  const prevFallbacks = config.modelFallbackAliases;

  config.appDbPath = path.join(dir, 'app.sqlite');
  config.openaiApiKey = 'test-key';
  config.modelFallbackAliases = [];

  registerLoadedLocalModule(buildFakeWorkerModule());

  try {
    await triggerJobNow(SUCCESS_JOB_ID);

    const runs = await pollUntil(
      () => listSchedulerRuns(),
      (rs) => rs.some((r) => r.job === SUCCESS_JOB_ID && r.status !== 'running'),
    );

    const run = runs.find((r) => r.job === SUCCESS_JOB_ID);
    assert.ok(run, 'run record exists');
    assert.equal(run.status, 'success');
    assert.equal(run.summary, 'Fake job completed.');
    assert.equal(run.itemCount, 3);
    assert.equal(run.trigger, 'manual');
    assert.ok(run.finishedAt, 'run has a finishedAt timestamp');

    const snapshot = await getSchedulerSnapshot();
    const jobState = snapshot.jobs.find((j) => j.name === SUCCESS_JOB_ID);
    assert.ok(jobState, 'snapshot includes the fake job');
    assert.equal(jobState.running, false);
    assert.equal(jobState.lastStatus, 'success');
    assert.equal(jobState.lastSummary, 'Fake job completed.');
    assert.equal(jobState.lastTrigger, 'manual');
  } finally {
    unregisterLocalWorkerModule(FAKE_WORKER_ID);
    config.appDbPath = prevDbPath;
    config.openaiApiKey = prevOpenaiKey;
    config.modelFallbackAliases = prevFallbacks;
    await rm(dir, { recursive: true, force: true });
  }
});

test('scheduler integration — failing job produces an error run record and correct snapshot state', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-sched-integration-'));
  const prevDbPath = config.appDbPath;
  const prevOpenaiKey = config.openaiApiKey;
  const prevFallbacks = config.modelFallbackAliases;

  config.appDbPath = path.join(dir, 'app.sqlite');
  config.openaiApiKey = 'test-key';
  config.modelFallbackAliases = [];

  registerLoadedLocalModule(buildFakeWorkerModule());

  try {
    await triggerJobNow(FAIL_JOB_ID);

    const runs = await pollUntil(
      () => listSchedulerRuns(),
      (rs) => rs.some((r) => r.job === FAIL_JOB_ID && r.status !== 'running'),
    );

    const run = runs.find((r) => r.job === FAIL_JOB_ID);
    assert.ok(run, 'run record exists');
    assert.equal(run.status, 'error');
    assert.match(run.error ?? '', /Fake job failed on purpose/);
    assert.equal(run.summary, null);
    assert.equal(run.trigger, 'manual');

    const snapshot = await getSchedulerSnapshot();
    const jobState = snapshot.jobs.find((j) => j.name === FAIL_JOB_ID);
    assert.ok(jobState, 'snapshot includes the fake job');
    assert.equal(jobState.running, false);
    assert.equal(jobState.lastStatus, 'error');
    assert.match(jobState.lastError ?? '', /Fake job failed on purpose/);
  } finally {
    unregisterLocalWorkerModule(FAKE_WORKER_ID);
    config.appDbPath = prevDbPath;
    config.openaiApiKey = prevOpenaiKey;
    config.modelFallbackAliases = prevFallbacks;
    await rm(dir, { recursive: true, force: true });
  }
});
