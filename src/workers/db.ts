/**
 * Per-worker namespaced SQLite tables.
 *
 * Every worker gets its own table namespace inside the shared `APP_DB_PATH`: tables are
 * created as `worker_<safeWorkerId>_<localName>` and indexes as
 * `idx_worker_<safeWorkerId>_<localName>_<indexName>`. Two workers cannot collide on a
 * table name, and the dashboard backup carries every worker's schema + data along with
 * the rest of the app database.
 *
 * Why a structured API instead of raw SQL: workers never write the prefixed name
 * themselves. They name a *local* table, get back a handle, and call typed CRUD
 * helpers. The `raw()` escape hatch substitutes `${table}` with the prefixed name so a
 * worker can write SELECTs/aggregates against its own tables — but cannot reference
 * another worker's tables, because it never sees those handles.
 *
 * Migrations: defining a table that already exists is a no-op for matching columns and
 * `ALTER TABLE ADD COLUMN` for new columns. Renames and drops are intentionally not
 * supported here — those are destructive and belong in an explicit migration hook on
 * the worker lifecycle.
 *
 * Trust boundary: this API trusts the *worker author*, not the *worker user*. A local
 * worker can already run Node code on the host; the prefix is for cross-worker
 * hygiene and backup ergonomics, not for sandboxing — sandboxing comes in
 * Workstream 5.
 */
import type Database from 'better-sqlite3';
import { getAppDb } from '../sqlite';

const IDENT_RE = /^[a-z][a-z0-9_]*$/;
const WORKER_ID_RE = /^[a-z0-9][a-z0-9._-]*$/;

export type WorkerColumnType = 'TEXT' | 'INTEGER' | 'REAL' | 'BLOB';

export interface WorkerColumnDef {
  name: string;
  type: WorkerColumnType;
  notNull?: boolean;
  primaryKey?: boolean;
  unique?: boolean;
  /**
   * Literal default value baked into the column definition. Strings are quoted; numbers
   * and null pass through. Workers that need computed defaults should set them in
   * application code at insert time.
   */
  default?: string | number | null;
}

export interface WorkerIndexDef {
  /** Local index name; will be prefixed alongside the table. */
  name: string;
  columns: string[];
  unique?: boolean;
}

export interface WorkerTableSchema {
  columns: WorkerColumnDef[];
  indexes?: WorkerIndexDef[];
}

export interface WorkerTableFindOptions<TRow> {
  where?: Partial<TRow>;
  orderBy?: string;
  limit?: number;
  offset?: number;
}

export interface WorkerTableHandle<TRow extends Record<string, unknown>> {
  workerId: string;
  /** Fully-qualified physical table name (`worker_<safeWorkerId>_<localName>`). */
  fullName: string;
  insert(row: TRow): void;
  upsert(row: TRow, conflictKeys: Array<keyof TRow & string>): void;
  update(where: Partial<TRow>, patch: Partial<TRow>): number;
  delete(where: Partial<TRow>): number;
  findOne(where: Partial<TRow>): TRow | undefined;
  findAll(opts?: WorkerTableFindOptions<TRow>): TRow[];
  count(where?: Partial<TRow>): number;
  /**
   * Raw SQL for queries that span a worker's own tables (aggregates, joins between
   * tables this worker defined). `${table}` is substituted with this handle's physical
   * table name. Other identifiers must be quoted by the worker author.
   */
  raw<R = unknown>(sql: string, params?: unknown[]): R[];
}

export interface WorkerDb {
  workerId: string;
  defineTable<TRow extends Record<string, unknown>>(
    localName: string,
    schema: WorkerTableSchema,
  ): Promise<WorkerTableHandle<TRow>>;
  /** List physical table names owned by this worker. */
  listTables(): Promise<string[]>;
}

function validateWorkerId(workerId: string): void {
  if (!WORKER_ID_RE.test(workerId)) {
    throw new Error(`Invalid worker id for table namespace: ${workerId}`);
  }
}

function validateIdent(value: string, kind: 'table' | 'column' | 'index'): void {
  if (!IDENT_RE.test(value)) {
    throw new Error(`Invalid ${kind} name "${value}": must match ${IDENT_RE.source}`);
  }
}

