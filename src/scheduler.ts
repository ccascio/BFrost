import { promises as fs } from 'fs';
import cron, { ScheduledTask, type TaskContext } from 'node-cron';
import { config, findModel, getDefaultModelAlias, resolveReasoningLevel } from './config';
import { loadAdminSettings, saveAdminSettings, schedulerStatePath, updateAdminJob, updatePlatformSettings, type AdminSettings, type CronJobUpdate, type CronJobSettings, jobLabels } from './admin-config';
import { type JobName, knownJobs, runNamedJob } from './job-runner';
import { getRegisteredWorkerJob, notifyOperatorChannels } from './workers/registry';
import type { WorkerJobDashboardField, WorkerJobPreset } from './workers/types';
import { recordEventSafe } from './event-log';
import { loadKvJson, saveKvJson } from './sqlite';
import {
  abandonRunningSchedulerRuns,
  finishSchedulerRun,
  listSchedulerRuns,
  recordMissedScheduledRun,
  recordSchedulerRunAttempt,
  startSchedulerRun,
  type SchedulerRunTrigger,
} from './scheduler-runs';
import { acquireSchedulerExecutionLock } from './scheduler-locks';
import { isWorkerEnabled, loadWorkerState, type WorkerStateStore } from './workers/state';
import { onItemPublished } from './jobs/item-bus';
import { detach } from './process-lifecycle';
import type { WorkerJobRetryPolicy } from './workers/types';
import { getPreviousCronMatch, installReliableCronMatcher } from './cron-internals';
import { reapExpiredQueueItems } from './jobs/queue';

const SCHEDULER_STATE_STORE_KEY = 'scheduler.state';
// Recover a missed slot if it elapsed within this window. Sized to cover a daily
// job (e.g. an 8am digest) after an overnight or full-workday outage/sleep, while
// still treating older slots as too stale to be worth replaying.
export const CATCHUP_WINDOW_MS = 26 * 60 * 60 * 1000; // 26 hours
export const PIPELINE_TICK_INTERVAL_MS = 15 * 60 * 1000;
// Coalescing window for Item Bus wakes: a producer publishing a burst of items
// wakes each subscribed job once, shortly after the first publish, instead of
// once per item. Kept well under a second so bus latency stays "immediate".
export const BUS_WAKE_DEBOUNCE_MS = 500;
// Delay before the post-success pipeline kick. Long enough for the finished
// run's queue writes to settle and for back-to-back successes to coalesce into
// one tick; short enough that a multi-stage pipeline cascades in seconds.
export const PIPELINE_KICK_DELAY_MS = 2_000;
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
  /** Next cron slot for an active schedule, or null when the job is not scheduled. */
  nextScheduledAt: string | null;
  modelAlias: string;
  /** Reasoning level override for this job ('' = follow the platform default). */
  reasoningLevel: string;
  approvalRequired: boolean;
  promptEditable: boolean;
  promptHelpText?: string;
  promptExamples?: Array<{ label: string; description: string; value: string }>;
  prompt: string;
  params?: Record<string, unknown>;
  dashboardFields: SchedulerJobDashboardField[];
  presets: WorkerJobPreset[];
  effectiveModelAlias: string;
  /** Level the next run will actually use ('' when the effective model has no levels). */
  effectiveReasoningLevel: string;
  /** Accepted into the global FIFO but not executing yet. */
  queued: boolean;
  queuedAt: string | null;
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
        | 'nextScheduledAt'
        | 'modelAlias'
        | 'reasoningLevel'
        | 'approvalRequired'
        | 'promptEditable'
        | 'promptHelpText'
        | 'promptExamples'
        | 'prompt'
        | 'dashboardFields'
        | 'presets'
        | 'effectiveModelAlias'
        | 'effectiveReasoningLevel'
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
/** Set when a tick is requested while one is running. See `runPipelineTick`. */
let pipelineTickQueued = false;
let busWakeUnsubscribe: (() => void) | null = null;
const busWakeTimers = new Map<JobName, NodeJS.Timeout>();
const busWakeRequestedVersion = new Map<JobName, number>();
const busWakeHandledVersion = new Map<JobName, number>();
let pipelineKickTimer: NodeJS.Timeout | null = null;
let bootSweepTimer: NodeJS.Timeout | null = null;

