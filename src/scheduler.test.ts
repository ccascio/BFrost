import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { z } from 'zod';
import { config } from './config';
import { closeDb } from './sqlite';
import { listSchedulerRuns } from './scheduler-runs';
import { CATCHUP_WINDOW_MS, PIPELINE_KICK_DELAY_MS, PIPELINE_TICK_INTERVAL_MS, activeJobExecutionCount, getSchedulerSnapshot, isRecoverableSlotAge, runPipelineTick, startScheduler, stopScheduler, triggerJobNow, wakeJobsForItemType } from './scheduler';
import { seedDeclaredProviderModels } from './model-discovery';
import { registerLoadedLocalModule, unregisterLocalWorkerModule } from './workers/registry';
import type { BackendWorkerModule } from './workers/module';
import type { WorkerManifest } from './workers/types';
import { resolveOpenAIApiKey, setOpenAIApiKey } from './workers/builtin/providers-openai/credentials';
import { mkdtempSync } from 'node:fs';

/**
 * Point the module-level default database at a throwaway file at import time.
 *
 * Each test below overrides `config.appDbPath` to its own temp DB and restores this value
 * in a `finally`. The restored value used to be the process default — the **live**
 * `data/BFrost.sqlite` when `APP_DB_PATH` is unset. That mattered because the retry-backoff
 * test schedules delayed retries whose `recordEvent('job/retrying', …)` fires *after* the
 * test body has already restored the default, so the audit-log write landed on the live
 * store. Restoring to a throwaway instead keeps that late write off the live database even
 * when this file is run on its own (`node --test dist/scheduler.test.js`), independently of
 * the runner-level redirect in `scripts/cross-platform.mjs`.
 */
const SCHEDULER_TEST_DB_DIR = mkdtempSync(path.join(os.tmpdir(), 'BFrost-scheduler-default-'));
config.appDbPath = path.join(SCHEDULER_TEST_DB_DIR, 'default.sqlite');
config.itemBusStoreDir = path.join(SCHEDULER_TEST_DB_DIR, 'item-bus');

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
const SLOW_JOB_ID = 'test.fake-scheduler-slow';
const QUEUED_JOB_ID = 'test.fake-scheduler-queued';
const LATE_WORKER_ID = 'test.fake-scheduler-late-worker';
const LATE_JOB_ID = 'test.fake-scheduler-late-job';
const PIPELINE_WORKER_ID = 'test.fake-pipeline-worker';
const PIPELINE_READY_JOB_ID = 'test.fake-pipeline-ready';
const PIPELINE_IDLE_JOB_ID = 'test.fake-pipeline-idle';
const WAKE_WORKER_ID = 'test.fake-wake-worker';
const WAKE_READY_JOB_ID = 'test.fake-wake-ready';
const WAKE_IDLE_JOB_ID = 'test.fake-wake-idle';
const WAKE_OTHER_TYPE_JOB_ID = 'test.fake-wake-other-type';
const WAKE_ITEM_TYPE = 'test.wake-signal';

let slowJobGate: Promise<void> = Promise.resolve();
let announceSlowJobStarted: () => void = () => undefined;

