import type { EventLogRecord, QueueItem, SchedulerRunRecord } from '../app-types';
import { formatDuration } from './display';

export function eventSeverityTone(severity: EventLogRecord['severity']): 'good' | 'warning' | 'info' | 'muted' {
  if (severity === 'error') return 'warning';
  if (severity === 'warning') return 'info';
  return 'muted';
}

export function runDuration(run: SchedulerRunRecord | undefined): string | null {
  if (!run?.finishedAt) return null;

  const startedMs = Date.parse(run.startedAt);
  const finishedMs = Date.parse(run.finishedAt);
  if (Number.isNaN(startedMs) || Number.isNaN(finishedMs) || finishedMs < startedMs) {
    return null;
  }

  return formatDuration(finishedMs - startedMs);
}

export function runSeverity(run: SchedulerRunRecord): EventLogRecord['severity'] {
  if (run.status === 'error') return 'error';
  if (run.status === 'skipped') return 'warning';
  return 'info';
}

export function runStatusTone(status: SchedulerRunRecord['status']): 'good' | 'warning' | 'info' | 'muted' {
  if (status === 'success') return 'good';
  if (status === 'error') return 'warning';
  if (status === 'skipped' || status === 'running') return 'info';
  return 'muted';
}

export function runStatusSummary(run: SchedulerRunRecord): string {
  if (run.status === 'running') return `${run.label} is running.`;
  if (run.status === 'skipped') return `${run.label} was skipped.`;
  if (run.status === 'error') return `${run.label} failed.`;
  return `${run.label} completed successfully.`;
}

export function queueItemTone(
  state: QueueItem['state'],
): 'good' | 'warning' | 'info' | 'muted' {
  if (state === 'posted') return 'good';
  if (state === 'failed' || state === 'rejected') return 'warning';
  if (state === 'queued' || state === 'approved') return 'info';
  return 'muted';
}

export function queueItemReason(item: QueueItem): string | null {
  return item.stateReason ?? item.selectionReason ?? item.rejectionReason ?? item.lastError ?? null;
}

export function hostsToDraft(values: string[]): string {
  return values.join('\n');
}

export function draftToHosts(value: string): string[] {
  return value
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function safeHost(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}