/**
 * Convert a worker id (lowercase letters, digits, dots, dashes) into a SQLite-safe
 * identifier suffix. Dots and dashes both map to underscores, which means
 * `core.news` and `core-news` would collide — defineTable() detects that and throws.
 */
function safeNamespace(workerId: string): string {
  return workerId.replace(/[.\-]/g, '_');
}

function quoteDefault(value: WorkerColumnDef['default']): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildCreateTableSql(fullName: string, schema: WorkerTableSchema): string {
  const columnDefs = schema.columns.map((col) => {
    validateIdent(col.name, 'column');
    const parts = [col.name, col.type];
    if (col.primaryKey) parts.push('PRIMARY KEY');
    if (col.notNull) parts.push('NOT NULL');
    if (col.unique) parts.push('UNIQUE');
    if (col.default !== undefined) parts.push(`DEFAULT ${quoteDefault(col.default)}`);
    return parts.join(' ');
  });
  return `CREATE TABLE IF NOT EXISTS ${fullName} (${columnDefs.join(', ')})`;
}

function buildColumnAddSql(fullName: string, col: WorkerColumnDef): string {
  validateIdent(col.name, 'column');
  // SQLite ALTER TABLE ADD COLUMN doesn't accept PRIMARY KEY or UNIQUE — those would
  // require rewriting the table. We surface that clearly instead of silently dropping
  // the constraint.
  if (col.primaryKey || col.unique) {
    throw new Error(
      `Cannot add PRIMARY KEY or UNIQUE column "${col.name}" via migration; recreate the table explicitly.`,
    );
  }
  const parts: string[] = [col.type];
  if (col.notNull) {
    if (col.default === undefined) {
      throw new Error(`Adding NOT NULL column "${col.name}" requires a default value.`);
    }
    parts.push('NOT NULL');
  }
  if (col.default !== undefined) parts.push(`DEFAULT ${quoteDefault(col.default)}`);
  return `ALTER TABLE ${fullName} ADD COLUMN ${col.name} ${parts.join(' ')}`;
}

interface ExistingColumn {
  name: string;
}

function listExistingColumns(db: Database.Database, fullName: string): ExistingColumn[] {
  return db.prepare(`PRAGMA table_info(${fullName})`).all() as ExistingColumn[];
}

function applyIndexes(db: Database.Database, fullName: string, prefix: string, indexes: WorkerIndexDef[] | undefined): void {
  if (!indexes) return;
  for (const index of indexes) {
    validateIdent(index.name, 'index');
    for (const col of index.columns) validateIdent(col, 'column');
    const indexName = `idx_${prefix}_${index.name}`;
    const sql = `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${indexName} ON ${fullName} (${index.columns.join(', ')})`;
    db.exec(sql);
  }
}

function buildWhereClause(where: Record<string, unknown> | undefined): { sql: string; params: unknown[] } {
  if (!where || Object.keys(where).length === 0) return { sql: '', params: [] };
  const keys = Object.keys(where);
  for (const key of keys) validateIdent(key, 'column');
  const fragments = keys.map((key) => (where[key] === null ? `${key} IS NULL` : `${key} = ?`));
  const params = keys.filter((key) => where[key] !== null).map((key) => where[key]);
  return { sql: ` WHERE ${fragments.join(' AND ')}`, params };
}

