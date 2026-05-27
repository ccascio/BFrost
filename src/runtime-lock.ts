import os from 'os';
import { getAppDb } from './sqlite';

const RUNTIME_LOCK_KEY = 'bfrost-runtime';
const HEARTBEAT_INTERVAL_MS = 30_000;

let ownsRuntimeLock = false;
let heartbeatTimer: NodeJS.Timeout | null = null;

interface RuntimeLockRow {
  lock_key: string;
  owner_pid: number;
  acquired_at: string;
  heartbeat_at: string;
  host: string;
  cwd: string;
  command: string;
}

export async function acquireRuntimeLock(): Promise<void> {
  const db = await getAppDb();
  ensureRuntimeLocksTable(db);

  if (tryInsertRuntimeLock(db)) {
    ownsRuntimeLock = true;
    startRuntimeHeartbeat();
    return;
  }

  const existing = db
    .prepare('SELECT * FROM app_runtime_locks WHERE lock_key = ? LIMIT 1')
    .get(RUNTIME_LOCK_KEY) as RuntimeLockRow | undefined;

  if (existing?.owner_pid === process.pid) {
    ownsRuntimeLock = true;
    await updateRuntimeHeartbeat();
    startRuntimeHeartbeat();
    return;
  }

  if (existing && processExists(existing.owner_pid)) {
    throw new Error(
      `Another BFrost backend is already running (PID ${existing.owner_pid}, started ${existing.acquired_at}). ` +
        'Stop that process before starting a second scheduler.',
    );
  }

  if (existing) {
    db.prepare('DELETE FROM app_runtime_locks WHERE lock_key = ? AND owner_pid = ?')
      .run(RUNTIME_LOCK_KEY, existing.owner_pid);
  }

  if (!tryInsertRuntimeLock(db)) {
    throw new Error('Could not acquire BFrost runtime lock; another backend started first.');
  }

  ownsRuntimeLock = true;
  startRuntimeHeartbeat();
}

function tryInsertRuntimeLock(db: Awaited<ReturnType<typeof getAppDb>>): boolean {
  const nowIso = new Date().toISOString();
  const result = db.prepare(
    `INSERT OR IGNORE INTO app_runtime_locks
       (lock_key, owner_pid, acquired_at, heartbeat_at, host, cwd, command)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    RUNTIME_LOCK_KEY,
    process.pid,
    nowIso,
    nowIso,
    os.hostname(),
    process.cwd(),
    process.argv.join(' '),
  );
  return result.changes === 1;
}

export async function releaseRuntimeLock(): Promise<void> {
  stopRuntimeHeartbeat();
  if (!ownsRuntimeLock) return;

  try {
    const db = await getAppDb();
    ensureRuntimeLocksTable(db);
    db.prepare('DELETE FROM app_runtime_locks WHERE lock_key = ? AND owner_pid = ?')
      .run(RUNTIME_LOCK_KEY, process.pid);
  } finally {
    ownsRuntimeLock = false;
  }
}

function startRuntimeHeartbeat(): void {
  stopRuntimeHeartbeat();
  heartbeatTimer = setInterval(() => {
    void updateRuntimeHeartbeat().catch((err) => {
      console.warn('[RuntimeLock] Failed to update heartbeat:', err);
    });
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref();
}

function stopRuntimeHeartbeat(): void {
  if (!heartbeatTimer) return;
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

async function updateRuntimeHeartbeat(): Promise<void> {
  if (!ownsRuntimeLock) return;
  const db = await getAppDb();
  ensureRuntimeLocksTable(db);
  db.prepare(
    `UPDATE app_runtime_locks
     SET heartbeat_at = ?
     WHERE lock_key = ? AND owner_pid = ?`,
  ).run(new Date().toISOString(), RUNTIME_LOCK_KEY, process.pid);
}

function ensureRuntimeLocksTable(db: Awaited<ReturnType<typeof getAppDb>>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_runtime_locks (
      lock_key TEXT PRIMARY KEY,
      owner_pid INTEGER NOT NULL,
      acquired_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL,
      host TEXT NOT NULL,
      cwd TEXT NOT NULL,
      command TEXT NOT NULL
    );
  `);
}

function processExists(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}
