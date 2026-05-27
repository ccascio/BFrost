import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { config } from './config';
import { acquireRuntimeLock, releaseRuntimeLock } from './runtime-lock';
import { closeDb, getAppDb } from './sqlite';

test('runtime lock can be acquired, refreshed by same process, and released', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-runtime-lock-'));
  const previousDbPath = config.appDbPath;
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    await acquireRuntimeLock();
    await acquireRuntimeLock();

    const db = await getAppDb();
    const row = db
      .prepare('SELECT owner_pid AS ownerPid FROM app_runtime_locks WHERE lock_key = ?')
      .get('bfrost-runtime') as { ownerPid: number } | undefined;
    assert.equal(row?.ownerPid, process.pid);

    await releaseRuntimeLock();
    const afterRelease = db
      .prepare('SELECT owner_pid AS ownerPid FROM app_runtime_locks WHERE lock_key = ?')
      .get('bfrost-runtime');
    assert.equal(afterRelease, undefined);
  } finally {
    await releaseRuntimeLock().catch(() => undefined);
    closeDb();
    config.appDbPath = previousDbPath;
    await rm(dir, { recursive: true, force: true });
  }
});

test('runtime lock rejects another live owner pid', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-runtime-lock-'));
  const previousDbPath = config.appDbPath;
  config.appDbPath = path.join(dir, 'app.sqlite');
  const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], {
    stdio: 'ignore',
  });
  const sleeperPid = sleeper.pid;
  assert.ok(sleeperPid, 'sleeper process should have a pid');

  try {
    const db = await getAppDb();
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
    db.prepare(
      `INSERT INTO app_runtime_locks
         (lock_key, owner_pid, acquired_at, heartbeat_at, host, cwd, command)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'bfrost-runtime',
      sleeperPid,
      '2026-04-24T08:00:00.000Z',
      '2026-04-24T08:00:00.000Z',
      'test-host',
      process.cwd(),
      'node dist/index.js',
    );

    await assert.rejects(
      () => acquireRuntimeLock(),
      /Another BFrost backend is already running/,
    );
  } finally {
    sleeper.kill('SIGKILL');
    await releaseRuntimeLock().catch(() => undefined);
    closeDb();
    config.appDbPath = previousDbPath;
    await rm(dir, { recursive: true, force: true });
  }
});
