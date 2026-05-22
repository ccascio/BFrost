import { promises as fs } from 'fs';
import cron, { ScheduledTask, type TaskContext } from 'node-cron';
import { getDefaultModelAlias } from './config';
import { loadAdminSettings, saveAdminSettings, schedulerStatePath, updateAdminJob, type AdminSettings, type CronJobUpdate, type CronJobSettings, jobLabels } from './admin-config';
import { type JobName, knownJobs, runNamedJob } from './job-runner';
import { getRegisteredWorkerJob, notifyOperatorChannels } from './workers/registry';
import type { WorkerJobDashboardField, WorkerJobPreset } from './workers/types';
import { recordEventSafe } from './event-log';
import { loadKvJson, saveKvJson } from './sqlite';
import { finishSchedulerRun, startSchedulerRun } from './scheduler-runs';
import { acquireSchedulerExecutionLock } from './scheduler-locks';
import { isWorkerEnabled, loadWorkerState, type WorkerStateStore } from './workers/state';

const SCHEDULER_STATE_STORE_KEY = 'scheduler.state';
const MISSED_CATCHUP_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

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
  lastTrigger: 'schedule' | 'manual' | null;
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

export async function startScheduler(): Promise<void> {
  if (started) {
    return;
  }

  started = true;
  await hydrateRuntime();
  await reloadSchedules();
}

export async function getSchedulerSnapshot(): Promise<{ timezone: string; jobs: SchedulerJobState[] }> {
  const settings = await ensureSettings();
  const workerState = await loadWorkerState();
  return {
    timezone: settings.timezone,
    jobs: knownJobs().map((name) => buildJobState(name, settings.jobs[name], workerState)),
  };
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

  void runJobWork(name, jobSettings, 'manual', startedAt, runRecord, current.effectiveModelAlias, {
    paramsOverride: options.paramsOverride,
    notifyOnCompletion: options.notifyOnCompletion ?? false,
  });
  return buildJobState(name, jobSettings, workerState);
}

export async function reloadSchedulerSchedules(): Promise<void> {
  if (!started) {
    return;
  }
  await reloadSchedules();
}

async function reloadSchedules(): Promise<void> {
  const settings = await ensureSettings();
  const workerState = await loadWorkerState();

  for (const [name, task] of tasks.entries()) {
    task.stop();
    task.destroy();
    tasks.delete(name);
  }

  for (const name of knownJobs()) {
    const jobSettings = settings.jobs[name];
    const registered = getRegisteredWorkerJob(name);
    if (!jobSettings.enabled || !isWorkerEnabled(registered.worker.id, workerState)) {
      continue;
    }

    const task = cron.schedule(
      jobSettings.cron,
      (ctx) => {
        void runJob(name, jobSettings, 'schedule', { scheduledAt: ctx.date.toISOString() });
      },
      {
        timezone: settings.timezone,
        name,
        noOverlap: true,
      },
    );
    task.on('execution:missed', (ctx) => {
      void recordSkippedScheduleExecution(name, jobSettings, 'missed', ctx);
    });
    task.on('execution:overlap', (ctx) => {
      void recordSkippedScheduleExecution(name, jobSettings, 'overlap', ctx);
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
  // ctx.date is the NEXT scheduled slot after the missed one (node-cron advances
  // expectedNextExecution before calling onMissedExecution).
  const nextScheduledAt = ctx.date.toISOString();
  const now = new Date();
  const finishedAt = now.toISOString();
  const registered = getRegisteredWorkerJob(name);
  const reasonText = reason === 'missed'
    ? 'missed its scheduled execution because the Node event loop was unavailable'
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
      scheduledAt: nextScheduledAt,
      recordedAt: finishedAt,
      reason,
    },
  });

  // For missed executions, attempt a catch-up run if the missed slot is recent enough.
  // Misses are typically caused by macOS sleep freezing setTimeout timers; on wake-up
  // the heartbeat fires late and node-cron emits execution:missed for each skipped slot.
  if (reason === 'missed') {
    const missedSlotTime = getMissedSlotTime(name, ctx.date);
    const ageMs = missedSlotTime ? now.getTime() - missedSlotTime.getTime() : Infinity;

    if (missedSlotTime && ageMs <= MISSED_CATCHUP_WINDOW_MS) {
      console.log(
        `[Scheduler] Missed ${name} execution (age: ${Math.round(ageMs / 1000)}s) — catching up now.`,
      );
      // Pass the original missed slot as scheduledAt so the execution lock deduplicates
      // correctly against any concurrent real fires for the same slot.
      void runJob(name, jobSettings, 'schedule', { scheduledAt: schedulerSlotIso(missedSlotTime) });
      return; // Catch-up job records its own started/succeeded/failed events.
    }

    console.warn(
      `[Scheduler] Missed ${name} execution is ${Math.round(ageMs / 60000)}min old — skipping catch-up (window: ${MISSED_CATCHUP_WINDOW_MS / 60000}min).`,
    );
  }

  // Record as skipped: overlaps and stale misses that are outside the catch-up window.
  runtimeCache[name] = {
    ...buildJobState(name, jobSettings),
    running: false,
    lastStartedAt: nextScheduledAt,
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
    startedAt: nextScheduledAt,
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

    // timeMatcher is a public property on InlineScheduledTask but not on the
    // ScheduledTask interface — access via unknown cast, guarded by try-catch.
    const timeMatcher = (task as unknown as { timeMatcher: { getNextMatch(d: Date): Date } })
      .timeMatcher;
    if (typeof timeMatcher?.getNextMatch !== 'function') return null;

    const ctxMs = ctxDate.getTime();
    let t = new Date(ctxMs - 48 * 60 * 60 * 1000); // start 48h before ctx.date
    let lastMatchBeforeCtx: Date | null = null;

    // Walk forward through scheduled slots, stopping just before ctxDate.
    for (let i = 0; i < 300; i++) {
      const nextT = timeMatcher.getNextMatch(t);
      if (nextT.getTime() >= ctxMs) break;
      lastMatchBeforeCtx = nextT;
      t = nextT;
    }

    return lastMatchBeforeCtx;
  } catch {
    return null;
  }
}

async function runJob(
  name: JobName,
  jobSettings: CronJobSettings,
  trigger: 'schedule' | 'manual',
  options: { scheduledAt?: string } = {},
): Promise<void> {
  if (trigger === 'schedule') {
    const scheduledAt = options.scheduledAt ?? schedulerSlotIso(new Date());
    const acquired = await acquireSchedulerExecutionLock({
      commandKey: schedulerCommandKey(name),
      scheduledAt,
    });
    if (!acquired) {
      console.warn(`[Scheduler] Duplicate scheduled execution ignored for ${name} at ${scheduledAt}.`);
      return;
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
  await runJobWork(name, jobSettings, trigger, startedAt, runRecord, current.effectiveModelAlias);
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

async function runJobWork(
  name: JobName,
  jobSettings: CronJobSettings,
  trigger: 'schedule' | 'manual',
  startedAt: string,
  runRecord: Awaited<ReturnType<typeof startSchedulerRunSafe>>,
  effectiveModelAlias: string,
  options: RunJobWorkOptions = {},
): Promise<void> {
  const registered = getRegisteredWorkerJob(name);
  const effectiveParams = options.paramsOverride ?? jobSettings.params;
  try {
    const result = await runNamedJob(name, effectiveModelAlias, effectiveParams);
    const finishedAt = new Date().toISOString();
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const finishedAt = new Date().toISOString();
    const skipped = message.includes('Could not acquire queue lock');
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

async function ensureSettings(): Promise<AdminSettings> {
  if (!settingsCache) {
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
  };
}