// Coalesce concurrent reloadSchedules() calls: at most one in-flight + one queued.
// All callers read the same fresh settings, so there is no value in running more
// than two reloads back-to-back.
let reloadInFlight: Promise<void> | null = null;
let reloadQueued = false;

// Bounded job execution pool. This used to be a single FIFO chain, which meant one slow
// job delayed every job behind it — with jobs routinely taking 30-90s each, a busy tick
// serialised into many minutes of latency.
//
// Admission is still FIFO, but up to `config.jobMaxConcurrency` runs proceed at once,
// under one additional rule: **parallel across workers, serial within a worker.**
//
// The scope of what is actually safe here is narrow, so it is worth being precise. Node is
// single-threaded and better-sqlite3 executes each statement synchronously, so no two runs
// interleave mid-*statement*. That protects a single statement — it does NOT protect a
// read-modify-write pair spanning an `await`, which is exactly what two jobs of the same
// worker would do against their shared `worker_<id>_*` tables and `worker.<id>.*` KV.
// Hence the per-worker lock below. Across *different* workers there is no shared mutable
// state to contend for: storage is namespaced per worker, and Item Bus consumers each write
// into their own `metadata[consumerWorkerId]` slot.
//
// A given job still never runs twice concurrently — that is the `queued || running` guard,
// which `hasAbandonedRun` extends to cover timed-out-but-still-executing handlers.
let activeJobCount = 0;
const jobSlotWaiters: Array<() => void> = [];
/** Workers with a run in flight, and the queues of runs waiting on each. */
const busyWorkers = new Set<string>();
const workerLockWaiters = new Map<string, Array<() => void>>();

function acquireWorkerLock(workerId: string): Promise<void> {
  if (!busyWorkers.has(workerId)) {
    busyWorkers.add(workerId);
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const waiters = workerLockWaiters.get(workerId) ?? [];
    waiters.push(resolve);
    workerLockWaiters.set(workerId, waiters);
  });
}

function releaseWorkerLock(workerId: string): void {
  const waiters = workerLockWaiters.get(workerId);
  const next = waiters?.shift();
  if (waiters && waiters.length === 0) workerLockWaiters.delete(workerId);
  // Hand the lock straight to the next waiter rather than clearing it, so a third run
  // cannot slip in between release and hand-off.
  if (next) next();
  else busyWorkers.delete(workerId);
}

function acquireJobSlot(): Promise<void> {
  const limit = Math.max(1, Math.floor(config.jobMaxConcurrency));
  if (activeJobCount < limit) {
    activeJobCount += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    jobSlotWaiters.push(() => {
      activeJobCount += 1;
      resolve();
    });
  });
}

function releaseJobSlot(): void {
  activeJobCount = Math.max(0, activeJobCount - 1);
  // Re-check the limit on release: it can be lowered at runtime, and waking a waiter
  // unconditionally would let the pool drift above the new ceiling.
  const limit = Math.max(1, Math.floor(config.jobMaxConcurrency));
  if (activeJobCount < limit) jobSlotWaiters.shift()?.();
}

/** Number of job runs currently executing. Exposed for diagnostics and tests. */
export function activeJobExecutionCount(): number {
  return activeJobCount;
}

async function enqueueJobExecution(name: JobName, work: () => Promise<void>): Promise<void> {
  const workerId = getRegisteredWorkerJob(name).worker.id;
  // Take the per-worker lock first, so a run waiting on a sibling job does not sit on a
  // pool slot while it waits. Deadlock is not possible: the lock holder always makes
  // progress on its own (it either holds a slot or is queued for one), and slots are only
  // ever released, never re-entered from inside a run.
  await acquireWorkerLock(workerId);
  try {
    await acquireJobSlot();
    try {
      await work();
    } finally {
      releaseJobSlot();
    }
  } catch (err) {
    console.error('[Scheduler] Queued job error:', err);
  } finally {
    releaseWorkerLock(workerId);
  }
}

