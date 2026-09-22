import Database from 'better-sqlite3';
import { promises as fs } from 'fs';
import path from 'path';
import { config } from './config';
import { withDebugTiming, withDebugTimingAsync } from './debug';

let db: Database.Database | null = null;
let dbPath: string | null = null;

function hasLiveDb(targetPath = config.appDbPath): boolean {
  return Boolean(db && dbPath === targetPath && db.open);
}

function getDb(): Database.Database {
  if (hasLiveDb()) return db!;
  return withDebugTiming('sqlite.open', () => {
    if (db?.open) db.close();
    const opened = new Database(config.appDbPath);
    db = opened;
    dbPath = config.appDbPath;
    opened.pragma('journal_mode = WAL');
    opened.exec(`
      CREATE TABLE IF NOT EXISTS app_kv (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS event_log (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        category TEXT NOT NULL,
        action TEXT NOT NULL,
        severity TEXT NOT NULL,
        summary TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_event_log_created_at ON event_log(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_event_log_category_action ON event_log(category, action);
      /* 01.1 — one row per completed model call, attributed to the run that made it.
         cost_usd is nullable on purpose: a model absent from the price table is unpriced,
         which is a different fact from free, and price_table_version is what makes a stored
         cost recomputable after prices move. */
      CREATE TABLE IF NOT EXISTS run_costs (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        job_name TEXT,
        run_id TEXT,
        worker_id TEXT,
        subject TEXT,
        provider TEXT NOT NULL,
        model_id TEXT NOT NULL,
        input_tokens INTEGER,
        output_tokens INTEGER,
        cached_input_tokens INTEGER,
        reasoning_tokens INTEGER,
        wall_ms INTEGER NOT NULL,
        outcome TEXT NOT NULL,
        cost_usd REAL,
        price_table_version TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_run_costs_created_at ON run_costs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_run_costs_job ON run_costs(job_name, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_run_costs_subject ON run_costs(subject, created_at DESC);
      /* Reads counted per surface so public, subscriber and API reads stay distinguishable
         without adding a per-surface counter to the artifact itself. */
      CREATE TABLE IF NOT EXISTS artifact_reads (
        artifact_id TEXT NOT NULL,
        surface TEXT NOT NULL,
        freshness TEXT NOT NULL,
        day TEXT NOT NULL,
        reads INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (artifact_id, surface, freshness, day)
      );
      CREATE INDEX IF NOT EXISTS idx_artifact_reads_day ON artifact_reads(day DESC);
    `);
    return opened;
  });
}

export async function ensureAppDb(): Promise<void> {
  // Every KV/query helper calls this boundary. Once the current connection is live, avoid
  // scheduling another fs.mkdir operation (and another pair of debug records) per statement.
  // Path swaps and close/reopen flows still take the slow path because hasLiveDb checks both.
  if (hasLiveDb()) return;
  await withDebugTimingAsync('sqlite.ensure', async () => {
    if (hasLiveDb()) return;
    await fs.mkdir(path.dirname(config.appDbPath), { recursive: true });
    getDb();
  });
}

/** Internal handle for modules that need direct better-sqlite3 access (e.g. worker tables). */
export async function getAppDb(): Promise<Database.Database> {
  await ensureAppDb();
  return getDb();
}

/**
 * Synchronous counterpart for worker table CRUD methods. The database driver is synchronous,
 * and a cached worker table handle may outlive a restore or test database path swap. Resolving
 * the current handle here prevents a closed native connection from being reused.
 */
export function getAppDbSync(): Database.Database {
  return getDb();
}

export async function loadKvJson<T>(key: string): Promise<T | null> {
  return withDebugTimingAsync('sqlite.kv.get', async () => {
    await ensureAppDb();
    const row = getDb().prepare('SELECT value_json AS valueJson FROM app_kv WHERE key = ? LIMIT 1').get(key) as { valueJson: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.valueJson) as T;
  });
}

export async function listKvJsonBySuffix<T>(suffix: string): Promise<Array<{ key: string; value: T }>> {
  return withDebugTimingAsync('sqlite.kv.list-by-suffix', async () => {
    await ensureAppDb();
    const rows = getDb()
      .prepare('SELECT key, value_json AS valueJson FROM app_kv WHERE key LIKE ? ORDER BY updated_at DESC')
      .all(`%${suffix}`) as Array<{ key: string; valueJson: string }>;
    return rows.map((row) => ({ key: row.key, value: JSON.parse(row.valueJson) as T }));
  });
}

export async function saveKvJson(key: string, value: unknown): Promise<void> {
  await withDebugTimingAsync('sqlite.kv.set', async () => {
    await ensureAppDb();
    saveKvJsonSync(key, value);
  });
}

/**
 * Synchronous write — use instead of `saveKvJson` from any code that runs
 * after startup hydration. Skips the async `ensureAppDb` call; `getDb()`
 * opens the database synchronously if it isn't already open.
 */
export function saveKvJsonSync(key: string, value: unknown): void {
  withDebugTiming('sqlite.kv.set.sync', () => {
    getDb()
      .prepare(
        `INSERT INTO app_kv (key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(value), new Date().toISOString());
  });
}

export async function runSql(sql: string): Promise<string> {
  return withDebugTimingAsync('sqlite.exec', async () => {
    await ensureAppDb();
    getDb().exec(sql);
    return '';
  });
}

export async function runSqlJson(sql: string): Promise<Array<Record<string, unknown>>> {
  return withDebugTimingAsync('sqlite.query', async () => {
    await ensureAppDb();
    return getDb().prepare(sql).all() as Array<Record<string, unknown>>;
  });
}

export function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export async function createBackup(destPath: string): Promise<void> {
  await withDebugTimingAsync('sqlite.backup', async () => {
    await ensureAppDb();
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await getDb().backup(destPath);
  });
}

/** Close and release the current database handle. */
export function closeDb(): void {
  withDebugTiming('sqlite.close', () => {
    if (db) {
      db.close();
      db = null;
      dbPath = null;
    }
  });
}
