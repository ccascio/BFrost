import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import Database from 'better-sqlite3';
import { config } from './config';
import { createAppBackup, listAppBackups, scheduleRestoreOnNextBoot, applyPendingRestoreIfAny } from './app-backup';
import { saveKvJson, closeDb } from './sqlite';

test('app backups create consistent SQLite backup files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-backup-'));
  const previousDbPath = config.appDbPath;
  const previousAdminDir = config.adminStoreDir;
  config.appDbPath = path.join(dir, 'app.sqlite');
  config.adminStoreDir = path.join(dir, 'admin');

  try {
    await saveKvJson('backup.test', { ok: true });

    const backup = await createAppBackup('2026-04-24T08:00:00.000Z');

    assert.equal(backup.file, 'bfrost-2026-04-24T08-00-00-000Z.sqlite');
    assert.equal(backup.path, path.join(config.adminStoreDir, 'backups', backup.file));
    assert.ok(backup.sizeBytes > 0);

    const backups = await listAppBackups();
    assert.equal(backups.length, 1);
    assert.equal(backups[0].file, backup.file);
  } finally {
    config.appDbPath = previousDbPath;
    config.adminStoreDir = previousAdminDir;
    await rm(dir, { recursive: true, force: true });
  }
});

test('app backups list returns empty when no backup directory exists', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-backup-'));
  const previousAdminDir = config.adminStoreDir;
  config.adminStoreDir = path.join(dir, 'admin');

  try {
    assert.deepEqual(await listAppBackups(), []);
  } finally {
    config.adminStoreDir = previousAdminDir;
    await rm(dir, { recursive: true, force: true });
  }
});