function armSlowJob(): { started: Promise<void>; release: () => void } {
  let release: () => void = () => undefined;
  let announce: () => void = () => undefined;
  slowJobGate = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { announce = resolve; });
  announceSlowJobStarted = announce;
  return { started, release };
}

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
      {
        id: SLOW_JOB_ID,
        workerId: FAKE_WORKER_ID,
        label: 'Fake Slow Job',
        description: 'A test job that holds the scheduler FIFO until released.',
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
          announceSlowJobStarted();
          await slowJobGate;
          return { summary: 'Fake slow job completed.', itemCount: 1 };
        },
      },
      {
        id: QUEUED_JOB_ID,
        workerId: FAKE_WORKER_ID,
        label: 'Fake Queued Job',
        description: 'A test job that waits behind the slow job.',
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
        // Always claims work so the pipeline tick considers it — lets tests assert
        // that a queued job is coalesced into a quiet skip rather than an error.
        hasWork: async () => true,
        run: async () => ({ summary: 'Fake queued job completed.', itemCount: 1 }),
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

function buildPipelineWorkerModule(): BackendWorkerModule {
  const manifest: WorkerManifest = {
    id: PIPELINE_WORKER_ID,
    name: 'Pipeline Tick Test Worker',
    version: '0.1.0',
    description: 'Fake worker used to test pipeline tick eligibility.',
    builtIn: false,
    jobs: [
      {
        id: PIPELINE_READY_JOB_ID,
        workerId: PIPELINE_WORKER_ID,
        label: 'Pipeline Ready Job',
        description: 'A job with work ready.',
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
        hasWork: async () => true,
        run: async () => ({ summary: 'Pipeline job completed.', itemCount: 1 }),
      },
      {
        id: PIPELINE_IDLE_JOB_ID,
        workerId: PIPELINE_WORKER_ID,
        label: 'Pipeline Idle Job',
        description: 'A job with no work ready.',
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
        hasWork: async () => false,
        run: async () => ({ summary: 'Idle job should not run.', itemCount: 1 }),
      },
    ],
  };

  return { manifest };
}

function buildWakeWorkerModule(): BackendWorkerModule {
  const baseJob = {
    workerId: WAKE_WORKER_ID,
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
  };
  const manifest: WorkerManifest = {
    id: WAKE_WORKER_ID,
    name: 'Bus Wake Test Worker',
    version: '0.1.0',
    description: 'Fake worker used to test event-driven bus wakes.',
    builtIn: false,
    jobs: [
      {
        ...baseJob,
        id: WAKE_READY_JOB_ID,
        label: 'Wake Ready Job',
        description: 'Wakes on the test item type and has work.',
        wakeOn: [WAKE_ITEM_TYPE],
        hasWork: async () => true,
        run: async () => ({ summary: 'Wake job completed.', itemCount: 1 }),
      },
      {
        ...baseJob,
        id: WAKE_IDLE_JOB_ID,
        label: 'Wake Idle Job',
        description: 'Wakes on the test item type but has no work.',
        wakeOn: [WAKE_ITEM_TYPE],
        hasWork: async () => false,
        run: async () => ({ summary: 'Idle wake job should not run.', itemCount: 1 }),
      },
      {
        ...baseJob,
        id: WAKE_OTHER_TYPE_JOB_ID,
        label: 'Wake Other Type Job',
        description: 'Wakes on a different item type.',
        wakeOn: ['test.some-other-type'],
        hasWork: async () => true,
        run: async () => ({ summary: 'Other-type job should not run.', itemCount: 1 }),
      },
    ],
  };

  return { manifest };
}

test('bus wake triggers only enabled wakeOn jobs with work, recorded with the event trigger', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'BFrost-bus-wake-'));
  const prevDbPath = config.appDbPath;
  const prevOpenaiKey = resolveOpenAIApiKey();
  const prevFallbacks = config.modelFallbackAliases;

  config.appDbPath = path.join(dir, 'app.sqlite');
  setOpenAIApiKey('test-key');
  config.modelFallbackAliases = [];

  registerLoadedLocalModule(buildWakeWorkerModule());

  try {
    const startedJobs = await wakeJobsForItemType(WAKE_ITEM_TYPE);
    assert.deepEqual(startedJobs, [WAKE_READY_JOB_ID]);

    const runs = await pollUntil(
      () => listSchedulerRuns(),
      (records) => records.some((r) => r.job === WAKE_READY_JOB_ID && r.status === 'success'),
    );
    const readyRun = runs.find((r) => r.job === WAKE_READY_JOB_ID);
    assert.ok(readyRun, 'woken job produced a scheduler run');
    assert.equal(readyRun.trigger, 'event');
    assert.equal(readyRun.summary, 'Wake job completed.');
    assert.equal(runs.find((r) => r.job === WAKE_IDLE_JOB_ID), undefined, 'no-work job did not run');
    assert.equal(runs.find((r) => r.job === WAKE_OTHER_TYPE_JOB_ID), undefined, 'other-type job did not run');
  } finally {
    unregisterLocalWorkerModule(WAKE_WORKER_ID);
    config.appDbPath = prevDbPath;
    setOpenAIApiKey(prevOpenaiKey);
    config.modelFallbackAliases = prevFallbacks;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});

