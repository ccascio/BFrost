import Database from 'better-sqlite3';
import { promises as fs } from 'fs';
import path from 'path';
import { config } from './config';

let db: Database.Database | null = null;
let dbPath: string | null = null;

function getDb(): Database.Database {
  if (db && dbPath === config.appDbPath) return db;
  db?.close();
  db = new Database(config.appDbPath);
  dbPath = config.appDbPath;
  db.pragma('journal_mode = WAL');
  db.exec(`
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
  `);
  return db;
}

export async function ensureAppDb(): Promise<void> {
  await fs.mkdir(path.dirname(config.appDbPath), { recursive: true });
  getDb();
}

/** Internal handle for modules that need direct better-sqlite3 access (e.g. worker tables). */
export async function getAppDb(): Promise<Database.Database> {
  await ensureAppDb();
  return getDb();
}

export async function loadKvJson<T>(key: string): Promise<T | null> {
  await ensureAppDb();
  const row = getDb().prepare('SELECT value_json AS valueJson FROM app_kv WHERE key = ? LIMIT 1').get(key) as { valueJson: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.valueJson) as T;
}

export async function listKvJsonBySuffix<T>(suffix: string): Promise<Array<{ key: string; value: T }>> {
  await ensureAppDb();
  const rows = getDb()
    .prepare('SELECT key, value_json AS valueJson FROM app_kv WHERE key LIKE ? ORDER BY updated_at DESC')
    .all(`%${suffix}`) as Array<{ key: string; valueJson: string }>;
  return rows.map((row) => ({ key: row.key, value: JSON.parse(row.valueJson) as T }));
}

export async function saveKvJson(key: string, value: unknown): Promise<void> {
  await ensureAppDb();
  saveKvJsonSync(key, value);
}

/**
 * Synchronous write — use instead of `saveKvJson` from any code that runs
 * after startup hydration. Skips the async `ensureAppDb` call; `getDb()`
 * opens the database synchronously if it isn't already open.
 */
export function saveKvJsonSync(key: string, value: unknown): void {
  getDb()
    .prepare(
      `INSERT INTO app_kv (key, value_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    )
    .run(key, JSON.stringify(value), new Date().toISOString());
}

export async function runSql(sql: string): Promise<string> {
  await ensureAppDb();
  getDb().exec(sql);
  return '';
}

export async function runSqlJson(sql: string): Promise<Array<Record<string, unknown>>> {
  await ensureAppDb();
  return getDb().prepare(sql).all() as Array<Record<string, unknown>>;
}

export function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export async function createBackup(destPath: string): Promise<void> {
  await ensureAppDb();
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  await getDb().backup(destPath);
}

/** Close and release the current database handle. */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
    dbPath = null;
  }
}
