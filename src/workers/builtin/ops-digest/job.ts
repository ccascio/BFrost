import { z } from 'zod';
import { openWorkerKv } from '../../storage';
import { listSchedulerRuns, type SchedulerRunRecord } from '../../../scheduler-runs';
import type { WorkerJobRunResult } from '../../types';

export const OpsDigestParamsSchema = z.object({
  notifyErrors: z.boolean().default(true),
  notifySkipped: z.boolean().default(false),
});

export type OpsDigestParams = z.infer<typeof OpsDigestParamsSchema>;

export const DEFAULT_OPS_DIGEST_PARAMS: OpsDigestParams = {
  notifyErrors: true,
  notifySkipped: false,
};

const WORKER_ID = 'core.ops-digest';
const LAST_SENT_KEY = 'digest.lastSentAt';
const MAX_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

// Lazy-required to avoid registry → builtin/index → ops-digest → registry cycle.
function notify(text: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('../../registry') as typeof import('../../registry')).notifyOperatorChannels(text);
}

export async function runOpsDigest(params: OpsDigestParams): Promise<WorkerJobRunResult> {
  const kv = openWorkerKv(WORKER_ID);
  const lastSentAt = await kv.get<string>(LAST_SENT_KEY);

  const now = new Date();
  const cutoff = lastSentAt ? new Date(lastSentAt) : new Date(now.getTime() - MAX_LOOKBACK_MS);

  const allRuns = await listSchedulerRuns(200);
  // Exclude this job's own runs and still-running entries.
  const newRuns = allRuns.filter(
    (r) => r.finishedAt !== null && r.job !== 'ops-digest' && new Date(r.startedAt) > cutoff,
  );

  const message =
    newRuns.length === 0
      ? buildEmptyMessage(cutoff, now)
      : buildDigestMessage(newRuns, params, cutoff, now);

  await notify(message);
  await kv.set(LAST_SENT_KEY, now.toISOString());

  if (newRuns.length === 0) {
    return { summary: 'No job runs in period. Digest sent.', itemCount: 0 };
  }

  const problems = countProblems(newRuns, params);
  const jobCount = countDistinctJobs(newRuns);
  return {
    summary: `Digest sent: ${newRuns.length} run(s) across ${jobCount} job(s), ${problems} problem(s) flagged.`,
    itemCount: newRuns.length,
  };
}

function buildEmptyMessage(from: Date, to: Date): string {
  return `BFrost Ops Digest — ${formatRange(from, to)}\n\nNo job runs recorded in this period.`;
}

function buildDigestMessage(
  runs: SchedulerRunRecord[],
  params: OpsDigestParams,
  from: Date,
  to: Date,
): string {
  const byJob = groupByJob(runs);
  const lines: string[] = [`BFrost Ops Digest — ${formatRange(from, to)}`, ''];

  for (const jobRuns of Object.values(byJob)) {
    const label = jobRuns[0]!.label;
    const successes = jobRuns.filter((r) => r.status === 'success');
    const errors = jobRuns.filter((r) => r.status === 'error');
    const skipped = jobRuns.filter((r) => r.status === 'skipped').length;

    const flagged =
      (params.notifyErrors && errors.length > 0) || (params.notifySkipped && skipped > 0);

    const parts: string[] = [];

    if (successes.length > 0) {
      const items = successes.reduce((s, r) => s + (r.itemCount ?? 0), 0);
      parts.push(`${successes.length} ok${items > 0 ? ` (${items} items)` : ''}`);
    }

    if (skipped > 0) {
      parts.push(`${skipped} skipped`);
    }

    if (errors.length > 0) {
      if (params.notifyErrors) {
        for (const e of errors) {
          parts.push(`ERROR: ${e.error ?? 'unknown error'}`);
        }
      } else {
        parts.push(`${errors.length} error(s)`);
      }
    }

    lines.push(`${flagged ? '!' : ' '} ${label}: ${parts.join(' — ')}`);
  }

  const problems = countProblems(runs, params);
  const jobCount = Object.keys(byJob).length;
  lines.push('');
  lines.push(
    `${jobCount} job(s), ${runs.length} run(s)` +
      (problems > 0 ? `, ${problems} problem(s) flagged` : ', all clean'),
  );

  return lines.join('\n');
}

function groupByJob(runs: SchedulerRunRecord[]): Record<string, SchedulerRunRecord[]> {
  const groups: Record<string, SchedulerRunRecord[]> = {};
  for (const run of runs) {
    (groups[run.job] ??= []).push(run);
  }
  return groups;
}

function countProblems(runs: SchedulerRunRecord[], params: OpsDigestParams): number {
  let count = 0;
  if (params.notifyErrors) count += runs.filter((r) => r.status === 'error').length;
  if (params.notifySkipped) count += runs.filter((r) => r.status === 'skipped').length;
  return count;
}

function countDistinctJobs(runs: SchedulerRunRecord[]): number {
  return new Set(runs.map((r) => r.job)).size;
}

function formatRange(from: Date, to: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return from.toDateString() === to.toDateString() ? fmt(to) : `${fmt(from)} – ${fmt(to)}`;
}
