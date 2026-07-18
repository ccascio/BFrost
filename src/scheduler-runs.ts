import { randomUUID } from 'crypto';
import { z } from 'zod';
import { loadKvJson, saveKvJson } from './sqlite';
import type { JobName } from './job-runner';

const SCHEDULER_RUNS_STORE_KEY = 'scheduler.runs';
const RUN_RETENTION = 200;

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
  const runs = await loadSchedulerRuns(RUN_RETENTION);
  await saveRuns([run, ...runs]);
  return run;
}

export async function recordSchedulerRunAttempt(
  id: string,
  input: SchedulerRunAttemptInput,
): Promise<SchedulerRunRecord | null> {
  const runs = await loadSchedulerRuns(RUN_RETENTION);
  let updated: SchedulerRunRecord | null = null;
  const attempt = SchedulerRunAttemptSchema.parse(input);
  const next = runs.map((run) => {
    if (run.id !== id) return run;
    const attempts = run.attempts.filter((current) => current.attempt !== attempt.attempt);
    attempts.push(attempt);
    attempts.sort((a, b) => a.attempt - b.attempt);
    updated = { ...run, attempts };
    return updated;
  });

  if (!updated) {
    return null;
  }

  await saveRuns(next);
  return updated;
}

export async function finishSchedulerRun(
  id: string,
  input: SchedulerRunFinishInput,
): Promise<SchedulerRunRecord | null> {
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

  if (!updated) {
    return null;
  }

  await saveRuns(next);
  return updated;
}

export async function listSchedulerRuns(limit = 50): Promise<SchedulerRunRecord[]> {
  return (await loadSchedulerRuns(limit)).slice(0, clampLimit(limit));
}

export async function listSkippedScheduledRuns(): Promise<SchedulerRunRecord[]> {
  return (await loadSchedulerRuns(RUN_RETENTION))
    .filter((run) => run.status === 'skipped' && run.trigger === 'schedule' && run.skipReason === 'missed');
}

export async function dismissSkippedSchedulerRun(id: string): Promise<SchedulerRunRecord | null> {
  const runs = await loadSchedulerRuns(RUN_RETENTION);
  let dismissed: SchedulerRunRecord | null = null;
  const next = runs.filter((run) => {
    if (run.id !== id || run.status !== 'skipped' || run.trigger !== 'schedule' || run.skipReason !== 'missed') return true;
    dismissed = run;
    return false;
  });
  if (!dismissed) return null;
  await saveRuns(next);
  return dismissed;
}

export async function dismissSkippedScheduledRunsForJobs(jobNames: readonly string[]): Promise<SchedulerRunRecord[]> {
  const jobs = new Set(jobNames);
  if (jobs.size === 0) return [];
  const runs = await loadSchedulerRuns(RUN_RETENTION);
  const dismissed: SchedulerRunRecord[] = [];
  const next = runs.filter((run) => {
    const shouldDismiss = run.status === 'skipped' && run.trigger === 'schedule'
      && run.skipReason === 'missed' && jobs.has(run.job);
    if (shouldDismiss) dismissed.push(run);
    return !shouldDismiss;
  });
  if (dismissed.length > 0) await saveRuns(next);
  return dismissed;
}

export async function abandonRunningSchedulerRuns(
  input: AbandonSchedulerRunsInput,
): Promise<{ count: number; abandoned: Pick<SchedulerRunRecord, 'job' | 'label' | 'startedAt'>[] }> {
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

  if (abandoned.length > 0) {
    await saveRuns(next);
  }

  return { count: abandoned.length, abandoned };
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