test('bus wake coalesces a publication burst and preserves one wake arriving during a running job', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'BFrost-bus-wake-burst-'));
  const prevDbPath = config.appDbPath;
  const prevOpenaiKey = resolveOpenAIApiKey();
  const prevFallbacks = config.modelFallbackAliases;
  const workerId = 'test.fake-latched-wake-worker';
  const jobId = 'test.fake-latched-wake-job';
  const itemType = 'test.latched-wake-signal';
  let runs = 0;
  let releaseFirst: () => void = () => undefined;
  let announceFirst: () => void = () => undefined;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const firstStarted = new Promise<void>((resolve) => { announceFirst = resolve; });
  const module: BackendWorkerModule = {
    manifest: {
      id: workerId,
      name: 'Latched Wake Worker',
      version: '0.1.0',
      description: 'Exercises wake coalescing while a job is running.',
      builtIn: false,
      jobs: [{
        id: jobId,
        workerId,
        label: 'Latched Wake Job',
        description: 'Waits on its first pass so a burst can arrive.',
        defaultEnabled: true,
        defaultCron: '0 0 * * *',
        wakeOn: [itemType],
        defaultModelAlias: 'gpt-5.4-mini',
        approvalRequiredDefault: false,
        approvalRequiredEditable: false,
        defaultPrompt: '',
        prompt: { editable: false },
        paramsSchema: z.object({}),
        defaultParams: {},
        dashboardFields: [],
        hasWork: async () => true,
        run: async () => {
          runs += 1;
          if (runs === 1) {
            announceFirst();
            await firstGate;
          }
          return { summary: `Latched pass ${runs}.`, itemCount: 0 };
        },
      }],
    },
  };

  config.appDbPath = path.join(dir, 'app.sqlite');
  setOpenAIApiKey('test-key');
  config.modelFallbackAliases = [];
  registerLoadedLocalModule(module);

  try {
    const firstWake = wakeJobsForItemType(itemType);
    await firstStarted;
    await Promise.all(Array.from({ length: 8 }, () => wakeJobsForItemType(itemType)));
    releaseFirst();
    await firstWake;
    await pollUntil(async () => runs, (count) => count === 2, 3000);
    await new Promise((resolve) => setTimeout(resolve, 700));
    assert.equal(runs, 2, 'the running-pass burst produces one latched follow-up, not eight runs');
  } finally {
    releaseFirst();
    unregisterLocalWorkerModule(workerId);
    config.appDbPath = prevDbPath;
    setOpenAIApiKey(prevOpenaiKey);
    config.modelFallbackAliases = prevFallbacks;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});

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

test('pipeline tick runs enabled jobs with work and skips idle jobs', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'BFrost-pipeline-tick-'));
  const prevDbPath = config.appDbPath;
  const prevOpenaiKey = resolveOpenAIApiKey();
  const prevFallbacks = config.modelFallbackAliases;

  config.appDbPath = path.join(dir, 'app.sqlite');
  setOpenAIApiKey('test-key');
  config.modelFallbackAliases = [];

  registerLoadedLocalModule(buildPipelineWorkerModule());

  try {
    assert.equal(PIPELINE_TICK_INTERVAL_MS, 15 * 60 * 1000);

    const result = await runPipelineTick();
    assert.equal(result.triggered, 1);

    const runs = await listSchedulerRuns();
    const readyRun = runs.find((r) => r.job === PIPELINE_READY_JOB_ID);
    const idleRun = runs.find((r) => r.job === PIPELINE_IDLE_JOB_ID);

    assert.ok(readyRun, 'ready job produced a scheduler run');
    assert.equal(readyRun.status, 'success');
    assert.equal(readyRun.trigger, 'pipeline');
    assert.equal(readyRun.summary, 'Pipeline job completed.');
    assert.equal(idleRun, undefined, 'idle job did not produce a scheduler run');
  } finally {
    unregisterLocalWorkerModule(PIPELINE_WORKER_ID);
    config.appDbPath = prevDbPath;
    setOpenAIApiKey(prevOpenaiKey);
    config.modelFallbackAliases = prevFallbacks;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});

