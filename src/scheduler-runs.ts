import { randomUUID } from 'crypto';
import { z } from 'zod';
import { loadKvJson, saveKvJson } from './sqlite';
import type { JobName } from './job-runner';

const SCHEDULER_RUNS_STORE_KEY = 'scheduler.runs';
/**
 * How many run records the store keeps. Exported because the recovery UI must read
 * exactly this window: a dashboard slice narrower than the retention would show the
 * operator fewer recoverable jobs than "Recover all" actually acts on.
 */
export const SCHEDULER_RUN_RETENTION = 200;
const RUN_RETENTION = SCHEDULER_RUN_RETENTION;

// Every run is stored in one retained JSON document. Serialize read-modify-write
// operations so a job starting/finishing while the operator dismisses a missed run
// cannot restore an older snapshot and resurrect the dismissed record.
let runStoreOperations: Promise<void> = Promise.resolve();

function withRunStore<T>(operation: () => Promise<T>): Promise<T> {
  const result = runStoreOperations.then(operation);
  runStoreOperations = result.then(() => undefined, () => undefined);
  return result;
}

export const SchedulerRunStatusSchema = z.enum(['running', 'success', 'error', 'skipped']);
export const SchedulerRunTriggerSchema = z.enum(['schedule', 'manual', 'pipeline', 'event']);
export const SchedulerRunAttemptStatusSchema = z.enum(['success', 'error', 'skipped']);
export const SchedulerRunSkipReasonSchema = z.enum(['missed', 'overlap', 'no_work']);

const SchedulerRunAttemptSchema = z.object({
  attempt: z.number().int().min(1),
  startedAt: z.string(),
  finishedAt: z.string(),
  status: SchedulerRunAttemptStatusSchema,
  summary: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
  itemCount: z.number().nullable().optional(),
  nextDelayMs: z.number().int().nonnegative().optional(),
});

const SchedulerRunRecordSchema = z.object({
  id: z.string().min(1),
  job: z.string().min(1),
  label: z.string().min(1),
  trigger: SchedulerRunTriggerSchema,
  modelAlias: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  status: SchedulerRunStatusSchema,
  summary: z.string().nullable(),
  error: z.string().nullable(),
  itemCount: z.number().nullable(),
  skipReason: SchedulerRunSkipReasonSchema.nullable().optional(),
  /**
   * How many consecutive scheduled slots this missed record stands for. One record
   * is kept per job (see `recordMissedScheduledRun`), so an hourly job that missed a
   * night's worth of slots is one entry counting them rather than a dozen entries.
   */
  missedSlotCount: z.number().int().min(1).optional(),
  attempts: z.array(SchedulerRunAttemptSchema).default([]),
});

export const SchedulerRunRecordsSchema = z.array(SchedulerRunRecordSchema);
export type SchedulerRunStatus = z.infer<typeof SchedulerRunStatusSchema>;
export type SchedulerRunTrigger = z.infer<typeof SchedulerRunTriggerSchema>;
export type SchedulerRunAttempt = z.infer<typeof SchedulerRunAttemptSchema>;
export type SchedulerRunRecord = z.infer<typeof SchedulerRunRecordSchema>;

export interface SchedulerRunStartInput {
  job: JobName;
  label: string;
  trigger: SchedulerRunTrigger;
  modelAlias: string;
  startedAt: string;
}

export interface SchedulerRunFinishInput {
  finishedAt: string;
  status: Exclude<SchedulerRunStatus, 'running'>;
  summary?: string | null;
  error?: string | null;
  itemCount?: number | null;
  skipReason?: z.infer<typeof SchedulerRunSkipReasonSchema> | null;
}

export interface SchedulerRunAttemptInput {
  attempt: number;
  startedAt: string;
  finishedAt: string;
  status: z.infer<typeof SchedulerRunAttemptStatusSchema>;
  summary?: string | null;
  error?: string | null;
  itemCount?: number | null;
  nextDelayMs?: number;
}

export interface AbandonSchedulerRunsInput {
  finishedAt: string;
  error: string;
}

export interface MissedScheduledRunInput {
  job: JobName;
  label: string;
  modelAlias: string;
  /** The cron slot that did not execute. */
  scheduledAt: string;
  /** When the miss was observed — always later than the slot itself. */
  recordedAt: string;
  error: string;
}