function makeTableHandle<TRow extends Record<string, unknown>>(
  db: Database.Database,
  workerId: string,
  fullName: string,
): WorkerTableHandle<TRow> {
  return {
    workerId,
    fullName,
    insert(row) {
      const keys = Object.keys(row);
      for (const key of keys) validateIdent(key, 'column');
      const placeholders = keys.map(() => '?').join(', ');
      db.prepare(`INSERT INTO ${fullName} (${keys.join(', ')}) VALUES (${placeholders})`)
        .run(...keys.map((key) => (row as any)[key]));
    },
    upsert(row, conflictKeys) {
      const keys = Object.keys(row);
      for (const key of keys) validateIdent(key, 'column');
      for (const key of conflictKeys) validateIdent(key, 'column');
      const placeholders = keys.map(() => '?').join(', ');
      const setFragments = keys
        .filter((key) => !conflictKeys.includes(key))
        .map((key) => `${key} = excluded.${key}`);
      const conflictClause = setFragments.length === 0
        ? `ON CONFLICT(${conflictKeys.join(', ')}) DO NOTHING`
        : `ON CONFLICT(${conflictKeys.join(', ')}) DO UPDATE SET ${setFragments.join(', ')}`;
      db.prepare(`INSERT INTO ${fullName} (${keys.join(', ')}) VALUES (${placeholders}) ${conflictClause}`)
        .run(...keys.map((key) => (row as any)[key]));
    },
    update(where, patch) {
      const patchKeys = Object.keys(patch);
      if (patchKeys.length === 0) return 0;
      for (const key of patchKeys) validateIdent(key, 'column');
      const setClause = patchKeys.map((key) => `${key} = ?`).join(', ');
      const whereClause = buildWhereClause(where as Record<string, unknown>);
      const stmt = db.prepare(`UPDATE ${fullName} SET ${setClause}${whereClause.sql}`);
      const result = stmt.run(...patchKeys.map((key) => (patch as any)[key]), ...whereClause.params);
      return result.changes;
    },
    delete(where) {
      const whereClause = buildWhereClause(where as Record<string, unknown>);
      const stmt = db.prepare(`DELETE FROM ${fullName}${whereClause.sql}`);
      const result = stmt.run(...whereClause.params);
      return result.changes;
    },
    findOne(where) {
      const whereClause = buildWhereClause(where as Record<string, unknown>);
      const stmt = db.prepare(`SELECT * FROM ${fullName}${whereClause.sql} LIMIT 1`);
      return stmt.get(...whereClause.params) as TRow | undefined;
    },
    findAll(opts) {
      const whereClause = buildWhereClause(opts?.where as Record<string, unknown> | undefined);
      let sql = `SELECT * FROM ${fullName}${whereClause.sql}`;
      if (opts?.orderBy) {
        // Workers are trusted to write a valid ORDER BY clause referring to columns
        // they defined. We don't parse it — but we forbid semicolons to block trivial
        // chained statements.
        if (opts.orderBy.includes(';')) throw new Error('orderBy must not contain semicolons.');
        sql += ` ORDER BY ${opts.orderBy}`;
      }
      if (typeof opts?.limit === 'number') sql += ` LIMIT ${Math.floor(opts.limit)}`;
      if (typeof opts?.offset === 'number') sql += ` OFFSET ${Math.floor(opts.offset)}`;
      return db.prepare(sql).all(...whereClause.params) as TRow[];
    },
    count(where) {
      const whereClause = buildWhereClause(where as Record<string, unknown> | undefined);
      const row = db.prepare(`SELECT COUNT(*) AS count FROM ${fullName}${whereClause.sql}`)
        .get(...whereClause.params) as { count: number };
      return row.count;
    },
    raw<R = unknown>(sql: string, params: unknown[] = []) {
      const substituted = sql.replace(/\$\{table\}/g, fullName);
      return db.prepare(substituted).all(...params) as R[];
    },
  };
}

export async function openWorkerDb(workerId: string): Promise<WorkerDb> {
  validateWorkerId(workerId);
  const prefix = `worker_${safeNamespace(workerId)}`;
  const db = await getAppDb();

  return {
    workerId,
    async defineTable<TRow extends Record<string, unknown>>(localName: string, schema: WorkerTableSchema) {
      validateIdent(localName, 'table');
      if (!schema.columns || schema.columns.length === 0) {
        throw new Error('defineTable requires at least one column.');
      }
      const fullName = `${prefix}_${localName}`;

      const existing = listExistingColumns(db, fullName);
      if (existing.length === 0) {
        db.exec(buildCreateTableSql(fullName, schema));
      } else {
        const existingNames = new Set(existing.map((col) => col.name));
        for (const col of schema.columns) {
          if (!existingNames.has(col.name)) {
            db.exec(buildColumnAddSql(fullName, col));
          }
        }
      }
      applyIndexes(db, fullName, `${prefix}_${localName}`, schema.indexes);
      return makeTableHandle<TRow>(db, workerId, fullName);
    },
    async listTables() {
      const rows = db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE ? ORDER BY name`)
        .all(`${prefix}_%`) as Array<{ name: string }>;
      return rows.map((row) => row.name);
    },
  };
}