test('scheduler integration — successful job produces a success run record and correct snapshot state', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'BFrost-sched-integration-'));
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

test('scheduler integration — a FIFO waiter is queued, not running, until execution begins', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'BFrost-sched-queued-'));
  const prevDbPath = config.appDbPath;
  const prevOpenaiKey = resolveOpenAIApiKey();
  const prevFallbacks = config.modelFallbackAliases;
  const prevConcurrency = config.jobMaxConcurrency;
  const gate = armSlowJob();

  config.appDbPath = path.join(dir, 'app.sqlite');
  setOpenAIApiKey('test-key');
  config.modelFallbackAliases = [];
  // This test is about what a job does while it waits for an execution slot, so pin the
  // pool to one slot to guarantee the second trigger has to wait. With the default pool
  // size it would simply start straight away, which is a different scenario.
  config.jobMaxConcurrency = 1;
  registerLoadedLocalModule(buildFakeWorkerModule());

  try {
    await triggerJobNow(SLOW_JOB_ID);
    await gate.started;
    await triggerJobNow(QUEUED_JOB_ID);

    const snapshot = await getSchedulerSnapshot();
    const slow = snapshot.jobs.find((job) => job.name === SLOW_JOB_ID);
    const queued = snapshot.jobs.find((job) => job.name === QUEUED_JOB_ID);
    assert.ok(slow);
    assert.ok(queued);
    assert.equal(slow.running, true);
    assert.equal(slow.queued, false);
    assert.equal(queued.running, false);
    assert.equal(queued.queued, true);
    assert.ok(queued.queuedAt);
    assert.equal(queued.lastStartedAt, null);
    assert.equal((await listSchedulerRuns()).some((run) => run.job === QUEUED_JOB_ID), false);
    await assert.rejects(() => triggerJobNow(QUEUED_JOB_ID), /already queued or running/);

    // A pipeline tick over the queued job is a benign skip, not an error, and must
    // not enqueue a duplicate execution. Other (builtin) jobs may error in this
    // stripped-down environment, so assert on this job's warnings specifically.
    const warnings: string[] = [];
    const previousWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    };
    try {
      await runPipelineTick();
    } finally {
      console.warn = previousWarn;
    }
    assert.equal(
      warnings.some((line) => line.includes(QUEUED_JOB_ID)),
      false,
      'queued job coalesces into a quiet skip',
    );
    assert.equal((await listSchedulerRuns()).some((run) => run.job === QUEUED_JOB_ID), false);

    gate.release();
    const runs = await pollUntil(
      () => listSchedulerRuns(),
      (records) => records.some((run) => run.job === QUEUED_JOB_ID && run.status === 'success'),
    );
    const queuedRun = runs.find((run) => run.job === QUEUED_JOB_ID);
    assert.ok(queuedRun);
    const dispatchDelayMs = Date.parse(queuedRun.attempts[0].startedAt) - Date.parse(queuedRun.startedAt);
    assert.ok(dispatchDelayMs >= 0 && dispatchDelayMs < 100, `unexpected dispatch bookkeeping delay: ${dispatchDelayMs}ms`);

    const completed = (await getSchedulerSnapshot()).jobs.find((job) => job.name === QUEUED_JOB_ID);
    assert.ok(completed);
    assert.equal(completed.queued, false);
    assert.equal(completed.running, false);
    assert.equal(completed.lastStatus, 'success');
  } finally {
    gate.release();
    unregisterLocalWorkerModule(FAKE_WORKER_ID);
    config.appDbPath = prevDbPath;
    setOpenAIApiKey(prevOpenaiKey);
    config.modelFallbackAliases = prevFallbacks;
    config.jobMaxConcurrency = prevConcurrency;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});