export async function startSchedulerRun(input: SchedulerRunStartInput): Promise<SchedulerRunRecord> {
  const run: SchedulerRunRecord = {
    id: randomUUID(),
    job: input.job,
    label: input.label,
    trigger: input.trigger,
    modelAlias: input.modelAlias,
    startedAt: input.startedAt,
    finishedAt: null,
    status: 'running',
    summary: null,
    error: null,
    itemCount: null,
    skipReason: null,
    attempts: [],
  };
  return withRunStore(async () => {
    const runs = await loadSchedulerRuns(RUN_RETENTION);
    await saveRuns([run, ...runs]);
    return run;
  });
}

export async function recordSchedulerRunAttempt(
  id: string,
  input: SchedulerRunAttemptInput,
): Promise<SchedulerRunRecord | null> {
  const attempt = SchedulerRunAttemptSchema.parse(input);
  return withRunStore(async () => {
    const runs = await loadSchedulerRuns(RUN_RETENTION);
    let updated: SchedulerRunRecord | null = null;
    const next = runs.map((run) => {
      if (run.id !== id) return run;
      const attempts = run.attempts.filter((current) => current.attempt !== attempt.attempt);
      attempts.push(attempt);
      attempts.sort((a, b) => a.attempt - b.attempt);
      updated = { ...run, attempts };
      return updated;
    });

    if (!updated) return null;
    await saveRuns(next);
    return updated;
  });
}

export async function finishSchedulerRun(
  id: string,
  input: SchedulerRunFinishInput,
): Promise<SchedulerRunRecord | null> {
  return withRunStore(async () => {
    const runs = await loadSchedulerRuns(RUN_RETENTION);
    let updated: SchedulerRunRecord | null = null;
    const next = runs.map((run) => {
      if (run.id !== id) return run;
      updated = {
        ...run,
        finishedAt: input.finishedAt,
        status: input.status,
        summary: input.summary ?? null,
        error: input.error ?? null,
        itemCount: input.itemCount ?? null,
        skipReason: input.skipReason ?? run.skipReason ?? null,
      };
      return updated;
    });

    if (!updated) return null;
    await saveRuns(next);
    return updated;
  });
}

export async function listSchedulerRuns(limit = 50): Promise<SchedulerRunRecord[]> {
  return withRunStore(async () => (await loadSchedulerRuns(limit)).slice(0, clampLimit(limit)));
}

/**
 * The one definition of "a scheduled job the operator can recover". Every reader and
 * writer of the recovery list goes through this so the dashboard badge, the per-record
 * dismiss, the bulk dismiss, and the collapse in `recordMissedScheduledRun` can never
 * disagree about which records are in the list.
 */
function isRecoverableMissedRun(run: SchedulerRunRecord): boolean {
  return run.status === 'skipped' && run.trigger === 'schedule' && run.skipReason === 'missed';
}

/**
 * Record a scheduled slot that did not execute, keeping **one entry per job**.
 *
 * A job's recovery entry answers a single question — "does this job need to be run?" —
 * and that answer does not become truer for being repeated. An hourly job on a laptop
 * that suspends for a few minutes at a time can miss dozens of slots a day; without
 * collapsing, the recovery list is sized by elapsed slots rather than by jobs needing
 * attention, and `POST /api/scheduler-runs/recover` triggers one run per job anyway.
 *
 * The individual misses are not lost: `recordEventSafe` writes a `job/missed` event for
 * every one of them, which is where the full history belongs.
 *
 * The existing record's `id` is preserved on collapse so a dashboard holding it can
 * still dismiss the entry, and `startedAt` advances to the newest slot so the operator
 * reads when the job last failed to run rather than when it first did.
 */
export async function recordMissedScheduledRun(input: MissedScheduledRunInput): Promise<SchedulerRunRecord> {
  return withRunStore(async () => {
    const runs = await loadSchedulerRuns(RUN_RETENTION);
    // Records load newest-first, so the head of this list is the most recent miss.
    // Taking every match rather than the first also absorbs a backlog written before
    // collapsing existed — no migration needed, the next miss folds the old rows in.
    const [existing, ...surplus] = runs.filter((run) => isRecoverableMissedRun(run) && run.job === input.job);

    if (existing) {
      // Slots normally arrive oldest-to-newest, but the startup sweep can report a slot
      // older than one node-cron already reported. Only move the marker forward.
      const isNewerSlot = Date.parse(input.scheduledAt) > Date.parse(existing.startedAt);
      const collapsed: SchedulerRunRecord = {
        ...existing,
        label: input.label,
        modelAlias: input.modelAlias,
        startedAt: isNewerSlot ? input.scheduledAt : existing.startedAt,
        finishedAt: input.recordedAt,
        error: isNewerSlot ? input.error : existing.error,
        missedSlotCount: [existing, ...surplus]
          .reduce((total, run) => total + (run.missedSlotCount ?? 1), 1),
      };
      const absorbed = new Set(surplus.map((run) => run.id));
      await saveRuns(
        runs
          .filter((run) => !absorbed.has(run.id))
          .map((run) => (run.id === existing.id ? collapsed : run)),
      );
      return collapsed;
    }

    const run: SchedulerRunRecord = {
      id: randomUUID(),
      job: input.job,
      label: input.label,
      trigger: 'schedule',
      modelAlias: input.modelAlias,
      startedAt: input.scheduledAt,
      finishedAt: input.recordedAt,
      status: 'skipped',
      summary: null,
      error: input.error,
      itemCount: null,
      skipReason: 'missed',
      missedSlotCount: 1,
      attempts: [],
    };
    await saveRuns([run, ...runs]);
    return run;
  });
}

