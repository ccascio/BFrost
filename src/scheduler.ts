import { promises as fs } from 'fs';
import cron, { ScheduledTask, type TaskContext } from 'node-cron';
import { getDefaultModelAlias } from './config';
import { loadAdminSettings, saveAdminSettings, schedulerStatePath, updateAdminJob, type AdminSettings, type CronJobUpdate, type CronJobSettings, jobLabels } from './admin-config';
import { type JobName, knownJobs, runNamedJob } from './job-runner';
import { getRegisteredWorkerJob, notifyOperatorChannels } from './workers/registry';
import type { WorkerJobDashboardField, WorkerJobPreset } from './workers/types';
import { recordEventSafe } from './event-log';
import { loadKvJson, saveKvJson } from './sqlite';
import {
  abandonRunningSchedulerRuns,
  finishSchedulerRun,
  listSchedulerRuns,
  recordSchedulerRunAttempt,
  startSchedulerRun,
  type SchedulerRunTrigger,
} from './scheduler-runs';
import { acquireSchedulerExecutionLock } from './scheduler-locks';
import { isWorkerEnabled, loadWorkerState, type WorkerStateStore } from './workers/state';
import { detach } from './process-lifecycle';
import type { WorkerJobRetryPolicy } from './workers/types';
import { getPreviousCronMatch } from './cron-internals';

const SCHEDULER_STATE_STORE_KEY = 'scheduler.state';
// Recover a missed slot if it elapsed within this window. Sized to cover a daily
// job (e.g. an 8am digest) after an overnight or full-workday outage/sleep, while
// still treating older slots as too stale to be worth replaying.
export const CATCHUP_WINDOW_MS = 26 * 60 * 60 * 1000; // 26 hours
export const PIPELINE_TICK_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_JOB_RETRY_POLICY: Required<WorkerJobRetryPolicy> = {
  maxRetries: 2,
  initialBackoffMs: 1_000,
  maxBackoffMs: 30_000,
  jitterRatio: 0.2,
};

/**
 * A missed slot is worth recovering only if it is in the past and not older than
 * the catch-up window. Shared by the node-cron missed-execution path (process alive
 * but timers froze during sleep) and the startup recovery path (process was not
 * running at all). `slotAgeMs` is `now - slotTime`.
 */
export function isRecoverableSlotAge(slotAgeMs: number): boolean {
  return slotAgeMs > 0 && slotAgeMs <= CATCHUP_WINDOW_MS;
}

type SchedulerJobDashboardField = WorkerJobDashboardField;

export interface SchedulerJobState {
  name: JobName;
  label: string;
  description: string;
  workerId: string;
  workerName: string;
  workerBuiltIn: boolean;
  workerEnabled: boolean;
  approvalRequiredEditable: boolean;
  enabled: boolean;
  cron: string;
  modelAlias: string;
  approvalRequired: boolean;
  promptEditable: boolean;
  promptHelpText?: string;
  promptExamples?: Array<{ label: string; description: string; value: string }>;
  prompt: string;
  params?: Record<string, unknown>;
  dashboardFields: SchedulerJobDashboardField[];
  presets: WorkerJobPreset[];
  effectiveModelAlias: string;
  running: boolean;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastStatus: 'idle' | 'success' | 'error' | 'skipped';
  lastSummary: string | null;
  lastError: string | null;
  lastTrigger: SchedulerRunTrigger | null;
  /**
   * Number of the most recent completed (non-running) runs that consecutively
   * ended with status `'error'`. 0 means the last finished run was not an error.
   * Used by the UI stuck-detector to surface a banner.
   */
  consecutiveErrors?: number;
}

interface PersistedSchedulerState {
  jobs: Partial<
    Record<
      JobName,
      Omit<
        SchedulerJobState,
        | 'name'
        | 'label'
        | 'description'
        | 'workerId'
        | 'workerName'
        | 'workerBuiltIn'
        | 'workerEnabled'
        | 'approvalRequiredEditable'
        | 'enabled'
        | 'cron'
        | 'modelAlias'
        | 'approvalRequired'
        | 'promptEditable'
        | 'promptHelpText'
        | 'promptExamples'
        | 'prompt'
        | 'dashboardFields'
        | 'presets'
        | 'effectiveModelAlias'
      >
    >
  >;
}

let settingsCache: AdminSettings | null = null;
let runtimeCache: Partial<Record<JobName, SchedulerJobState>> = {};
let started = false;
const tasks = new Map<JobName, ScheduledTask>();
let pipelineTickTimer: NodeJS.Timeout | null = null;
let pipelineTickInFlight: Promise<PipelineTickResult> | null = null;

// Coalesce concurrent reloadSchedules() calls: at most one in-flight + one queued.
// All callers read the same fresh settings, so there is no value in running more
// than two reloads back-to-back.
let reloadInFlight: Promise<void> | null = null;
let reloadQueued = false;

// FIFO job execution queue: serialises all runJobWork() calls so jobs never run
// concurrently.  A hung job blocks the queue; add a per-job timeout if that
// becomes a problem (TODO: job timeout).
let jobChain: Promise<void> = Promise.resolve();