test('scheduler startup — a backlog waiting at boot is swept without waiting for the first tick', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'BFrost-sched-bootsweep-'));
  const prevDbPath = config.appDbPath;
  const prevOpenaiKey = resolveOpenAIApiKey();
  const prevFallbacks = config.modelFallbackAliases;
  const prevSweepMs = config.pipelineBootSweepMs;

  config.appDbPath = path.join(dir, 'app.sqlite');
  setOpenAIApiKey('test-key');
  config.modelFallbackAliases = [];
  // Real boot waits 10s so the rest of startup settles; compress it for the suite.
  config.pipelineBootSweepMs = 20;
  registerLoadedLocalModule(buildPipelineWorkerModule());

  try {
    // The periodic tick interval is 15 minutes and the bus wake path only fires on *new*
    // publishes, so without the boot sweep this job — which already has work waiting —
    // would not run at all within the life of this test.
    await startScheduler();
    const runs = await pollUntil(
      () => listSchedulerRuns(),
      (records) => records.some((run) => run.job === PIPELINE_READY_JOB_ID),
    );
    assert.ok(
      runs.some((run) => run.job === PIPELINE_READY_JOB_ID),
      'a job with work ready must be dispatched by the boot sweep',
    );
    // The sweep is not indiscriminate: it applies the same `hasWork` guard as every other
    // trigger path, so a job with nothing to do is still left alone.
    assert.equal(runs.some((run) => run.job === PIPELINE_IDLE_JOB_ID), false);

    // `stopScheduler` cancels timers but does not wait for runs already in flight, and the
    // execution pool is module-global — leaving one running would occupy a slot in whichever
    // test happens to run next.
    await pollUntil(
      () => Promise.resolve(activeJobExecutionCount()),
      (count) => count === 0,
    );
  } finally {
    await stopScheduler();
    unregisterLocalWorkerModule(PIPELINE_WORKER_ID);
    config.appDbPath = prevDbPath;
    setOpenAIApiKey(prevOpenaiKey);
    config.modelFallbackAliases = prevFallbacks;
    config.pipelineBootSweepMs = prevSweepMs;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});

test('scheduler integration — jobs run in parallel across workers but serially within one', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'BFrost-sched-concurrent-'));
  const prevDbPath = config.appDbPath;
  const prevOpenaiKey = resolveOpenAIApiKey();
  const prevFallbacks = config.modelFallbackAliases;
  const prevConcurrency = config.jobMaxConcurrency;
  const gate = armSlowJob();

  config.appDbPath = path.join(dir, 'app.sqlite');
  setOpenAIApiKey('test-key');
  config.modelFallbackAliases = [];
  // Ample pool room, so anything that still waits is waiting on the per-worker lock rather
  // than on slot exhaustion — that is the distinction this test exists to draw.
  config.jobMaxConcurrency = 4;
  registerLoadedLocalModule(buildFakeWorkerModule());
  registerLoadedLocalModule(buildLateWorkerModule());

  try {
    await triggerJobNow(SLOW_JOB_ID);
    await gate.started;

    // A job belonging to a *different* worker shares no storage with the slow one, so it
    // must run to completion rather than waiting behind it. Under the old single-FIFO
    // scheduler it could not start at all — this is the latency the pool removes.
    await triggerJobNow(LATE_JOB_ID);
    const runs = await pollUntil(
      () => listSchedulerRuns(),
      (records) => records.some((run) => run.job === LATE_JOB_ID && run.status === 'success'),
    );
    assert.ok(runs.some((run) => run.job === LATE_JOB_ID && run.status === 'success'));

    // ...and the slow job must still be genuinely mid-flight, proving the other job
    // overtook it rather than the slow one having quietly finished first.
    const slow = (await getSchedulerSnapshot()).jobs.find((job) => job.name === SLOW_JOB_ID);
    assert.ok(slow);
    assert.equal(slow.running, true);

    // A *sibling* job of the same worker is the opposite case: it shares that worker's KV
    // and tables, so it must wait even though the pool has free slots.
    await triggerJobNow(QUEUED_JOB_ID);
    const sibling = (await getSchedulerSnapshot()).jobs.find((job) => job.name === QUEUED_JOB_ID);
    assert.ok(sibling);
    assert.equal(sibling.running, false, 'a sibling job must not run alongside its worker');
    assert.equal(sibling.queued, true);

    // Draining also proves the lock hands off: releasing the slow job lets the sibling run.
    gate.release();
    await pollUntil(
      () => listSchedulerRuns(),
      (records) => records.some((run) => run.job === QUEUED_JOB_ID && run.status === 'success'),
    );
    await pollUntil(
      () => getSchedulerSnapshot(),
      (snap) => snap.jobs.find((job) => job.name === SLOW_JOB_ID)?.running === false,
    );
  } finally {
    gate.release();
    unregisterLocalWorkerModule(FAKE_WORKER_ID);
    unregisterLocalWorkerModule(LATE_WORKER_ID);
    config.appDbPath = prevDbPath;
    setOpenAIApiKey(prevOpenaiKey);
    config.modelFallbackAliases = prevFallbacks;
    config.jobMaxConcurrency = prevConcurrency;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});

