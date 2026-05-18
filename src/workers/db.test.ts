import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { config } from '../config';
import { getAppDb } from '../sqlite';
import { openWorkerDb } from './db';

async function withTempDb<T>(fn: () => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-workerdb-'));
  const previousDbPath = config.appDbPath;
  config.appDbPath = path.join(dir, 'app.sqlite');
  try {
    return await fn();
  } finally {
    config.appDbPath = previousDbPath;
    await rm(dir, { recursive: true, force: true });
  }
}

interface MemoRow extends Record<string, unknown> {
  id: string;
  content: string;
  created_at: string;
  pinned?: number;
}

test('defineTable creates a prefixed table with the requested columns', async () => {
  await withTempDb(async () => {
    const worker = await openWorkerDb('core.example');
    const memos = await worker.defineTable<MemoRow>('memos', {
      columns: [
        { name: 'id', type: 'TEXT', primaryKey: true },
        { name: 'content', type: 'TEXT', notNull: true },
        { name: 'created_at', type: 'TEXT', notNull: true },
      ],
    });
    assert.equal(memos.fullName, 'worker_core_example_memos');
    const tables = await worker.listTables();
    assert.deepEqual(tables, ['worker_core_example_memos']);
  });
});

test('CRUD roundtrip writes and reads rows via prepared statements', async () => {
  await withTempDb(async () => {
    const worker = await openWorkerDb('core.example');
    const memos = await worker.defineTable<MemoRow>('memos', {
      columns: [
        { name: 'id', type: 'TEXT', primaryKey: true },
        { name: 'content', type: 'TEXT', notNull: true },
        { name: 'created_at', type: 'TEXT', notNull: true },
      ],
    });
    memos.insert({ id: 'a', content: 'hello', created_at: '2026-05-14T00:00:00.000Z' });
    memos.insert({ id: 'b', content: 'world', created_at: '2026-05-14T00:00:01.000Z' });

    const one = memos.findOne({ id: 'a' });
    assert.equal(one?.content, 'hello');

    const all = memos.findAll({ orderBy: 'created_at ASC' });
    assert.equal(all.length, 2);
    assert.deepEqual(all.map((row) => row.id), ['a', 'b']);

    const changed = memos.update({ id: 'a' }, { content: 'updated' });
    assert.equal(changed, 1);
    assert.equal(memos.findOne({ id: 'a' })?.content, 'updated');

    const removed = memos.delete({ id: 'b' });
    assert.equal(removed, 1);
    assert.equal(memos.count(), 1);
  });
});

test('two workers cannot see each others tables', async () => {
  await withTempDb(async () => {
    const news = await openWorkerDb('core.news');
    const publisher = await openWorkerDb('core.publisher.x');
    const newsItems = await news.defineTable<{ id: string }>('items', {
      columns: [{ name: 'id', type: 'TEXT', primaryKey: true }],
    });
    const publisherItems = await publisher.defineTable<{ id: string }>('items', {
      columns: [{ name: 'id', type: 'TEXT', primaryKey: true }],
    });
    newsItems.insert({ id: 'n1' });
    publisherItems.insert({ id: 'p1' });

    assert.notEqual(newsItems.fullName, publisherItems.fullName);
    assert.equal(news.listTables.toString().length > 0, true);
    assert.equal((await news.listTables()).every((name) => name.startsWith('worker_core_news_')), true);
    assert.equal((await publisher.listTables()).every((name) => name.startsWith('worker_core_publisher_x_')), true);
    assert.equal(newsItems.findOne({ id: 'p1' }), undefined);
    assert.equal(publisherItems.findOne({ id: 'n1' }), undefined);
  });
});

test('defineTable is idempotent and ADD COLUMN migrates new columns', async () => {
  await withTempDb(async () => {
    const worker = await openWorkerDb('core.example');
    const v1 = await worker.defineTable<MemoRow>('memos', {
      columns: [
        { name: 'id', type: 'TEXT', primaryKey: true },
        { name: 'content', type: 'TEXT', notNull: true },
        { name: 'created_at', type: 'TEXT', notNull: true },
      ],
    });
    v1.insert({ id: 'a', content: 'hi', created_at: '2026-05-14T00:00:00.000Z' });

    // Reopen with an extra column.
    const v2 = await worker.defineTable<MemoRow>('memos', {
      columns: [
        { name: 'id', type: 'TEXT', primaryKey: true },
        { name: 'content', type: 'TEXT', notNull: true },
        { name: 'created_at', type: 'TEXT', notNull: true },
        { name: 'pinned', type: 'INTEGER', default: 0 },
      ],
    });
    const row = v2.findOne({ id: 'a' });
    assert.equal(row?.pinned, 0);
    v2.update({ id: 'a' }, { pinned: 1 });
    assert.equal(v2.findOne({ id: 'a' })?.pinned, 1);
  });
});

test('raw() substitutes ${table} with the worker-prefixed name', async () => {
  await withTempDb(async () => {
    const worker = await openWorkerDb('core.example');
    const memos = await worker.defineTable<MemoRow>('memos', {
      columns: [
        { name: 'id', type: 'TEXT', primaryKey: true },
        { name: 'content', type: 'TEXT', notNull: true },
        { name: 'created_at', type: 'TEXT', notNull: true },
      ],
    });
    memos.insert({ id: 'a', content: 'foo', created_at: '2026-05-14T00:00:00.000Z' });
    memos.insert({ id: 'b', content: 'bar', created_at: '2026-05-14T00:00:01.000Z' });

    const stats = memos.raw<{ count: number }>('SELECT COUNT(*) AS count FROM ${table}');
    assert.equal(stats[0]?.count, 2);
  });
});

test('identifier validation rejects illegal table and column names', async () => {
  await withTempDb(async () => {
    const worker = await openWorkerDb('core.example');
    await assert.rejects(
      worker.defineTable('memos; DROP TABLE app_kv', {
        columns: [{ name: 'id', type: 'TEXT', primaryKey: true }],
      }),
      /Invalid table name/,
    );
    await assert.rejects(
      worker.defineTable('memos', {
        columns: [{ name: 'bad name', type: 'TEXT' }],
      }),
      /Invalid column name/,
    );
  });
});

test('upsert respects conflict keys', async () => {
  await withTempDb(async () => {
    const worker = await openWorkerDb('core.example');
    const memos = await worker.defineTable<MemoRow>('memos', {
      columns: [
        { name: 'id', type: 'TEXT', primaryKey: true },
        { name: 'content', type: 'TEXT', notNull: true },
        { name: 'created_at', type: 'TEXT', notNull: true },
      ],
    });
    memos.upsert({ id: 'a', content: 'first', created_at: '2026-05-14T00:00:00.000Z' }, ['id']);
    memos.upsert({ id: 'a', content: 'second', created_at: '2026-05-14T00:00:01.000Z' }, ['id']);
    assert.equal(memos.findOne({ id: 'a' })?.content, 'second');
    assert.equal(memos.count(), 1);
  });
});

test('listTables returns only this worker tables', async () => {
  await withTempDb(async () => {
    // Ensure the app db exists so sqlite_master has core tables to filter out.
    await getAppDb();
    const worker = await openWorkerDb('core.example');
    await worker.defineTable('alpha', {
      columns: [{ name: 'id', type: 'TEXT', primaryKey: true }],
    });
    await worker.defineTable('beta', {
      columns: [{ name: 'id', type: 'TEXT', primaryKey: true }],
    });
    const tables = await worker.listTables();
    assert.deepEqual(tables.sort(), ['worker_core_example_alpha', 'worker_core_example_beta']);
  });
});
