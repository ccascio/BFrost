import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { z } from 'zod';
import { config } from './config';
import { closeDb } from './sqlite';
import { listSchedulerRuns } from './scheduler-runs';
import { CATCHUP_WINDOW_MS, getSchedulerSnapshot, isRecoverableSlotAge, triggerJobNow } from './scheduler';
import { seedDeclaredProviderModels } from './model-discovery';
import { registerLoadedLocalModule, unregisterLocalWorkerModule } from './workers/registry';
import type { BackendWorkerModule } from './workers/module';
import type { WorkerManifest } from './workers/types';
import { resolveOpenAIApiKey, setOpenAIApiKey } from './workers/builtin/providers-openai/credentials';

seedDeclaredProviderModels();

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
const TRANSIENT_JOB_ID = 'test.fake-scheduler-transient';
const LATE_WORKER_ID = 'test.fake-scheduler-late-worker';
const LATE_JOB_ID = 'test.fake-scheduler-late-job';

function buildFakeWorkerModule(): BackendWorkerModule {
  let transientAttempts = 0;
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
        id: TRANSIENT_JOB_ID,
        workerId: FAKE_WORKER_ID,
        label: 'Fake Transient Job',
        description: 'A test job that fails once and then succeeds.',
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
        retryPolicy: { maxRetries: 1, initialBackoffMs: 1, maxBackoffMs: 1, jitterRatio: 0 },
        run: async () => {
          transientAttempts += 1;
          if (transientAttempts === 1) {
            throw new Error('Provider warming up.');
          }
          return { summary: 'Fake transient job recovered.', itemCount: 2 };
        },
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
        retryPolicy: { maxRetries: 0 },
        run: async () => {
          throw new Error('Fake job failed on purpose.');
        },
      },
    ],
  };

  return { manifest };
}

function buildLateWorkerModule(): BackendWorkerModule {
  const manifest: WorkerManifest = {
    id: LATE_WORKER_ID,
    name: 'Late Scheduler Worker',
    version: '0.1.0',
    description: 'Fake worker registered after scheduler settings have been cached.',
    builtIn: false,
    jobs: [
      {
        id: LATE_JOB_ID,
        workerId: LATE_WORKER_ID,
        label: 'Late Scheduler Job',
        description: 'A job that appears after the settings cache is warm.',
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
        run: async () => ({ summary: 'Late job completed.', itemCount: 1 }),
      },
    ],
  };

  return { manifest };
}

test('catch-up window — only recovers past slots within the window', () => {
  const MINUTE = 60 * 1000;
  const HOUR = 60 * MINUTE;

  // Future or current slots are never recovered (a normal scheduled run handles them).
  assert.equal(isRecoverableSlotAge(-MINUTE), false);
  assert.equal(isRecoverableSlotAge(0), false);

  // Recent misses are recovered (e.g. brief sleep, or a daily 8am digest resumed mid-afternoon).
  assert.equal(isRecoverableSlotAge(MINUTE), true);
  assert.equal(isRecoverableSlotAge(8 * HOUR), true);

  // The window comfortably covers a daily job missed overnight (>24h is the failure case
  // the 7h window used to drop), but stops short of replaying stale slots.
  assert.equal(CATCHUP_WINDOW_MS, 26 * HOUR);
  assert.equal(isRecoverableSlotAge(24 * HOUR), true);
  assert.equal(isRecoverableSlotAge(CATCHUP_WINDOW_MS), true);
  assert.equal(isRecoverableSlotAge(CATCHUP_WINDOW_MS + MINUTE), false);
});

test('scheduler integration — successful job produces a success run record and correct snapshot state', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-sched-integration-'));
  const prevDbPath = config.appDbPath;
  const prevOpenaiKey = resolveOpenAIApiKey();
  const prevFallbacks = config.modelFallbackAliases;

  config.appDbPath = path.join(dir, 'app.sqlite');
  setOpenAIApiKey('test-key');
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
    setOpenAIApiKey(prevOpenaiKey);
    config.modelFallbackAliases = prevFallbacks;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});