/**
 * Return the retained records the operator can explicitly recover. Keeping this
 * query here ensures the dashboard and recovery endpoint use the same meaning
 * of "skipped scheduled job".
 */
export async function listSkippedScheduledRuns(): Promise<SchedulerRunRecord[]> {
  return withRunStore(async () => (await loadSchedulerRuns(RUN_RETENTION)).filter(isRecoverableMissedRun));
}

/**
 * Remove one skipped scheduled run from the operator's recovery list. This only
 * dismisses historical bookkeeping; it never changes the job's schedule or state.
 */
export async function dismissSkippedSchedulerRun(id: string): Promise<SchedulerRunRecord | null> {
  return withRunStore(async () => {
    const runs = await loadSchedulerRuns(RUN_RETENTION);
    let dismissed: SchedulerRunRecord | null = null;
    const next = runs.filter((run) => {
      if (run.id !== id || !isRecoverableMissedRun(run)) {
        return true;
      }
      dismissed = run;
      return false;
    });

    if (!dismissed) return null;
    await saveRuns(next);
    return dismissed;
  });
}

/**
 * Clear every retained skipped-schedule record for jobs that have just been
 * accepted for an explicit recovery. Records for unavailable jobs stay visible
 * so the operator can decide what to do with them.
 */
export async function dismissSkippedScheduledRunsForJobs(jobNames: readonly string[]): Promise<SchedulerRunRecord[]> {
  const jobs = new Set(jobNames);
  if (jobs.size === 0) return [];
  return withRunStore(async () => {
    const runs = await loadSchedulerRuns(RUN_RETENTION);
    const dismissed: SchedulerRunRecord[] = [];
    const next = runs.filter((run) => {
      const shouldDismiss = isRecoverableMissedRun(run) && jobs.has(run.job);
      if (shouldDismiss) dismissed.push(run);
      return !shouldDismiss;
    });

    if (dismissed.length > 0) await saveRuns(next);
    return dismissed;
  });
}

export async function abandonRunningSchedulerRuns(
  input: AbandonSchedulerRunsInput,
): Promise<{ count: number; abandoned: Pick<SchedulerRunRecord, 'job' | 'label' | 'startedAt'>[] }> {
  return withRunStore(async () => {
    const runs = await loadSchedulerRuns(RUN_RETENTION);
    const abandoned: Pick<SchedulerRunRecord, 'job' | 'label' | 'startedAt'>[] = [];
    const next = runs.map((run) => {
      if (run.status !== 'running' || run.finishedAt !== null) return run;
      abandoned.push({ job: run.job, label: run.label, startedAt: run.startedAt });
      return {
        ...run,
        finishedAt: input.finishedAt,
        status: 'error' as const,
        summary: null,
        error: input.error,
        itemCount: null,
      };
    });

    if (abandoned.length > 0) await saveRuns(next);
    return { count: abandoned.length, abandoned };
  });
}

async function loadSchedulerRuns(limit: number): Promise<SchedulerRunRecord[]> {
  const stored = await loadKvJson<unknown>(SCHEDULER_RUNS_STORE_KEY);
  if (!Array.isArray(stored)) {
    return [];
  }

  return SchedulerRunRecordsSchema.parse(stored)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .slice(0, clampLimit(limit));
}

async function saveRuns(runs: SchedulerRunRecord[]): Promise<void> {
  const normalized = SchedulerRunRecordsSchema.parse(runs)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .slice(0, RUN_RETENTION);
  await saveKvJson(SCHEDULER_RUNS_STORE_KEY, normalized);
}

function clampLimit(limit: number): number {
  return Math.min(Math.max(Math.floor(limit), 1), RUN_RETENTION);
}
