import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
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

// ── Restore-path tests ────────────────────────────────────────────────────────

test('scheduleRestoreOnNextBoot writes a restore-pending marker file', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-restore-'));
  const previousAdminDir = config.adminStoreDir;
  config.adminStoreDir = path.join(dir, 'admin');

  try {
    await scheduleRestoreOnNextBoot('some-backup.sqlite');
    const markerPath = path.join(config.adminStoreDir, 'restore-pending.json');
    assert.ok(existsSync(markerPath), 'marker file should exist');
    const parsed = JSON.parse(await readFile(markerPath, 'utf8')) as { file?: string; requestedAt?: string };
    assert.equal(parsed.file, 'some-backup.sqlite');
    assert.ok(parsed.requestedAt, 'requestedAt should be set');
  } finally {
    config.adminStoreDir = previousAdminDir;
    await rm(dir, { recursive: true, force: true });
  }
});

test('applyPendingRestoreIfAny is a no-op when no marker exists', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-restore-'));
  const previousAdminDir = config.adminStoreDir;
  const previousDbPath = config.appDbPath;
  config.adminStoreDir = path.join(dir, 'admin');
  config.appDbPath = path.join(dir, 'live.sqlite');

  try {
    await applyPendingRestoreIfAny();
    assert.ok(!existsSync(config.appDbPath), 'no DB should be created when there is no pending restore');
  } finally {
    config.adminStoreDir = previousAdminDir;
    config.appDbPath = previousDbPath;
    await rm(dir, { recursive: true, force: true });
  }
});

test('applyPendingRestoreIfAny (valid backup): swaps DB and leaves .pre-restore safety copy', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-restore-'));
  const previousAdminDir = config.adminStoreDir;
  const previousDbPath = config.appDbPath;
  config.adminStoreDir = path.join(dir, 'admin');
  config.appDbPath = path.join(dir, 'live.sqlite');

  const backupDir = path.join(config.adminStoreDir, 'backups');
  const backupFile = 'bfrost-test-backup.sqlite';
  const backupPath = path.join(backupDir, backupFile);

  try {
    // Create a live DB with known content
    const liveDb = new Database(config.appDbPath);
    liveDb.exec("CREATE TABLE live_marker (v TEXT); INSERT INTO live_marker VALUES ('original')");
    liveDb.close();

    // Create a valid backup DB with different content
    await mkdir(backupDir, { recursive: true });
    const backupDb = new Database(backupPath);
    backupDb.exec("CREATE TABLE backup_marker (v TEXT); INSERT INTO backup_marker VALUES ('restored')");
    backupDb.close();

    await scheduleRestoreOnNextBoot(backupFile);
    await applyPendingRestoreIfAny();

    // Live DB file should now contain backup content
    const restoredDb = new Database(config.appDbPath, { readonly: true, fileMustExist: true });
    const row = restoredDb.prepare('SELECT v FROM backup_marker').get() as { v: string } | undefined;
    restoredDb.close();
    assert.equal(row?.v, 'restored', 'live DB should now contain backup content');

    // .pre-restore safety copy must exist and hold original content
    assert.ok(existsSync(config.appDbPath + '.pre-restore'), '.pre-restore safety copy should exist');
    const preRestoreDb = new Database(config.appDbPath + '.pre-restore', { readonly: true, fileMustExist: true });
    const origRow = preRestoreDb.prepare('SELECT v FROM live_marker').get() as { v: string } | undefined;
    preRestoreDb.close();
    assert.equal(origRow?.v, 'original', '.pre-restore should contain the original DB content');

    // Marker file should be cleared
    assert.ok(!existsSync(path.join(config.adminStoreDir, 'restore-pending.json')), 'marker should be cleared after restore');
  } finally {
    closeDb();
    config.adminStoreDir = previousAdminDir;
    config.appDbPath = previousDbPath;
    await rm(dir, { recursive: true, force: true });
  }
});

test('applyPendingRestoreIfAny (corrupted backup): refuses restore and leaves live DB intact', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-restore-'));
  const previousAdminDir = config.adminStoreDir;
  const previousDbPath = config.appDbPath;
  config.adminStoreDir = path.join(dir, 'admin');
  config.appDbPath = path.join(dir, 'live.sqlite');

  const backupDir = path.join(config.adminStoreDir, 'backups');
  const backupFile = 'corrupted-backup.sqlite';
  const backupPath = path.join(backupDir, backupFile);

  try {
    // Create a live DB with known content
    const liveDb = new Database(config.appDbPath);
    liveDb.exec("CREATE TABLE sentinel (v TEXT); INSERT INTO sentinel VALUES ('intact')");
    liveDb.close();

    // Write garbage bytes as the "backup"
    await mkdir(backupDir, { recursive: true });
    await writeFile(backupPath, Buffer.from('this is NOT a sqlite database \x00\x01\x02'));

    await scheduleRestoreOnNextBoot(backupFile);
    await applyPendingRestoreIfAny();

    // Live DB data must be intact — open it and verify the sentinel row is still there.
    // (Raw bytes may differ because recordEventSafe writes a failure event, but the
    //  live DB is never replaced by the corrupted backup.)
    const liveAfterDb = new Database(config.appDbPath, { readonly: true, fileMustExist: true });
    const sentinelRow = liveAfterDb.prepare('SELECT v FROM sentinel').get() as { v: string } | undefined;
    liveAfterDb.close();
    assert.equal(sentinelRow?.v, 'intact', 'live DB data should be intact after a refused restore');

    // No .pre-restore file should have been created (restore never started)
    assert.ok(!existsSync(config.appDbPath + '.pre-restore'), '.pre-restore should NOT exist when restore is aborted');
  } finally {
    closeDb();
    config.adminStoreDir = previousAdminDir;
    config.appDbPath = previousDbPath;
    await rm(dir, { recursive: true, force: true });
  }
});