test('scheduler integration — a job that outruns its time budget is failed and releases its slot', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'BFrost-sched-timeout-'));
  const prevDbPath = config.appDbPath;
  const prevOpenaiKey = resolveOpenAIApiKey();
  const prevFallbacks = config.modelFallbackAliases;
  const prevTimeout = config.jobTimeoutMs;
  const gate = armSlowJob();

  config.appDbPath = path.join(dir, 'app.sqlite');
  setOpenAIApiKey('test-key');
  config.modelFallbackAliases = [];
  // The slow job blocks on a gate that is never released during the assertions, standing in
  // for a job that runs away. A short budget makes the deadline observable in test time.
  config.jobTimeoutMs = 100;
  registerLoadedLocalModule(buildFakeWorkerModule());

  try {
    await triggerJobNow(SLOW_JOB_ID);
    await gate.started;

    const snapshot = await pollUntil(
      () => getSchedulerSnapshot(),
      (snap) => snap.jobs.find((entry) => entry.name === SLOW_JOB_ID)?.lastStatus === 'error',
    );
    const state = snapshot.jobs.find((job) => job.name === SLOW_JOB_ID);
    assert.ok(state);
    assert.equal(state.queued, false);
    assert.match(String(state.lastError), /time budget/);

    const timedOut = (await listSchedulerRuns()).find((run) => run.job === SLOW_JOB_ID);
    assert.ok(timedOut);
    // Only one attempt: a job that blew its budget must not be retried into another one.
    assert.equal(timedOut.attempts.length, 1);

    // The pool slot is freed immediately — that is what unblocks the rest of the desk.
    assert.equal(activeJobExecutionCount(), 0, 'the abandoned run must release its pool slot');

    // ...but the job itself must still count as in-flight, because its handler is still
    // executing (promises cannot be cancelled). Releasing the guard here would let the next
    // tick start a second run of the same job on top of the first, both writing to the same
    // worker KV/DB. This is the hazard the pool's safety argument depends on not existing.
    assert.equal(state.running, true, 'an abandoned handler still counts as running');
    await assert.rejects(() => triggerJobNow(SLOW_JOB_ID), /already queued or running/);

    // A tick may legitimately dispatch *other* jobs, so assert specifically that it started
    // no additional run of the timed-out one.
    const runsBefore = (await listSchedulerRuns()).filter((run) => run.job === SLOW_JOB_ID).length;
    await runPipelineTick();
    const runsAfter = (await listSchedulerRuns()).filter((run) => run.job === SLOW_JOB_ID).length;
    assert.equal(
      runsAfter,
      runsBefore,
      'a pipeline tick must not dispatch a duplicate run while the orphan is alive',
    );

    // Once the orphaned handler finally settles, the guard lifts and the job is runnable.
    gate.release();
    await pollUntil(
      () => getSchedulerSnapshot(),
      (snap) => snap.jobs.find((entry) => entry.name === SLOW_JOB_ID)?.running === false,
    );
  } finally {
    gate.release();
    unregisterLocalWorkerModule(FAKE_WORKER_ID);
    config.appDbPath = prevDbPath;
    setOpenAIApiKey(prevOpenaiKey);
    config.modelFallbackAliases = prevFallbacks;
    config.jobTimeoutMs = prevTimeout;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});

