import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { config } from './config';
import { closeDb, ensureAppDb } from './sqlite';

test('ensureAppDb skips repeated filesystem setup while the current connection is live', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'BFrost-sqlite-ensure-'));
  const previousDbPath = config.appDbPath;
  const previousLogLevel = config.logLevel;
  const previousDebug = console.debug;
  const lines: string[] = [];
  config.appDbPath = path.join(dir, 'app.sqlite');
  config.logLevel = 'debug';
  console.debug = (...args: unknown[]) => lines.push(args.map(String).join(' '));

  try {
    await ensureAppDb();
    const firstEnsureStarts = lines.filter((line) => line.includes(' START sqlite.ensure')).length;
    await ensureAppDb();
    const secondEnsureStarts = lines.filter((line) => line.includes(' START sqlite.ensure')).length;

    assert.equal(firstEnsureStarts, 1);
    assert.equal(secondEnsureStarts, 1, 'live DB fast path must not schedule another ensure boundary');
  } finally {
    closeDb();
    console.debug = previousDebug;
    config.logLevel = previousLogLevel;
    config.appDbPath = previousDbPath;
    await rm(dir, { recursive: true, force: true });
  }
});