function enqueueJobExecution(work: () => Promise<void>): Promise<void> {
  const next = jobChain.then(() =>
    work().catch((err) => {
      console.error('[Scheduler] Queued job error:', err);
    }),
  );
  jobChain = next;
  return next;
}

export async function startScheduler(): Promise<void> {
  if (started) {
    return;
  }

  started = true;
  await hydrateRuntime();
  await reconcileAbandonedRuns();
  await reloadSchedules();
  startPipelineTick();
}

export async function stopScheduler(): Promise<void> {
  if (!started) {
    return;
  }

  for (const [name, task] of tasks.entries()) {
    task.stop();
    task.destroy();
    tasks.delete(name);
  }

  if (pipelineTickTimer) {
    clearInterval(pipelineTickTimer);
    pipelineTickTimer = null;
  }

  started = false;
}

export interface PipelineTickResult {
  checked: number;
  triggered: number;
  skipped: number;
  errors: number;
}

export async function runPipelineTick(): Promise<PipelineTickResult> {
  if (pipelineTickInFlight) {
    return pipelineTickInFlight;
  }

  pipelineTickInFlight = doRunPipelineTick().finally(() => {
    pipelineTickInFlight = null;
  });
  return pipelineTickInFlight;
}

export async function getSchedulerSnapshot(): Promise<{ timezone: string; jobs: SchedulerJobState[] }> {
  const workerState = await loadWorkerState();

  // Load recent runs to compute per-job consecutive error counts (stuck detector).
  const recentRuns = await listSchedulerRuns(30).catch((err) => {
    console.warn('[Scheduler] Failed to load recent scheduler runs:', err);
    return [];
  });
  const consecutiveErrorsByJob = computeConsecutiveErrors(recentRuns);
  const settings = await ensureSettings();
  const jobNames = knownJobs();

  return {
    timezone: settings.timezone,
    jobs: jobNames.map((name) =>
      buildJobState(name, settings.jobs[name], workerState, consecutiveErrorsByJob[name]),
    ),
  };
}

/**
 * Given an array of runs (newest-first), compute per-job consecutive error counts.
 * Only finished (non-running) runs contribute. Stops counting once a non-error run
 * is found for a given job.
 */
function computeConsecutiveErrors(runs: Array<{ job: string; status: string; finishedAt: string | null }>): Record<string, number> {
  const counts: Record<string, number> = {};
  const settled: Record<string, boolean> = {};

  for (const run of runs) {
    if (run.finishedAt === null) continue; // still running, skip
    if (settled[run.job]) continue; // already found a non-error run for this job
    if (run.status === 'error') {
      counts[run.job] = (counts[run.job] ?? 0) + 1;
    } else {
      settled[run.job] = true;
      if (!(run.job in counts)) counts[run.job] = 0;
    }
  }

  return counts;
}

export async function updateSchedulerJob(name: JobName, patch: CronJobUpdate): Promise<SchedulerJobState> {
  settingsCache = await updateAdminJob(name, patch);
  await reloadSchedules();
  const registered = getRegisteredWorkerJob(name);
  await recordEventSafe({
    category: 'scheduler',
    action: 'job_settings_updated',
    summary: `${jobLabels()[name]} settings updated.`,
    metadata: { job: name, workerId: registered.worker.id, workerName: registered.worker.name, patch },
  });
  const workerState = await loadWorkerState();
  return buildJobState(name, settingsCache.jobs[name], workerState);
}

export interface TriggerJobOptions {
  paramsOverride?: Record<string, unknown>;
  notifyOnCompletion?: boolean;
}

export async function triggerJobNow(name: JobName, options: TriggerJobOptions = {}): Promise<SchedulerJobState> {
  const settings = await ensureSettings();
  const jobSettings = settings.jobs[name];
  const registered = getRegisteredWorkerJob(name);
  const workerState = await loadWorkerState();
  const current = buildJobState(name, jobSettings, workerState);
  if (current.running) {
    throw new Error(`${jobLabels()[name]} is already running.`);
  }
  if (!current.workerEnabled) {
    throw new Error(`${current.workerName} worker is disabled.`);
  }

  const startedAt = new Date().toISOString();
  const runRecord = await startSchedulerRunSafe({
    job: name,
    label: jobLabels()[name],
    trigger: 'manual',
    modelAlias: current.effectiveModelAlias,
    startedAt,
  });
  runtimeCache[name] = { ...current, running: true, lastStartedAt: startedAt, lastTrigger: 'manual', lastError: null };
  await persistRuntime();
  await recordEventSafe({
    category: 'job',
    action: 'started',
    summary: `${jobLabels()[name]} started by manual.`,
    metadata: {
      job: name,
      workerId: registered.worker.id,
      workerName: registered.worker.name,
      trigger: 'manual',
      modelAlias: current.effectiveModelAlias,
    },
  });

  detach(enqueueJobExecution(() =>
    runJobWork(name, jobSettings, 'manual', startedAt, runRecord, current.effectiveModelAlias, {
      paramsOverride: options.paramsOverride,
      notifyOnCompletion: options.notifyOnCompletion ?? false,
    }),
  ), `scheduler:manual:${name}`);
  return buildJobState(name, jobSettings, workerState);
}