test('scheduler integration — transient job retries with backoff and records attempts', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'BFrost-sched-integration-'));
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
  const dir = await mkdtemp(path.join(os.tmpdir(), 'BFrost-sched-integration-'));
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
  const dir = await mkdtemp(path.join(os.tmpdir(), 'BFrost-sched-late-worker-'));
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

const HANDOFF_WORKER_ID = 'test.fake-handoff-worker';
const HANDOFF_PRODUCER_JOB_ID = 'test.fake-handoff-producer';
const HANDOFF_SLOW_JOB_ID = 'test.fake-handoff-slow';
const HANDOFF_CONSUMER_JOB_ID = 'test.fake-handoff-consumer';

/**
 * A two-stage pipeline plus an unrelated slow job, all eligible on the same tick.
 *
 * The consumer's work only exists once the producer has run — the shape of every handoff in
 * this codebase, where stages pass work through item metadata and emit no bus event.
 */
function buildHandoffWorkerModule(state: {
  producerRan: boolean; consumerRan: boolean; slowGate: Promise<void>;
}): BackendWorkerModule {
  const base = {
    workerId: HANDOFF_WORKER_ID,
    defaultEnabled: true,
    defaultCron: '0 0 1 1 *',
    defaultModelAlias: 'gpt-5.4-mini',
    approvalRequiredDefault: false,
    approvalRequiredEditable: false,
    defaultPrompt: '',
    prompt: { editable: false as const },
    paramsSchema: z.object({}),
    defaultParams: {},
    dashboardFields: [],
  };
  return {
    manifest: {
      id: HANDOFF_WORKER_ID,
      name: 'Handoff Test Worker',
      version: '0.1.0',
      description: 'Fake worker used to test the post-success pipeline kick.',
      builtIn: false,
      jobs: [
        {
          ...base, id: HANDOFF_PRODUCER_JOB_ID, label: 'Producer', description: 'Opens work for the consumer.',
          hasWork: async () => !state.producerRan,
          run: async () => { state.producerRan = true; return { summary: 'produced', itemCount: 1 }; },
        },
        {
          // Keeps the tick in flight past PIPELINE_KICK_DELAY_MS. Belongs to the same worker
          // only for brevity; nothing about the race needs them related.
          ...base, id: HANDOFF_SLOW_JOB_ID, label: 'Slow', description: 'Unrelated slow job.',
          hasWork: async () => true,
          run: async () => { await state.slowGate; return { summary: 'slow done', itemCount: 0 }; },
        },
        {
          ...base, id: HANDOFF_CONSUMER_JOB_ID, label: 'Consumer', description: 'Needs the producer to have run.',
          hasWork: async () => state.producerRan && !state.consumerRan,
          run: async () => { state.consumerRan = true; return { summary: 'consumed', itemCount: 1 }; },
        },
      ],
    },
  };
}

test('a pipeline kick arriving during a long tick is not swallowed by it', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'BFrost-handoff-'));
  const prevDbPath = config.appDbPath;
  const prevOpenaiKey = resolveOpenAIApiKey();
  const prevFallbacks = config.modelFallbackAliases;
  config.appDbPath = path.join(dir, 'app.sqlite');
  setOpenAIApiKey('test-key');
  config.modelFallbackAliases = [];

  let releaseSlow: () => void = () => undefined;
  const state = {
    producerRan: false,
    consumerRan: false,
    slowGate: new Promise<void>((resolve) => { releaseSlow = resolve; }),
  };
  registerLoadedLocalModule(buildHandoffWorkerModule(state));

  try {
    await startScheduler();

    // One tick evaluates all three: producer and slow are eligible, the consumer is not yet.
    const tick = runPipelineTick();
    await pollUntil(async () => state.producerRan, (ran) => ran, 4000);

    // The producer's success fires a kick. Wait past PIPELINE_KICK_DELAY_MS so it lands
    // while the tick is still held open by the slow job — the interleaving that matters.
    await new Promise((resolve) => setTimeout(resolve, PIPELINE_KICK_DELAY_MS + 300));
    assert.equal(state.consumerRan, false, 'the consumer cannot have run while the tick is still in flight');

    releaseSlow();
    await tick;

    // The kick must survive the tick that absorbed it. Without a queued follow-up the
    // consumer waits a full PIPELINE_TICK_INTERVAL_MS (15 minutes) for work that was ready
    // seconds after the producer finished.
    await pollUntil(async () => state.consumerRan, (ran) => ran, 6000);
    assert.equal(state.consumerRan, true);
  } finally {
    await stopScheduler();
    unregisterLocalWorkerModule(HANDOFF_WORKER_ID);
    config.appDbPath = prevDbPath;
    setOpenAIApiKey(prevOpenaiKey);
    config.modelFallbackAliases = prevFallbacks;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});

