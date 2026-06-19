import type { ScheduledTask } from 'node-cron';

const DEFAULT_LOOKBACK_MS = 48 * 60 * 60 * 1000;
const DEFAULT_MAX_ITERATIONS = 3_000;

interface TimeMatcherLike {
  getNextMatch(date: Date): Date;
}

export interface PreviousCronMatchOptions {
  lookbackMs?: number;
  maxIterations?: number;
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
  return typeof getNextMatch === 'function'
    ? { getNextMatch: (date: Date) => getNextMatch.call(candidate, date) }
    : null;
}
