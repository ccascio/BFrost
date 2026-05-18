import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { config } from '../config';
import { loadKvJson } from '../sqlite';
import { openWorkerKv } from './storage';

async function withTempDb<T>(fn: () => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-workerkv-'));
  const previousDbPath = config.appDbPath;
  config.appDbPath = path.join(dir, 'app.sqlite');
  try {
    return await fn();
  } finally {
    config.appDbPath = previousDbPath;
    await rm(dir, { recursive: true, force: true });
  }
}

test('openWorkerKv stores and retrieves values under a namespaced prefix', async () => {
  await withTempDb(async () => {
    const kv = openWorkerKv('core.example');
    await kv.set('alpha', { hello: 'world' });
    const direct = await loadKvJson<{ hello: string }>('worker.core.example.alpha');
    assert.deepEqual(direct, { hello: 'world' });
    assert.deepEqual(await kv.get<{ hello: string }>('alpha'), { hello: 'world' });
  });
});

test('two worker namespaces never collide on the same key', async () => {
  await withTempDb(async () => {
    const a = openWorkerKv('worker.one');
    const b = openWorkerKv('worker.two');
    await a.set('shared', 1);
    await b.set('shared', 2);
    assert.equal(await a.get('shared'), 1);
    assert.equal(await b.get('shared'), 2);
  });
});

test('clear writes null and get returns null afterwards', async () => {
  await withTempDb(async () => {
    const kv = openWorkerKv('core.example');
    await kv.set('alpha', 'value');
    await kv.clear('alpha');
    assert.equal(await kv.get('alpha'), null);
  });
});

test('invalid worker ids and keys are rejected', () => {
  assert.throws(() => openWorkerKv('INVALID WORKER'), /Invalid worker id/);
  const kv = openWorkerKv('core.example');
  assert.rejects(() => kv.set('bad key with spaces', 1), /Invalid worker KV key/);
});