const COALESCE_WORKER_ID = 'test.fake-coalesce-worker';
const COALESCE_GATE_JOB_ID = 'test.fake-coalesce-gate';
const COALESCE_PROBE_JOB_ID = 'test.fake-coalesce-probe';

test('many requests during one tick queue exactly one follow-up, not one each', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'BFrost-coalesce-'));
  const prevDbPath = config.appDbPath;
  const prevOpenaiKey = resolveOpenAIApiKey();
  const prevFallbacks = config.modelFallbackAliases;
  config.appDbPath = path.join(dir, 'app.sqlite');
  setOpenAIApiKey('test-key');
  config.modelFallbackAliases = [];

  let releaseGate: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
  let gateStarted: () => void = () => undefined;
  const started = new Promise<void>((resolve) => { gateStarted = resolve; });
  let gateRan = false;
  // Counts tick evaluations: a tick calls each eligible job's hasWork exactly once.
  let probeChecks = 0;

  const base = {
    workerId: COALESCE_WORKER_ID, defaultEnabled: true, defaultCron: '0 0 1 1 *',
    defaultModelAlias: 'gpt-5.4-mini', approvalRequiredDefault: false, approvalRequiredEditable: false,
    defaultPrompt: '', prompt: { editable: false as const }, paramsSchema: z.object({}),
    defaultParams: {}, dashboardFields: [],
  };
  registerLoadedLocalModule({
    manifest: {
      id: COALESCE_WORKER_ID, name: 'Coalesce Test Worker', version: '0.1.0',
      description: 'Fake worker used to test follow-up tick coalescing.', builtIn: false,
      jobs: [
        {
          ...base, id: COALESCE_GATE_JOB_ID, label: 'Gate', description: 'Holds the tick open.',
          hasWork: async () => !gateRan,
          run: async () => { gateStarted(); await gate; gateRan = true; return { summary: 'gate', itemCount: 0 }; },
        },
        {
          ...base, id: COALESCE_PROBE_JOB_ID, label: 'Probe', description: 'Counts tick evaluations.',
          hasWork: async () => { probeChecks += 1; return false; },
          run: async () => ({ summary: 'probe', itemCount: 0 }),
        },
      ],
    },
  });

  try {
    // Deliberately without startScheduler: no boot sweep or periodic timer, so every tick
    // observed here is one this test asked for.
    const tick = runPipelineTick();
    await started;
    assert.equal(probeChecks, 1, 'the first tick evaluated the probe once');

    const piledOn = Array.from({ length: 5 }, () => runPipelineTick());
    releaseGate();
    await Promise.all([tick, ...piledOn]);
    await pollUntil(async () => probeChecks, (n) => n >= 2, 3000);
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Five concurrent requests collapse into one follow-up, and that follow-up does not
    // chain again because nothing asked during it.
    assert.equal(probeChecks, 2);
  } finally {
    unregisterLocalWorkerModule(COALESCE_WORKER_ID);
    config.appDbPath = prevDbPath;
    setOpenAIApiKey(prevOpenaiKey);
    config.modelFallbackAliases = prevFallbacks;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});
