/**
 * Conversational Control Panel — execute functions for each assistant tool.
 *
 * All calls go directly to internal APIs (same process, no HTTP). Imports are done
 * lazily inside each execute function to break the CJS circular-dependency cycle:
 *   registry → builtin/index → control/module → control/tools → scheduler → registry
 *
 * This mirrors the pattern used in `src/llm.ts`.
 */

/* eslint-disable @typescript-eslint/no-require-imports */

import type { SchedulerJobState } from '../../../scheduler';
import type { WorkerManifest } from '../../types';

// ---------------------------------------------------------------------------
// Lazy loader helpers — resolved at call time, not at import time
// ---------------------------------------------------------------------------

function getScheduler() {
  return require('../../../scheduler') as {
    getSchedulerSnapshot(): Promise<{ timezone: string; jobs: SchedulerJobState[] }>;
    updateSchedulerJob(name: string, patch: Record<string, unknown>): Promise<SchedulerJobState>;
    triggerJobNow(name: string, options?: { notifyOnCompletion?: boolean }): Promise<SchedulerJobState>;
  };
}

function getRegistry() {
  return require('../../registry') as {
    isJobName(value: string): boolean;
    jobLabels(): Record<string, string>;
    listWorkers(): WorkerManifest[];
  };
}

function getWorkerState() {
  return require('../../state') as {
    isWorkerEnabled(workerId: string, state: { workers: Record<string, { enabled: boolean }> }): boolean;
    loadWorkerState(): Promise<{ workers: Record<string, { enabled: boolean; builtIn: boolean; sourcePath?: string }> }>;
    setWorkerEnabled(
      workerId: string,
      enabled: boolean,
      meta: { builtIn: boolean; sourcePath?: string },
    ): Promise<{ workers: Record<string, { enabled: boolean; builtIn: boolean }> }>;
  };
}

// ---------------------------------------------------------------------------
// Job tools
// ---------------------------------------------------------------------------

export async function listJobs(): Promise<string> {
  const { getSchedulerSnapshot } = getScheduler();
  const { timezone, jobs } = await getSchedulerSnapshot();
  if (jobs.length === 0) return 'No jobs are registered.';
  const lines = jobs.map((j) => {
    const parts: string[] = [];
    parts.push(`• **${j.label}** (\`${j.name}\`)`);
    parts.push(`  enabled: ${j.enabled ? 'yes' : 'no'}`);
    parts.push(`  schedule: ${j.cron ?? 'none'}`);
    parts.push(`  running: ${j.running ? 'yes' : 'no'}`);
    if (j.lastFinishedAt) parts.push(`  last run: ${formatRelative(j.lastFinishedAt)}`);
    return parts.join('\n');
  });
  return `Jobs (timezone: ${timezone}):\n\n${lines.join('\n\n')}`;
}

export async function enableJob(input: { jobName: string }): Promise<string> {
  const { updateSchedulerJob } = getScheduler();
  const { jobLabels } = getRegistry();
  const name = resolveJobName(input.jobName);
  await updateSchedulerJob(name, { enabled: true });
  return `Job "${jobLabels()[name]}" enabled.`;
}

export async function disableJob(input: { jobName: string }): Promise<string> {
  const { updateSchedulerJob } = getScheduler();
  const { jobLabels } = getRegistry();
  const name = resolveJobName(input.jobName);
  await updateSchedulerJob(name, { enabled: false });
  return `Job "${jobLabels()[name]}" disabled.`;
}

export async function setJobSchedule(input: { jobName: string; cron: string }): Promise<string> {
  const { updateSchedulerJob } = getScheduler();
  const { jobLabels } = getRegistry();
  const name = resolveJobName(input.jobName);
  const cron = input.cron.trim();
  if (!cron) throw new Error('cron expression must not be empty.');
  await updateSchedulerJob(name, { cron, enabled: true });
  return `Job "${jobLabels()[name]}" scheduled to: ${cron}.`;
}

export async function triggerJob(input: { jobName: string }): Promise<string> {
  const { triggerJobNow } = getScheduler();
  const { jobLabels } = getRegistry();
  const name = resolveJobName(input.jobName);
  await triggerJobNow(name, { notifyOnCompletion: false });
  return `Job "${jobLabels()[name]}" triggered. Check the Jobs tab for progress.`;
}

// ---------------------------------------------------------------------------
// Worker tools
// ---------------------------------------------------------------------------

export async function listWorkerStatus(): Promise<string> {
  const { listWorkers } = getRegistry();
  const { loadWorkerState, isWorkerEnabled } = getWorkerState();
  const workers = listWorkers();
  const state = await loadWorkerState();
  if (workers.length === 0) return 'No workers are registered.';
  const lines = workers.map((w) => {
    const enabled = isWorkerEnabled(w.id, state);
    return `• **${w.displayName ?? w.name}** (\`${w.id}\`) — ${enabled ? 'enabled' : 'disabled'}`;
  });
  return `Workers:\n\n${lines.join('\n')}`;
}

export async function enableWorker(input: { workerId: string }): Promise<string> {
  const { listWorkers } = getRegistry();
  const { setWorkerEnabled } = getWorkerState();
  const id = resolveWorkerId(input.workerId);
  const worker = listWorkers().find((w) => w.id === id)!;
  await setWorkerEnabled(id, true, { builtIn: worker.builtIn ?? false });
  return `Worker "${worker.displayName ?? worker.name}" enabled. You may need to restart the server for full effect.`;
}

export async function disableWorker(input: { workerId: string }): Promise<string> {
  const { listWorkers } = getRegistry();
  const { setWorkerEnabled } = getWorkerState();
  const id = resolveWorkerId(input.workerId);
  const worker = listWorkers().find((w) => w.id === id)!;
  await setWorkerEnabled(id, false, { builtIn: worker.builtIn ?? false });
  return `Worker "${worker.displayName ?? worker.name}" disabled.`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveJobName(raw: string): string {
  const { isJobName, jobLabels } = getRegistry();
  const normalised = raw.trim().toLowerCase();
  if (isJobName(normalised)) return normalised;
  // Fuzzy: try matching the label
  const labels = jobLabels();
  const fuzzyMatch = Object.entries(labels).find(
    ([, label]) => label.toLowerCase().includes(normalised),
  );
  if (fuzzyMatch) return fuzzyMatch[0];
  throw new Error(
    `Unknown job: "${raw}". Known jobs: ${Object.keys(labels).join(', ')}.`,
  );
}

function resolveWorkerId(raw: string): string {
  const { listWorkers } = getRegistry();
  const normalised = raw.trim();
  const all = listWorkers();
  // Exact id match
  if (all.some((w) => w.id === normalised)) return normalised;
  // Case-insensitive name / displayName / id fragment match
  const nameLower = normalised.toLowerCase();
  const byName = all.find(
    (w) =>
      (w.displayName ?? w.name).toLowerCase().includes(nameLower) ||
      w.id.toLowerCase().includes(nameLower),
  );
  if (byName) return byName.id;
  throw new Error(
    `Unknown worker: "${raw}". Known workers: ${all.map((w) => w.id).join(', ')}.`,
  );
}

function formatRelative(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return iso;
  const diffMs = Date.now() - ts;
  if (diffMs < 0) return new Date(ts).toISOString();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toISOString().slice(0, 10);
}