test('scheduler integration — transient job retries with backoff and records attempts', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-sched-integration-'));
  const prevDbPath = config.appDbPath;
  const prevOpenaiKey = resolveOpenAIApiKey();
  const prevFallbacks = config.modelFallbackAliases;

  config.appDbPath = path.join(dir, 'app.sqlite');
  setOpenAIApiKey('test-key');
  config.modelFallbackAliases = [];

  registerLoadedLocalModule(buildFakeWorkerModule());

  try {
    await triggerJobNow(TRANSIENT_JOB_ID);

    const runs = await pollUntil(
      () => listSchedulerRuns(),
      (rs) => rs.some((r) => r.job === TRANSIENT_JOB_ID && r.status !== 'running'),
    );

    const run = runs.find((r) => r.job === TRANSIENT_JOB_ID);
    assert.ok(run, 'run record exists');
    assert.equal(run.status, 'success');
    assert.equal(run.summary, 'Fake transient job recovered.');
    assert.equal(run.itemCount, 2);
    assert.equal(run.attempts.length, 2);
    assert.equal(run.attempts[0].status, 'error');
    assert.match(run.attempts[0].error ?? '', /Provider warming up/);
    assert.equal(run.attempts[0].nextDelayMs, 1);
    assert.equal(run.attempts[1].status, 'success');
    assert.equal(run.attempts[1].summary, 'Fake transient job recovered.');

    const snapshot = await getSchedulerSnapshot();
    const jobState = snapshot.jobs.find((j) => j.name === TRANSIENT_JOB_ID);
    assert.ok(jobState, 'snapshot includes the transient job');
    assert.equal(jobState.running, false);
    assert.equal(jobState.lastStatus, 'success');
    assert.equal(jobState.lastSummary, 'Fake transient job recovered.');
  } finally {
    unregisterLocalWorkerModule(FAKE_WORKER_ID);
    config.appDbPath = prevDbPath;
    setOpenAIApiKey(prevOpenaiKey);
    config.modelFallbackAliases = prevFallbacks;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});

test('scheduler integration — failing job produces an error run record and correct snapshot state', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-sched-integration-'));
  const prevDbPath = config.appDbPath;
  const prevOpenaiKey = resolveOpenAIApiKey();
  const prevFallbacks = config.modelFallbackAliases;

  config.appDbPath = path.join(dir, 'app.sqlite');
  setOpenAIApiKey('test-key');
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
    setOpenAIApiKey(prevOpenaiKey);
    config.modelFallbackAliases = prevFallbacks;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});

test('scheduler snapshot refreshes cached settings when a new worker job appears', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-sched-late-worker-'));
  const prevDbPath = config.appDbPath;
  const prevOpenaiKey = resolveOpenAIApiKey();
  const prevFallbacks = config.modelFallbackAliases;

  config.appDbPath = path.join(dir, 'app.sqlite');
  setOpenAIApiKey('test-key');
  config.modelFallbackAliases = [];

  try {
    await getSchedulerSnapshot();
    registerLoadedLocalModule(buildLateWorkerModule());

    const snapshot = await getSchedulerSnapshot();
    const jobState = snapshot.jobs.find((j) => j.name === LATE_JOB_ID);
    assert.ok(jobState, 'snapshot includes a job registered after settings were cached');
    assert.equal(jobState.modelAlias, 'gpt-5.4-mini');
    assert.equal(jobState.effectiveModelAlias, 'gpt-5.4-mini');
  } finally {
    unregisterLocalWorkerModule(LATE_WORKER_ID);
    config.appDbPath = prevDbPath;
    setOpenAIApiKey(prevOpenaiKey);
    config.modelFallbackAliases = prevFallbacks;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});