/**
 * Raised when a job attempt outruns `config.jobTimeoutMs`.
 *
 * Important limitation: worker job handlers are `run(modelId, params)` with no AbortSignal,
 * so there is no way to actually cancel one without breaking the worker-facing contract.
 * This deadline therefore stops the *scheduler* waiting — it frees the pool slot, records
 * the run as failed and releases the job's `running` flag. The orphaned handler keeps going
 * in the background until it finishes on its own. That still fixes the reported problem
 * (one runaway job stalling every other job); it is not a way to reclaim CPU or API budget.
 */
export class JobTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} exceeded its ${Math.round(timeoutMs / 1000)}s time budget and was abandoned by the scheduler.`);
    this.name = 'JobTimeoutError';
  }
}

/**
 * Jobs whose attempt blew its deadline but whose handler is still executing.
 *
 * A timeout releases the *pool slot* immediately — that is what restores throughput. It must
 * NOT release the *job's* in-flight guard: the handler is still running, still writing to
 * that worker's KV/DB and still publishing to the bus. Clearing `running` here would let the
 * very next pipeline tick dispatch a second run of the same job on top of the first. So the
 * job keeps reporting `running` until its abandoned handler actually settles.
 */
const abandonedJobRuns = new Set<JobName>();

/** True while `name` has an abandoned-but-still-executing handler. */
function hasAbandonedRun(name: JobName): boolean {
  return abandonedJobRuns.has(name);
}

/** Reject once `timeoutMs` elapses, leaving the underlying work to settle on its own. */
function withJobDeadline<T>(work: Promise<T>, name: JobName, label: string, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      abandonedJobRuns.add(name);
      reject(new JobTimeoutError(label, timeoutMs));
    }, timeoutMs);
  });
  // Settle handling serves two purposes: it lifts the duplicate-run guard once the orphan
  // finally finishes, and it ensures an abandoned rejection is never left unhandled.
  const forget = () => { abandonedJobRuns.delete(name); };
  work.then(forget, forget);
  return Promise.race([work, deadline]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export async function startScheduler(): Promise<void> {
  if (started) {
    return;
  }

  started = true;
  await hydrateRuntime();
  await reconcileAbandonedRuns();
  await reloadSchedules();
  await reapExpiredQueueItems().catch((err) => {
    console.warn('[Scheduler] Item Bus boot reaper failed:', err instanceof Error ? err.message : err);
  });
  startPipelineTick();
  startBusWake();
  scheduleBootPipelineSweep();
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

  if (bootSweepTimer) {
    clearTimeout(bootSweepTimer);
    bootSweepTimer = null;
  }

  stopBusWake();

  // A follow-up tick requested during a tick that is still settling must not fire against a
  // stopped scheduler.
  pipelineTickQueued = false;
  started = false;
}

export interface PipelineTickResult {
  checked: number;
  triggered: number;
  skipped: number;
  errors: number;
}

/**
 * Run one pipeline tick, coalescing concurrent callers onto the in-flight one.
 *
 * A tick evaluates every job's `hasWork` **once, at the moment it starts**, then waits for
 * everything it dispatched. So a request arriving mid-tick is not a duplicate: it means
 * state changed *after* those checks were taken, and the jobs the tick already judged idle
 * were judged on stale information.
 *
 * Sharing the in-flight promise without remembering the request silently dropped exactly the
 * handoff the post-success kick exists to deliver. A producer finishing early in a tick fires
 * `schedulePipelineKick`; if any other job in that same tick outlives the two-second delay —
 * an LLM-backed run routinely does — the kick resolves to the running tick, which had already
 * decided the consumer had nothing to do. The consumer then waits a full
 * `PIPELINE_TICK_INTERVAL_MS` for work that was ready seconds after the producer finished,
 * and each further stage waits another tick behind it.
 *
 * So a mid-tick request queues exactly one follow-up, the same way `reloadSchedules` handles
 * a reload requested during a reload. It is bounded: the follow-up only chains again if
 * something asks during *it*, and `hasWork` still gates whether anything actually runs.
 */
export async function runPipelineTick(): Promise<PipelineTickResult> {
  if (pipelineTickInFlight) {
    pipelineTickQueued = true;
    return pipelineTickInFlight;
  }

  const run = doRunPipelineTick().finally(() => {
    pipelineTickInFlight = null;
  });
  pipelineTickInFlight = run;
  const result = await run;

  if (pipelineTickQueued) {
    pipelineTickQueued = false;
    // Detached: this caller asked for one tick and already has its result. Awaiting the
    // follow-up here would make every caller's latency depend on work it did not request.
    detach(runPipelineTick(), 'scheduler:pipeline-tick-followup');
  }
  return result;
}

export async function getSchedulerSnapshot(): Promise<{ timezone: string; automaticMissedRunRecovery: boolean; jobs: SchedulerJobState[] }> {
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
    automaticMissedRunRecovery: settings.platform.automaticMissedRunRecovery,
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

/**
 * Change the safety policy for runs missed while BFrost was offline or asleep.
 * This takes effect immediately and is persisted with the other platform settings.
 */
export async function updateAutomaticMissedRunRecovery(enabled: boolean): Promise<boolean> {
  settingsCache = await updatePlatformSettings({ automaticMissedRunRecovery: enabled });
  await recordEventSafe({
    category: 'scheduler',
    action: 'automatic_missed_run_recovery_updated',
    summary: `Automatic missed-job recovery ${enabled ? 'enabled' : 'disabled'}.`,
    metadata: { enabled },
  });
  return settingsCache.platform.automaticMissedRunRecovery;
}

export interface TriggerJobOptions {
  paramsOverride?: Record<string, unknown>;
  notifyOnCompletion?: boolean;
}

export async function triggerJobNow(name: JobName, options: TriggerJobOptions = {}): Promise<SchedulerJobState> {
  const settings = await ensureSettings();
  const jobSettings = settings.jobs[name];
  const workerState = await loadWorkerState();
  const current = buildJobState(name, jobSettings, workerState);
  if (current.queued || current.running) {
    throw new JobBusyError(`${jobLabels()[name]} is already queued or running.`);
  }
  if (!current.workerEnabled) {
    throw new Error(`${current.workerName} worker is disabled.`);
  }

  await markJobQueued(name, current, 'manual');

  detach(enqueueJobExecution(name, () =>
    executeQueuedJob(name, jobSettings, 'manual', current.effectiveModelAlias, {
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
    detach(reapExpiredQueueItems(), 'scheduler:item-bus-reaper');
    detach(runPipelineTick(), 'scheduler:pipeline-tick');
  }, PIPELINE_TICK_INTERVAL_MS);
  pipelineTickTimer.unref?.();
}

/**
 * Sweep the pipeline once shortly after startup so a backlog that accumulated while BFrost
 * was down is picked up promptly instead of waiting for the first periodic tick.
 *
 * Without this, a freshly started BFrost sits idle for up to a full tick interval (15
 * minutes) even with a large backlog already waiting: `startPipelineTick` only sets an
 * interval, and the Item Bus wake path fires on *new* publishes, so items already on the bus
 * before boot wake nothing.
 *
 * Uses the same guards as every other trigger path (enabled, worker enabled, not running,
 * `hasWork`), so on an empty desk this is a cheap no-op.
 */
function scheduleBootPipelineSweep(): void {
  if (bootSweepTimer) {
    return;
  }

  bootSweepTimer = setTimeout(() => {
    bootSweepTimer = null;
    if (!started) return;
    detach(runPipelineTick(), 'scheduler:boot-sweep');
  }, config.pipelineBootSweepMs);
  bootSweepTimer.unref?.();
}

/**
 * Event-driven wakes: whenever an item lands on the Item Bus, jobs whose manifest
 * declares its `itemType` in `wakeOn` are triggered within BUS_WAKE_DEBOUNCE_MS
 * instead of waiting for the next pipeline tick. The wake path applies the same
 * guards as the tick (enabled, worker enabled, not running, `hasWork`), so a
 * spurious wake is a cheap no-op and a missed one is repaired by the tick.
 */
function startBusWake(): void {
  if (busWakeUnsubscribe) {
    return;
  }
  busWakeUnsubscribe = onItemPublished((event) => {
    for (const name of jobsWakingOn(event.itemType)) {
      scheduleBusWake(name);
    }
  });
}

function stopBusWake(): void {
  if (busWakeUnsubscribe) {
    busWakeUnsubscribe();
    busWakeUnsubscribe = null;
  }
  for (const timer of busWakeTimers.values()) {
    clearTimeout(timer);
  }
  busWakeTimers.clear();
  busWakeRequestedVersion.clear();
  busWakeHandledVersion.clear();
  if (pipelineKickTimer) {
    clearTimeout(pipelineKickTimer);
    pipelineKickTimer = null;
  }
}

/** Debounced "run the pipeline tick soon" — used after a successful run produced items. */
function schedulePipelineKick(): void {
  if (!started || pipelineKickTimer) {
    return;
  }
  pipelineKickTimer = setTimeout(() => {
    pipelineKickTimer = null;
    detach(runPipelineTick(), 'scheduler:pipeline-kick');
  }, PIPELINE_KICK_DELAY_MS);
  pipelineKickTimer.unref?.();
}

function jobsWakingOn(itemType: string): JobName[] {
  const woken: JobName[] = [];
  for (const name of knownJobs()) {
    try {
      const registered = getRegisteredWorkerJob(name);
      if (registered.job.wakeOn?.includes(itemType)) {
        woken.push(name);
      }
    } catch {
      // A job can disappear between knownJobs() and lookup (local worker unloads); skip.
    }
  }
  return woken;
}

function scheduleBusWake(name: JobName): void {
  busWakeRequestedVersion.set(name, (busWakeRequestedVersion.get(name) ?? 0) + 1);
  schedulePendingBusWake(name);
}

function schedulePendingBusWake(name: JobName): void {
  if ((busWakeRequestedVersion.get(name) ?? 0) <= (busWakeHandledVersion.get(name) ?? 0)) return;
  if (busWakeTimers.has(name)) {
    return; // A wake is already pending for this job; the burst is coalesced into it.
  }
  const timer = setTimeout(() => {
    busWakeTimers.delete(name);
    detach(runBusWake(name), `scheduler:bus-wake:${name}`);
  }, BUS_WAKE_DEBOUNCE_MS);
  timer.unref?.();
  busWakeTimers.set(name, timer);
}

async function runBusWake(name: JobName): Promise<void> {
  const requestedVersion = busWakeRequestedVersion.get(name) ?? 0;
  if (requestedVersion <= (busWakeHandledVersion.get(name) ?? 0)) return;
  const settings = await ensureSettings();
  const jobSettings = settings.jobs[name];
  if (!jobSettings?.enabled) {
    busWakeHandledVersion.set(name, requestedVersion);
    return;
  }
  const workerState = await loadWorkerState();
  const registered = getRegisteredWorkerJob(name);
  if (!isWorkerEnabled(registered.worker.id, workerState)) {
    busWakeHandledVersion.set(name, requestedVersion);
    return;
  }
  const current = buildJobState(name, jobSettings, workerState);
  if (current.queued || current.running) {
    // Keep this generation unhandled. The running/queued pass schedules the latched
    // wake when it completes, so an item published during the pass cannot be lost.
    return;
  }
  try {
    await runJob(name, jobSettings, 'event');
    busWakeHandledVersion.set(name, requestedVersion);
  } catch (err) {
    if (!(err instanceof JobBusyError)) {
      console.warn(`[Scheduler] Bus wake failed for ${name}:`, err);
    }
    // JobBusyError: the job got queued between our pre-check and runJob. Leave this
    // generation unhandled — like the pre-check path above — so the completion latch
    // (or the next pipeline tick) re-delivers the wake.
  } finally {
    schedulePendingBusWake(name);
  }
}

/**
 * Test seam: run the wake path for one item type right now, skipping the
 * subscription + debounce plumbing. Returns the jobs that were actually started.
 */
export async function wakeJobsForItemType(itemType: string): Promise<JobName[]> {
  const startedJobs: JobName[] = [];
  for (const name of jobsWakingOn(itemType)) {
    busWakeRequestedVersion.set(name, (busWakeRequestedVersion.get(name) ?? 0) + 1);
    const before = runtimeCache[name]?.lastStartedAt ?? null;
    await runBusWake(name);
    const after = runtimeCache[name]?.lastStartedAt ?? null;
    if (after !== before) {
      startedJobs.push(name);
    }
  }
  return startedJobs;
}

async function doRunPipelineTick(): Promise<PipelineTickResult> {
  const settings = await ensureSettings();
  const workerState = await loadWorkerState();
  const result: PipelineTickResult = { checked: 0, triggered: 0, skipped: 0, errors: 0 };
  const dispatched: Array<Promise<void>> = [];

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
    if (current.running || current.queued) {
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

    // Dispatch without awaiting completion. Awaiting here would serialise the whole tick
    // regardless of the execution pool — every eligible job would wait for the previous
    // one to finish. Actual concurrency stays bounded by `config.jobMaxConcurrency`, which
    // `enqueueJobExecution` enforces; this loop only decides what is eligible to start.
    dispatched.push(
      runJob(name, jobSettings, 'pipeline').then(
        (ran) => {
          if (ran) result.triggered += 1;
          else result.skipped += 1;
        },
        (err) => {
          if (err instanceof JobBusyError) {
            // Another trigger queued this job between hasWork and runJob — the queued
            // execution covers the pending work, so this is a coalesced no-op.
            result.skipped += 1;
            return;
          }
          result.errors += 1;
          console.warn(`[Scheduler] Pipeline run failed for ${name}:`, err);
        },
      ),
    );
  }

  // Settle every dispatched run before reporting, so the returned tally still describes a
  // completed tick and `runPipelineTick`'s in-flight guard continues to mean "tick done".
  await Promise.all(dispatched);

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

    const task = cron.createTask(
      jobSettings.cron,
      (ctx) => {
        detachJobTrigger(
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
    installReliableCronMatcher(task, jobSettings.cron, settings.timezone);
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
    task.start();
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
    const recoveryEnabled = (await ensureSettings()).platform.automaticMissedRunRecovery;
    if (recoveryEnabled && isRecoverableSlotAge(slotAgeMs)) {
      console.log(
        `[Scheduler] Missed ${name} execution (age: ${Math.round(slotAgeMs / 1000)}s) — catching up now.`,
      );
      // Reuse the slot lock acquired above so the catch-up run and skipped-run
      // bookkeeping stay mutually exclusive for this scheduled minute.
      detachJobTrigger(
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

  if (reason === 'missed') {
    // Collapses into this job's existing recovery entry when it already has one; the
    // per-slot detail stays in the `job/missed` event recorded above.
    await recordMissedScheduledRunSafe({
      job: name,
      label: jobLabels()[name],
      modelAlias: jobSettings.modelAlias || getDefaultModelAlias(),
      scheduledAt,
      recordedAt: finishedAt,
      error: message,
    });
  } else {
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
        skipReason: reason,
      });
    }
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
  const recoveryEnabled = settings.platform.automaticMissedRunRecovery;
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
    if (!recoveryEnabled) {
      const finishedAt = new Date().toISOString();
      const message = `${jobLabels()[name]} missed its scheduled execution while BFrost was offline; automatic recovery is disabled.`;
      console.log(`[Scheduler] ${message}`);
      await recordEventSafe({
        category: 'job',
        action: 'missed',
        severity: 'warning',
        summary: message,
        metadata: {
          job: name,
          workerId: registered.worker.id,
          workerName: registered.worker.name,
          trigger: 'schedule',
          scheduledAt,
          slotAgeMs,
          slotAgeMin,
          recovery: 'disabled',
        },
      });
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
      await recordMissedScheduledRunSafe({
        job: name,
        label: jobLabels()[name],
        modelAlias: jobSettings.modelAlias || getDefaultModelAlias(),
        scheduledAt,
        recordedAt: finishedAt,
        error: message,
      });
      await persistRuntime();
      continue;
    }
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
    detachJobTrigger(
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

/**
 * Thrown when a trigger finds its job already queued or running. For every
 * automatic trigger (schedule, pipeline tick, bus wake) this is a benign race —
 * the queued execution will do the work — so callers coalesce it into a quiet
 * skip instead of logging a failure. Only manual triggers surface it to the user.
 */
export class JobBusyError extends Error {}

/**
 * Wraps `detach` for automatic job triggers: a JobBusyError is swallowed with a
 * log line instead of being reported as a detached-promise rejection.
 */
function detachJobTrigger(promise: Promise<unknown>, label: string): void {
  detach(
    promise.catch((err) => {
      if (err instanceof JobBusyError) {
        console.log(`[Scheduler] ${err.message} Trigger ${label} coalesced into the existing run.`);
        return;
      }
      throw err;
    }),
    label,
  );
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
  const current = buildJobState(name, jobSettings, workerState);
  if (current.queued || current.running) {
    throw new JobBusyError(`${jobLabels()[name]} is already queued or running.`);
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

  // `shouldRunJob` may yield while another wake queues this same job. Re-read the
  // runtime immediately before claiming the FIFO slot so duplicate wakes coalesce.
  const readyState = buildJobState(name, jobSettings, workerState);
  if (readyState.queued || readyState.running) {
    throw new JobBusyError(`${jobLabels()[name]} is already queued or running.`);
  }
  await markJobQueued(name, readyState, trigger);
  await enqueueJobExecution(name, () =>
    executeQueuedJob(name, jobSettings, trigger, readyState.effectiveModelAlias),
  );
  return true;
}

async function markJobQueued(
  name: JobName,
  current: SchedulerJobState,
  trigger: SchedulerRunTrigger,
): Promise<void> {
  const queuedAt = new Date().toISOString();
  runtimeCache[name] = {
    ...current,
    queued: true,
    queuedAt,
    running: false,
    lastError: null,
  };
  await persistRuntime();
  const registered = getRegisteredWorkerJob(name);
  await recordEventSafe({
    category: 'job',
    action: 'queued',
    summary: `${jobLabels()[name]} queued by ${trigger}.`,
    metadata: {
      job: name,
      workerId: registered.worker.id,
      workerName: registered.worker.name,
      trigger,
      queuedAt,
      modelAlias: current.effectiveModelAlias,
    },
  });
}

async function executeQueuedJob(
  name: JobName,
  jobSettings: CronJobSettings,
  trigger: SchedulerRunTrigger,
  effectiveModelAlias: string,
  options: RunJobWorkOptions = {},
): Promise<void> {
  const startedAt = new Date().toISOString();
  const current = buildJobState(name, jobSettings);
  runtimeCache[name] = {
    ...current,
    queued: false,
    queuedAt: null,
    running: true,
    lastStartedAt: startedAt,
    lastTrigger: trigger,
    lastError: null,
  };
  await persistRuntime();
  const runRecord = await startSchedulerRunSafe({
    job: name,
    label: jobLabels()[name],
    trigger,
    modelAlias: effectiveModelAlias,
    startedAt,
  });
  const registered = getRegisteredWorkerJob(name);
  await recordEventSafe({
    category: 'job',
    action: 'started',
    summary: `${jobLabels()[name]} started by ${trigger}.`,
    metadata: {
      job: name,
      workerId: registered.worker.id,
      workerName: registered.worker.name,
      trigger,
      modelAlias: effectiveModelAlias,
    },
  });
  await runJobWork(name, jobSettings, trigger, startedAt, runRecord, effectiveModelAlias, options);
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
      skipReason: 'no_work',
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
      // Bound the attempt so a runaway job releases its pool slot instead of stalling the
      // whole desk. Applied per attempt (not per run) so the existing catch below performs
      // all the usual bookkeeping — run record, `running: false`, failure event.
      const result = await withJobDeadline(
        runNamedJob(name, effectiveModelAlias, effectiveParams, {
          reasoningLevel: jobSettings.reasoningLevel || undefined,
        }),
        name,
        jobLabels()[name],
        config.jobTimeoutMs,
      );
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
      if ((result.itemCount ?? 0) > 0) {
        // A run that produced or advanced items usually opens work for the next
        // pipeline stage (stages hand off via item metadata, which emits no bus
        // event). Kick a debounced tick so the chain cascades within seconds
        // instead of waiting for the next periodic tick.
        schedulePipelineKick();
      }
      break;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const finishedAt = new Date().toISOString();
      const skipped = message.includes('Could not acquire queue lock');
      // A job that blew its wall-clock budget will almost certainly blow it again, and each
      // retry would hold a pool slot for another full timeout. Fail it out immediately.
      const timedOut = err instanceof JobTimeoutError;
      const finalAttempt = skipped || timedOut || attempt >= maxAttempts;
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
  schedulePendingBusWake(name);

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

async function recordMissedScheduledRunSafe(
  input: Parameters<typeof recordMissedScheduledRun>[0],
): Promise<void> {
  try {
    await recordMissedScheduledRun(input);
  } catch (err) {
    console.warn('[Scheduler] Failed to record missed scheduled run:', err);
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
      queued: current.queued,
      queuedAt: current.queuedAt,
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
      nextScheduledAt: null,
      modelAlias: '',
      reasoningLevel: '',
      approvalRequired: false,
      promptEditable: getRegisteredWorkerJob(name).job.prompt.editable,
      promptHelpText: getRegisteredWorkerJob(name).job.prompt.helpText,
      promptExamples: getRegisteredWorkerJob(name).job.prompt.examples,
      prompt: '',
      dashboardFields: getRegisteredWorkerJob(name).job.dashboardFields,
      presets: getRegisteredWorkerJob(name).job.presets ?? [],
      effectiveModelAlias: getDefaultModelAlias(),
      effectiveReasoningLevel: '',
      queued: false,
      queuedAt: null,
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
  const effectiveModel = findModel(effectiveModelAlias);
  const effectiveReasoningLevel = effectiveModel
    ? resolveReasoningLevel(effectiveModel, settings.reasoningLevel) ?? ''
    : '';
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
    nextScheduledAt: tasks.get(name)?.getNextRun()?.toISOString() ?? null,
    modelAlias: settings.modelAlias,
    reasoningLevel: settings.reasoningLevel,
    approvalRequired: settings.approvalRequired,
    promptEditable: registered.job.prompt.editable,
    promptHelpText: registered.job.prompt.helpText,
    promptExamples: registered.job.prompt.examples,
    prompt: settings.prompt,
    params: settings.params,
    dashboardFields: registered.job.dashboardFields,
    presets: registered.job.presets ?? [],
    effectiveModelAlias,
    effectiveReasoningLevel,
    queued: saved?.queued ?? false,
    queuedAt: saved?.queuedAt ?? null,
    // An abandoned (timed-out) handler is still executing, so the job still counts as
    // in-flight. Deriving it here means every consumer agrees at once — the pipeline
    // tick's duplicate guard, `triggerJobNow`'s busy check, and the dashboard indicator.
    running: (saved?.running ?? false) || hasAbandonedRun(name),
    lastStartedAt: saved?.lastStartedAt ?? null,
    lastFinishedAt: saved?.lastFinishedAt ?? null,
    lastStatus: saved?.lastStatus ?? 'idle',
    lastSummary: saved?.lastSummary ?? null,
    lastError: saved?.lastError ?? null,
    lastTrigger: saved?.lastTrigger ?? null,
    consecutiveErrors: consecutiveErrors ?? 0,
  };
}