export async function reloadSchedulerSchedules(): Promise<void> {
  if (!started) {
    return;
  }
  await reloadSchedules();
}

function startPipelineTick(): void {
  if (pipelineTickTimer) {
    return;
  }

  pipelineTickTimer = setInterval(() => {
    detach(runPipelineTick(), 'scheduler:pipeline-tick');
  }, PIPELINE_TICK_INTERVAL_MS);
  pipelineTickTimer.unref?.();
}

async function doRunPipelineTick(): Promise<PipelineTickResult> {
  const settings = await ensureSettings();
  const workerState = await loadWorkerState();
  const result: PipelineTickResult = { checked: 0, triggered: 0, skipped: 0, errors: 0 };

  for (const name of knownJobs()) {
    const jobSettings = settings.jobs[name];
    if (!jobSettings?.enabled) {
      result.skipped += 1;
      continue;
    }

    const registered = getRegisteredWorkerJob(name);
    if (!isWorkerEnabled(registered.worker.id, workerState)) {
      result.skipped += 1;
      continue;
    }
    if (!registered.job.hasWork) {
      result.skipped += 1;
      continue;
    }

    const current = buildJobState(name, jobSettings, workerState);
    if (current.running) {
      result.skipped += 1;
      continue;
    }

    result.checked += 1;
    let ready = false;
    try {
      ready = await registered.job.hasWork(jobSettings.params ?? {});
    } catch (err) {
      result.errors += 1;
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[Scheduler] Pipeline hasWork check failed for ${name}:`, err);
      await recordEventSafe({
        category: 'scheduler',
        action: 'pipeline_has_work_failed',
        severity: 'warning',
        summary: `${jobLabels()[name]} pipeline eligibility check failed.`,
        metadata: {
          job: name,
          workerId: registered.worker.id,
          workerName: registered.worker.name,
          error: message,
        },
      });
      continue;
    }

    if (!ready) {
      result.skipped += 1;
      continue;
    }

    try {
      const ran = await runJob(name, jobSettings, 'pipeline');
      if (ran) {
        result.triggered += 1;
      } else {
        result.skipped += 1;
      }
    } catch (err) {
      result.errors += 1;
      console.warn(`[Scheduler] Pipeline run failed for ${name}:`, err);
    }
  }

  return result;
}

async function reloadSchedules(): Promise<void> {
  if (reloadInFlight) {
    // A reload is already running — mark that another one should follow and wait.
    reloadQueued = true;
    await reloadInFlight;
    return;
  }

  reloadInFlight = (async () => {
    try {
      do {
        reloadQueued = false;
        await doReloadSchedules();
      } while (reloadQueued);
    } finally {
      reloadInFlight = null;
    }
  })();

  await reloadInFlight;
}

async function doReloadSchedules(): Promise<void> {
  let settings = await ensureSettings();
  let jobNames = knownJobs();
  // If a new community worker was just hot-activated, its jobs won't be in the
  // settings cache that was seeded at startup.  Clear the cache so normalizeSettings
  // runs again with the full knownJobs() list before we iterate.
  if (jobNames.some((name) => !settings.jobs[name])) {
    settingsCache = null;
    settings = await ensureSettings();
    jobNames = knownJobs();
  }
  const workerState = await loadWorkerState();

  for (const [name, task] of tasks.entries()) {
    task.stop();
    task.destroy();
    tasks.delete(name);
  }

  for (const name of jobNames) {
    const jobSettings = settings.jobs[name];
    const registered = getRegisteredWorkerJob(name);
    if (!jobSettings.enabled || !isWorkerEnabled(registered.worker.id, workerState)) {
      continue;
    }

    const task = cron.schedule(
      jobSettings.cron,
      (ctx) => {
        detach(
          runJob(name, jobSettings, 'schedule', { scheduledAt: ctx.date.toISOString() }),
          `scheduler:run:${name}`,
        );
      },
      {
        timezone: settings.timezone,
        name,
        noOverlap: true,
      },
    );
    task.on('execution:missed', (ctx) => {
      detach(
        recordSkippedScheduleExecution(name, jobSettings, 'missed', ctx),
        `scheduler:missed:${name}`,
      );
    });
    task.on('execution:overlap', (ctx) => {
      detach(
        recordSkippedScheduleExecution(name, jobSettings, 'overlap', ctx),
        `scheduler:overlap:${name}`,
      );
    });
    tasks.set(name, task);
  }
}

async function recordSkippedScheduleExecution(
  name: JobName,
  jobSettings: CronJobSettings,
  reason: 'missed' | 'overlap',
  ctx: TaskContext,
): Promise<void> {
  const now = new Date();
  const finishedAt = now.toISOString();
  const missedSlotTime = reason === 'missed' ? getMissedSlotTime(name, ctx.date) : null;
  if (reason === 'missed' && !missedSlotTime && ctx.date.getTime() > now.getTime()) {
    console.warn(
      `[Scheduler] Ignoring missed ${name} event with future context date ${ctx.date.toISOString()}.`,
    );
    return;
  }

  const slotTime = reason === 'missed' ? missedSlotTime ?? ctx.date : ctx.date;
  const scheduledAt = schedulerSlotIso(slotTime);
  const acquired = await acquireSchedulerExecutionLock({
    commandKey: schedulerCommandKey(name),
    scheduledAt,
  });
  if (!acquired) {
    console.warn(`[Scheduler] Duplicate ${reason} execution ignored for ${name} at ${scheduledAt}.`);
    return;
  }

  const registered = getRegisteredWorkerJob(name);
  const slotAgeMs = reason === 'missed' ? now.getTime() - slotTime.getTime() : 0;
  const slotAgeMin = Math.round(slotAgeMs / 60000);

  // Distinguish brief event-loop delay (seconds) from machine-sleep recovery (minutes/hours).
  const missedCause = reason === 'missed'
    ? slotAgeMs > 90_000
      ? `BFrost was offline or the machine was asleep (slot is ${slotAgeMin} min old)`
      : 'the Node event loop was briefly unavailable'
    : null;
  const reasonText = reason === 'missed'
    ? `missed its scheduled execution because ${missedCause}`
    : 'was skipped because a previous execution was still running';
  const message = `${jobLabels()[name]} ${reasonText}.`;

  // Always record the event first for full observability.
  await recordEventSafe({
    category: 'job',
    action: reason === 'missed' ? 'missed' : 'overlap_skipped',
    severity: 'warning',
    summary: message,
    metadata: {
      job: name,
      workerId: registered.worker.id,
      workerName: registered.worker.name,
      trigger: 'schedule',
      scheduledAt,
      contextDate: ctx.date.toISOString(),
      recordedAt: finishedAt,
      reason,
      ...(reason === 'missed' && { slotAgeMs, slotAgeMin }),
    },
  });

  // For missed executions, attempt a catch-up run if the missed slot is recent enough.
  // Misses are typically caused by macOS sleep freezing setTimeout timers; on wake-up
  // the heartbeat fires late and node-cron emits execution:missed for each skipped slot.
  if (reason === 'missed') {
    if (isRecoverableSlotAge(slotAgeMs)) {
      console.log(
        `[Scheduler] Missed ${name} execution (age: ${Math.round(slotAgeMs / 1000)}s) — catching up now.`,
      );
      // Reuse the slot lock acquired above so the catch-up run and skipped-run
      // bookkeeping stay mutually exclusive for this scheduled minute.
      detach(
        runJob(name, jobSettings, 'schedule', { scheduledAt, lockAlreadyAcquired: true }),
        `scheduler:missed-catchup:${name}`,
      );
      return; // Catch-up job records its own started/succeeded/failed events.
    }

    console.warn(
      `[Scheduler] Missed ${name} execution is ${slotAgeMin}min old — skipping catch-up (window: ${CATCHUP_WINDOW_MS / 60000}min). Cause: ${missedCause}.`,
    );
  }

  // Record as skipped: overlaps and stale misses that are outside the catch-up window.
  runtimeCache[name] = {
    ...buildJobState(name, jobSettings),
    running: false,
    lastStartedAt: scheduledAt,
    lastFinishedAt: finishedAt,
    lastStatus: 'skipped',
    lastSummary: null,
    lastError: message,
    lastTrigger: 'schedule',
  };

  const runRecord = await startSchedulerRunSafe({
    job: name,
    label: jobLabels()[name],
    trigger: 'schedule',
    modelAlias: jobSettings.modelAlias || getDefaultModelAlias(),
    startedAt: scheduledAt,
  });
  if (runRecord) {
    await finishSchedulerRunSafe(runRecord.id, {
      finishedAt,
      status: 'skipped',
      summary: null,
      error: message,
      itemCount: null,
    });
  }
  await persistRuntime();
}

/**
 * Recover the most recent missed run for each enabled job once at startup.
 *
 * node-cron's execution:missed event only fires while the process is alive (e.g.
 * macOS sleep freezing setTimeout timers). It can never fire for a slot that
 * elapsed while BFrost was not running at all — a powered-off or rebooted machine.
 * That is the gap this closes: after schedules are (re)loaded, for each job we look
 * at the single most recent scheduled slot and, if it elapsed within
 * CATCHUP_WINDOW_MS and was never executed, run it now.
 *
 * The per-slot execution lock makes this idempotent and mutually exclusive with the
 * normal scheduled and node-cron missed paths, so a slot is never run twice. We only
 * recover the latest slot (not every slot in the window) — "at least the last run".
 *
 * Call this once at boot *after* channels have started, so a recovered run that
 * notifies the operator (e.g. a digest) can be delivered. It reads the schedules
 * populated by `startScheduler`, so it must run after that.
 */
export async function catchUpMissedRunsOnStartup(): Promise<void> {
  const settings = await ensureSettings();
  const now = new Date();

  for (const name of tasks.keys()) {
    const jobSettings = settings.jobs[name];
    if (!jobSettings) continue;

    const slot = getMissedSlotTime(name, now);
    if (!slot) continue;

    const slotAgeMs = now.getTime() - slot.getTime();
    if (!isRecoverableSlotAge(slotAgeMs)) continue;

    const scheduledAt = schedulerSlotIso(slot);
    const acquired = await acquireSchedulerExecutionLock({
      commandKey: schedulerCommandKey(name),
      scheduledAt,
    });
    if (!acquired) {
      // The slot already ran (or was recorded as skipped) — nothing to recover.
      continue;
    }

    const registered = getRegisteredWorkerJob(name);
    const slotAgeMin = Math.round(slotAgeMs / 60000);
    console.log(
      `[Scheduler] Recovering missed ${name} execution from ${scheduledAt} ` +
        `(${slotAgeMin} min old) — BFrost was not running at the scheduled time.`,
    );
    await recordEventSafe({
      category: 'job',
      action: 'missed',
      severity: 'warning',
      summary: `${jobLabels()[name]} missed its scheduled execution while BFrost was offline — recovering now.`,
      metadata: {
        job: name,
        workerId: registered.worker.id,
        workerName: registered.worker.name,
        trigger: 'schedule',
        scheduledAt,
        slotAgeMs,
        slotAgeMin,
        recovery: 'startup',
      },
    });

    // Reuse the slot lock just acquired so the recovery run stays mutually exclusive
    // with any concurrent scheduled/missed execution for the same slot.
    detach(
      runJob(name, jobSettings, 'schedule', { scheduledAt, lockAlreadyAcquired: true }),
      `scheduler:startup-catchup:${name}`,
    );
  }
}

/**
 * Compute the actual missed slot time given the node-cron TaskContext date, which
 * is the NEXT scheduled slot after the missed one (node-cron advances
 * expectedNextExecution before calling onMissedExecution).
 *
 * Strategy: use the task's internal TimeMatcher (a public property on
 * InlineScheduledTask) to iterate through scheduled slots within 48h before
 * ctxDate and return the last one — that's the slot that was missed.
 *
 * Wrapped in try-catch so that if the internal API ever changes, catch-up silently
 * degrades rather than crashing the scheduler.
 */
function getMissedSlotTime(name: JobName, ctxDate: Date): Date | null {
  try {
    const task = tasks.get(name);
    if (!task) return null;

    return getPreviousCronMatch(task, ctxDate);
  } catch {
    return null;
  }
}

async function runJob(
  name: JobName,
  jobSettings: CronJobSettings,
  trigger: SchedulerRunTrigger,
  options: { scheduledAt?: string; lockAlreadyAcquired?: boolean } = {},
): Promise<boolean> {
  if (trigger === 'schedule' && !options.lockAlreadyAcquired) {
    const scheduledAt = options.scheduledAt ?? schedulerSlotIso(new Date());
    const acquired = await acquireSchedulerExecutionLock({
      commandKey: schedulerCommandKey(name),
      scheduledAt,
    });
    if (!acquired) {
      console.warn(`[Scheduler] Duplicate scheduled execution ignored for ${name} at ${scheduledAt}.`);
      return false;
    }
  }

  const workerState = await loadWorkerState();
  const registered = getRegisteredWorkerJob(name);
  const current = buildJobState(name, jobSettings, workerState);
  if (current.running) {
    throw new Error(`${jobLabels()[name]} is already running.`);
  }
  if (!current.workerEnabled) {
    throw new Error(`${current.workerName} worker is disabled.`);
  }
  if (trigger !== 'manual') {
    const ready = await shouldRunJob(name, jobSettings, trigger);
    if (!ready) {
      return false;
    }
  }

  const startedAt = new Date().toISOString();
  const runRecord = await startSchedulerRunSafe({
    job: name,
    label: jobLabels()[name],
    trigger,
    modelAlias: current.effectiveModelAlias,
    startedAt,
  });
  runtimeCache[name] = {
    ...current,
    running: true,
    lastStartedAt: startedAt,
    lastTrigger: trigger,
    lastError: null,
  };
  await persistRuntime();
  await recordEventSafe({
    category: 'job',
    action: 'started',
    summary: `${jobLabels()[name]} started by ${trigger}.`,
    metadata: {
      job: name,
      workerId: registered.worker.id,
      workerName: registered.worker.name,
      trigger,
      modelAlias: current.effectiveModelAlias,
    },
  });
  await enqueueJobExecution(() =>
    runJobWork(name, jobSettings, trigger, startedAt, runRecord, current.effectiveModelAlias),
  );
  return true;
}

async function shouldRunJob(
  name: JobName,
  jobSettings: CronJobSettings,
  trigger: SchedulerRunTrigger,
): Promise<boolean> {
  const registered = getRegisteredWorkerJob(name);
  if (!registered.job.hasWork) {
    return true;
  }

  let ready = false;
  try {
    ready = await registered.job.hasWork(jobSettings.params ?? {});
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordEventSafe({
      category: 'scheduler',
      action: 'has_work_failed',
      severity: 'warning',
      summary: `${jobLabels()[name]} eligibility check failed; running anyway.`,
      metadata: {
        job: name,
        workerId: registered.worker.id,
        workerName: registered.worker.name,
        trigger,
        error: message,
      },
    });
    return true;
  }

  if (ready) {
    return true;
  }

  if (trigger === 'schedule') {
    await recordNoWorkSkippedRun(name, jobSettings);
  }
  return false;
}

async function recordNoWorkSkippedRun(name: JobName, jobSettings: CronJobSettings): Promise<void> {
  const registered = getRegisteredWorkerJob(name);
  const now = new Date().toISOString();
  const message = `${jobLabels()[name]} skipped because no worker-declared work is ready.`;

  runtimeCache[name] = {
    ...buildJobState(name, jobSettings),
    running: false,
    lastStartedAt: now,
    lastFinishedAt: now,
    lastStatus: 'skipped',
    lastSummary: null,
    lastError: message,
    lastTrigger: 'schedule',
  };

  const runRecord = await startSchedulerRunSafe({
    job: name,
    label: jobLabels()[name],
    trigger: 'schedule',
    modelAlias: jobSettings.modelAlias || getDefaultModelAlias(),
    startedAt: now,
  });
  if (runRecord) {
    await finishSchedulerRunSafe(runRecord.id, {
      finishedAt: now,
      status: 'skipped',
      summary: null,
      error: message,
      itemCount: 0,
    });
  }
  await persistRuntime();
  await recordEventSafe({
    category: 'job',
    action: 'skipped',
    summary: message,
    metadata: {
      job: name,
      workerId: registered.worker.id,
      workerName: registered.worker.name,
      trigger: 'schedule',
      reason: 'no_work',
    },
  });
}

function schedulerCommandKey(name: JobName): string {
  return `job:${name}`;
}

function schedulerSlotIso(date: Date): string {
  const slot = new Date(date);
  slot.setSeconds(0, 0);
  return slot.toISOString();
}

interface RunJobWorkOptions {
  paramsOverride?: Record<string, unknown>;
  notifyOnCompletion?: boolean;
}

function normalizeRetryPolicy(policy: WorkerJobRetryPolicy | undefined): Required<WorkerJobRetryPolicy> {
  return {
    maxRetries: clampInt(policy?.maxRetries, DEFAULT_JOB_RETRY_POLICY.maxRetries, 0, 10),
    initialBackoffMs: clampInt(policy?.initialBackoffMs, DEFAULT_JOB_RETRY_POLICY.initialBackoffMs, 0, 300_000),
    maxBackoffMs: clampInt(policy?.maxBackoffMs, DEFAULT_JOB_RETRY_POLICY.maxBackoffMs, 0, 300_000),
    jitterRatio: clampNumber(policy?.jitterRatio, DEFAULT_JOB_RETRY_POLICY.jitterRatio, 0, 1),
  };
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), min), max);
}

function clampNumber(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(value, min), max);
}

export function retryDelayMs(
  attempt: number,
  policy: Required<WorkerJobRetryPolicy>,
  random = Math.random,
): number {
  const base = Math.min(
    policy.maxBackoffMs,
    policy.initialBackoffMs * 2 ** Math.max(0, attempt - 1),
  );
  if (base <= 0 || policy.jitterRatio <= 0) return Math.max(0, Math.round(base));
  const jitter = base * policy.jitterRatio * (random() * 2 - 1);
  return Math.max(0, Math.round(base + jitter));
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runJobWork(
  name: JobName,
  jobSettings: CronJobSettings,
  trigger: SchedulerRunTrigger,
  startedAt: string,
  runRecord: Awaited<ReturnType<typeof startSchedulerRunSafe>>,
  effectiveModelAlias: string,
  options: RunJobWorkOptions = {},
): Promise<void> {
  const registered = getRegisteredWorkerJob(name);
  const effectiveParams = options.paramsOverride ?? jobSettings.params;
  const retryPolicy = normalizeRetryPolicy(registered.job.retryPolicy);
  const maxAttempts = retryPolicy.maxRetries + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const attemptStartedAt = new Date().toISOString();
    try {
      const result = await runNamedJob(name, effectiveModelAlias, effectiveParams);
      const finishedAt = new Date().toISOString();
      if (runRecord) {
        await recordSchedulerRunAttemptSafe(runRecord.id, {
          attempt,
          startedAt: attemptStartedAt,
          finishedAt,
          status: 'success',
          summary: result.summary,
          error: null,
          itemCount: result.itemCount ?? null,
        });
      }
      runtimeCache[name] = {
        ...buildJobState(name, jobSettings),
        running: false,
        lastStartedAt: startedAt,
        lastFinishedAt: finishedAt,
        lastStatus: 'success',
        lastSummary: result.summary,
        lastError: null,
        lastTrigger: trigger,
      };
      await recordEventSafe({
        category: 'job',
        action: 'succeeded',
        summary: `${jobLabels()[name]} completed successfully.`,
        metadata: {
          job: name,
          workerId: registered.worker.id,
          workerName: registered.worker.name,
          trigger,
          modelAlias: result.modelAlias,
          itemCount: result.itemCount ?? null,
          startedAt,
          finishedAt,
          attempt,
          maxAttempts,
        },
      });
      if (runRecord) {
        await finishSchedulerRunSafe(runRecord.id, {
          finishedAt,
          status: 'success',
          summary: result.summary,
          error: null,
          itemCount: result.itemCount ?? null,
        });
      }
      break;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const finishedAt = new Date().toISOString();
      const skipped = message.includes('Could not acquire queue lock');
      const finalAttempt = skipped || attempt >= maxAttempts;
      const nextDelayMs = finalAttempt ? undefined : retryDelayMs(attempt, retryPolicy);

      if (runRecord) {
        await recordSchedulerRunAttemptSafe(runRecord.id, {
          attempt,
          startedAt: attemptStartedAt,
          finishedAt,
          status: skipped ? 'skipped' : 'error',
          summary: null,
          error: message,
          itemCount: null,
          ...(nextDelayMs !== undefined ? { nextDelayMs } : {}),
        });
      }

      if (!finalAttempt) {
        await recordEventSafe({
          category: 'job',
          action: 'retrying',
          severity: 'warning',
          summary: `${jobLabels()[name]} failed on attempt ${attempt}; retrying in ${Math.round(nextDelayMs! / 1000)}s.`,
          metadata: {
            job: name,
            workerId: registered.worker.id,
            workerName: registered.worker.name,
            trigger,
            error: message,
            attempt,
            maxAttempts,
            nextDelayMs,
          },
        });
        await sleep(nextDelayMs!);
        continue;
      }

      runtimeCache[name] = {
        ...buildJobState(name, jobSettings),
        running: false,
        lastStartedAt: startedAt,
        lastFinishedAt: finishedAt,
        lastStatus: skipped ? 'skipped' : 'error',
        lastSummary: null,
        lastError: message,
        lastTrigger: trigger,
      };
      await recordEventSafe({
        category: 'job',
        action: skipped ? 'skipped' : 'failed',
        severity: skipped ? 'warning' : 'error',
        summary: `${jobLabels()[name]} ${skipped ? 'was skipped' : 'failed'}.`,
        metadata: {
          job: name,
          workerId: registered.worker.id,
          workerName: registered.worker.name,
          trigger,
          error: message,
          startedAt,
          finishedAt,
          attempt,
          maxAttempts,
        },
      });
      if (runRecord) {
        await finishSchedulerRunSafe(runRecord.id, {
          finishedAt,
          status: skipped ? 'skipped' : 'error',
          summary: null,
          error: message,
          itemCount: null,
        });
      }
      break;
    }
  }

  await persistRuntime();

  if (options.notifyOnCompletion) {
    const finalState = runtimeCache[name];
    const text = finalState?.lastStatus === 'success' && finalState.lastSummary
      ? finalState.lastSummary
      : `${jobLabels()[name]} ${finalState?.lastStatus ?? 'finished'}: ${finalState?.lastError ?? 'no output'}`;
    try {
      await notifyOperatorChannels(text);
    } catch (err) {
      console.warn('[Scheduler] Failed to deliver chat-trigger notification:', err);
    }
  }
}

async function startSchedulerRunSafe(input: Parameters<typeof startSchedulerRun>[0]) {
  try {
    return await startSchedulerRun(input);
  } catch (err) {
    console.warn('[Scheduler] Failed to record scheduler run start:', err);
    return null;
  }
}

async function finishSchedulerRunSafe(
  id: string,
  input: Parameters<typeof finishSchedulerRun>[1],
): Promise<void> {
  try {
    await finishSchedulerRun(id, input);
  } catch (err) {
    console.warn('[Scheduler] Failed to record scheduler run finish:', err);
  }
}

async function recordSchedulerRunAttemptSafe(
  id: string,
  input: Parameters<typeof recordSchedulerRunAttempt>[1],
): Promise<void> {
  try {
    await recordSchedulerRunAttempt(id, input);
  } catch (err) {
    console.warn('[Scheduler] Failed to record scheduler run attempt:', err);
  }
}

async function ensureSettings(): Promise<AdminSettings> {
  if (!settingsCache) {
    settingsCache = await loadAdminSettings();
    await saveAdminSettings(settingsCache);
  }
  if (knownJobs().some((name) => !settingsCache?.jobs[name])) {
    settingsCache = await loadAdminSettings();
    await saveAdminSettings(settingsCache);
  }
  return settingsCache;
}

async function hydrateRuntime(): Promise<void> {
  const stored = await loadKvJson<PersistedSchedulerState>(SCHEDULER_STATE_STORE_KEY);
  if (stored !== null) {
    hydrateRuntimeFromState(stored);
    return;
  }

  try {
    const raw = await fs.readFile(schedulerStatePath(), 'utf8');
    const parsed = JSON.parse(raw) as PersistedSchedulerState;
    hydrateRuntimeFromState(parsed);
    await persistRuntime();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[Scheduler] Failed to read scheduler-state.json:', err);
    }
  }
}

async function reconcileAbandonedRuns(): Promise<void> {
  const finishedAt = new Date().toISOString();
  const result = await abandonRunningSchedulerRuns({
    finishedAt,
    error: 'BFrost stopped before this scheduler run finished.',
  }).catch((err) => {
    console.warn('[Scheduler] Failed to reconcile abandoned scheduler runs:', err);
    return { count: 0, abandoned: [] as { job: string; label: string; startedAt: string }[] };
  });

  if (result.count > 0) {
    const jobsSummary = result.abandoned
      .map((r) => `${r.label} (started ${r.startedAt})`)
      .join(', ');
    console.warn(`[Scheduler] Marked ${result.count} abandoned run(s) as failed: ${jobsSummary}`);
    await recordEventSafe({
      category: 'scheduler',
      action: 'abandoned_runs_reconciled',
      severity: 'warning',
      summary: `Marked ${result.count} abandoned scheduler run(s) as failed after startup: ${jobsSummary}`,
      metadata: { count: result.count, finishedAt, jobs: result.abandoned },
    });
  }
}

async function persistRuntime(): Promise<void> {
  const payload: PersistedSchedulerState = { jobs: {} };
  for (const name of knownJobs()) {
    const current = runtimeCache[name];
    if (!current) {
      continue;
    }
    payload.jobs[name] = {
      running: current.running,
      lastStartedAt: current.lastStartedAt,
      lastFinishedAt: current.lastFinishedAt,
      lastStatus: current.lastStatus,
      lastSummary: current.lastSummary,
      lastError: current.lastError,
      lastTrigger: current.lastTrigger,
    };
  }

  await saveKvJson(SCHEDULER_STATE_STORE_KEY, payload);
}

function hydrateRuntimeFromState(parsed: PersistedSchedulerState): void {
  for (const name of knownJobs()) {
    const saved = parsed.jobs?.[name];
    if (!saved) {
      continue;
    }
    runtimeCache[name] = {
      name,
      label: jobLabels()[name],
      description: getRegisteredWorkerJob(name).job.description,
      workerId: getRegisteredWorkerJob(name).worker.id,
      workerName: getRegisteredWorkerJob(name).worker.name,
      workerBuiltIn: getRegisteredWorkerJob(name).worker.builtIn,
      workerEnabled: true,
      approvalRequiredEditable: getRegisteredWorkerJob(name).job.approvalRequiredEditable,
      enabled: false,
      cron: '',
      modelAlias: '',
      approvalRequired: false,
      promptEditable: getRegisteredWorkerJob(name).job.prompt.editable,
      promptHelpText: getRegisteredWorkerJob(name).job.prompt.helpText,
      promptExamples: getRegisteredWorkerJob(name).job.prompt.examples,
      prompt: '',
      dashboardFields: getRegisteredWorkerJob(name).job.dashboardFields,
      presets: getRegisteredWorkerJob(name).job.presets ?? [],
      effectiveModelAlias: getDefaultModelAlias(),
      running: false,
      lastStartedAt: saved.lastStartedAt ?? null,
      lastFinishedAt: saved.lastFinishedAt ?? null,
      lastStatus: saved.lastStatus ?? 'idle',
      lastSummary: saved.lastSummary ?? null,
      lastError: saved.lastError ?? null,
      lastTrigger: saved.lastTrigger ?? null,
    };
  }
}

function buildJobState(
  name: JobName,
  settings: CronJobSettings,
  workerState?: WorkerStateStore,
  consecutiveErrors?: number,
): SchedulerJobState {
  const saved = runtimeCache[name];
  const effectiveModelAlias = settings.modelAlias || getDefaultModelAlias();
  const registered = getRegisteredWorkerJob(name);
  const workerEnabled = workerState ? isWorkerEnabled(registered.worker.id, workerState) : true;

  return {
    name,
    label: registered.job.label,
    description: registered.job.description,
    workerId: registered.worker.id,
    workerName: registered.worker.name,
    workerBuiltIn: registered.worker.builtIn,
    workerEnabled,
    approvalRequiredEditable: registered.job.approvalRequiredEditable,
    enabled: settings.enabled,
    cron: settings.cron,
    modelAlias: settings.modelAlias,
    approvalRequired: settings.approvalRequired,
    promptEditable: registered.job.prompt.editable,
    promptHelpText: registered.job.prompt.helpText,
    promptExamples: registered.job.prompt.examples,
    prompt: settings.prompt,
    params: settings.params,
    dashboardFields: registered.job.dashboardFields,
    presets: registered.job.presets ?? [],
    effectiveModelAlias,
    running: saved?.running ?? false,
    lastStartedAt: saved?.lastStartedAt ?? null,
    lastFinishedAt: saved?.lastFinishedAt ?? null,
    lastStatus: saved?.lastStatus ?? 'idle',
    lastSummary: saved?.lastSummary ?? null,
    lastError: saved?.lastError ?? null,
    lastTrigger: saved?.lastTrigger ?? null,
    consecutiveErrors: consecutiveErrors ?? 0,
  };
}
