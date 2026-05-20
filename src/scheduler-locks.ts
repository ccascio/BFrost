import { getAppDb } from './sqlite';

const LOCK_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

export interface SchedulerExecutionLockInput {
  commandKey: string;
  scheduledAt: string;
}

export async function acquireSchedulerExecutionLock(input: SchedulerExecutionLockInput): Promise<boolean> {
  const db = await getAppDb();
  ensureSchedulerExecutionLocksTable(db);

  const nowIso = new Date().toISOString();
  pruneSchedulerExecutionLocks(db, nowIso);

  const lockKey = schedulerExecutionLockKey(input.commandKey, input.scheduledAt);
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO scheduler_execution_locks
       (lock_key, command_key, scheduled_at, acquired_at, owner_pid)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(lockKey, input.commandKey, input.scheduledAt, nowIso, process.pid);

  return result.changes === 1;
}

export function schedulerExecutionLockKey(commandKey: string, scheduledAt: string): string {
  return `${commandKey}@${scheduledAt}`;
}

function ensureSchedulerExecutionLocksTable(db: Awaited<ReturnType<typeof getAppDb>>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduler_execution_locks (
      lock_key TEXT PRIMARY KEY,
      command_key TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      owner_pid INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_scheduler_execution_locks_command
      ON scheduler_execution_locks(command_key, scheduled_at);
  `);
}

function pruneSchedulerExecutionLocks(db: Awaited<ReturnType<typeof getAppDb>>, nowIso: string): void {
  const cutoff = new Date(Date.parse(nowIso) - LOCK_RETENTION_MS).toISOString();
  db.prepare('DELETE FROM scheduler_execution_locks WHERE scheduled_at < ?').run(cutoff);
}
