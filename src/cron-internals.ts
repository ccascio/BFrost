import type { ScheduledTask } from 'node-cron';
import { CronExpressionParser } from 'cron-parser';

const DEFAULT_LOOKBACK_MS = 48 * 60 * 60 * 1000;
const DEFAULT_MAX_ITERATIONS = 3_000;

interface TimeMatcherLike {
  getNextMatch(date: Date): Date;
  match(date: Date): boolean;
}

export interface PreviousCronMatchOptions {
  lookbackMs?: number;
  maxIterations?: number;
}

/** Return the next concrete cron slot using a timezone-aware parser. */
export function getNextCronMatch(expression: string, timezone: string, after: Date): Date {
  return CronExpressionParser.parse(expression, {
    currentDate: after,
    tz: timezone,
  }).next().toDate();
}

/**
 * Replace node-cron's faulty constrained-weekday matcher before the task starts.
 * node-cron 4.2.1 can advance the year instead of the day for weekly schedules.
 */
export function installReliableCronMatcher(
  task: ScheduledTask,
  expression: string,
  timezone: string,
): void {
  const candidate = Reflect.get(task, 'timeMatcher');
  if (!candidate || typeof candidate !== 'object') {
    throw new Error('Scheduled task does not expose a compatible time matcher.');
  }

  Reflect.set(candidate, 'getNextMatch', (date: Date) => getNextCronMatch(expression, timezone, date));
  Reflect.set(candidate, 'match', (date: Date) => {
    const normalized = new Date(Math.floor(date.getTime() / 1000) * 1000);
    const previousSecond = new Date(normalized.getTime() - 1000);
    return getNextCronMatch(expression, timezone, previousSecond).getTime() === normalized.getTime();
  });
}

/**
 * Adapter around node-cron's InlineScheduledTask.timeMatcher internal. The public
 * ScheduledTask interface does not expose it, but BFrost needs it to recover the
 * concrete slot that was missed when node-cron reports only the next context date.
 */
export function getPreviousCronMatch(
  task: ScheduledTask | undefined,
  before: Date,
  options: PreviousCronMatchOptions = {},
): Date | null {
  try {
    if (!task) return null;
    const timeMatcher = readTimeMatcher(task);
    if (!timeMatcher) return null;

    const beforeMs = before.getTime();
    if (!Number.isFinite(beforeMs)) return null;

    let cursor = new Date(beforeMs - (options.lookbackMs ?? DEFAULT_LOOKBACK_MS));
    let lastMatchBefore: Date | null = null;
    const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;

    for (let i = 0; i < maxIterations; i++) {
      const next = timeMatcher.getNextMatch(cursor);
      const nextMs = next.getTime();
      if (!Number.isFinite(nextMs) || nextMs <= cursor.getTime()) return null;
      if (nextMs >= beforeMs) break;
      lastMatchBefore = next;
      cursor = next;
    }

    return lastMatchBefore;
  } catch {
    return null;
  }
}

function readTimeMatcher(task: ScheduledTask): TimeMatcherLike | null {
  const candidate = Reflect.get(task, 'timeMatcher');
  if (!candidate || typeof candidate !== 'object') {
    return null;
  }
  const getNextMatch = Reflect.get(candidate, 'getNextMatch');
  const match = Reflect.get(candidate, 'match');
  return typeof getNextMatch === 'function' && typeof match === 'function'
    ? {
        getNextMatch: (date: Date) => getNextMatch.call(candidate, date),
        match: (date: Date) => match.call(candidate, date),
      }
    : null;
}
