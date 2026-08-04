import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { config } from '../config';
import { closeDb } from '../sqlite';
import { bootstrapLocalWorkers, migrateBuiltInWorkers } from './bootstrap';
import { unregisterLocalWorkerModule } from './registry';
import { loadWorkerState, saveWorkerState, setWorkerInstalledVersion } from './state';

const WORKER_ID = 'local.migtest';
const WORKER_VERSION = '0.2.0';

const WORKER_MODULE_JS = `
const fs = require('fs');
const path = require('path');
const manifest = {
  manifestVersion: 1, bfrostApiVersion: '0.1',
  id: 'local.migtest', name: 'Migration Test Worker', version: '0.2.0',
  description: 'Fake worker for migration lifecycle tests.', builtIn: false, jobs: [],
};
function record(workerDir, hook, extra) {
  const log = path.join(workerDir, 'lifecycle.json');
  const calls = fs.existsSync(log) ? JSON.parse(fs.readFileSync(log, 'utf8')) : [];
  calls.push({ hook, ...extra });
  fs.writeFileSync(log, JSON.stringify(calls));
}
module.exports = {
  manifest,
  lifecycle: {
    onMigrate: async function(ctx) {
      record(ctx.workerDir, 'onMigrate', { fromVersion: ctx.fromVersion, toVersion: ctx.toVersion });
    },
    onEnable: async function(ctx) { record(ctx.workerDir, 'onEnable', {}); },
  },
};
`;

const FAILING_MIGRATE_MODULE_JS = `
const fs = require('fs');
const path = require('path');
const manifest = {
  manifestVersion: 1, bfrostApiVersion: '0.1',
  id: 'local.migtest', name: 'Migration Test Worker', version: '0.2.0',
  description: 'Fake worker that throws during onMigrate.', builtIn: false, jobs: [],
};
function record(workerDir, hook, extra) {
  const log = path.join(workerDir, 'lifecycle.json');
  const calls = fs.existsSync(log) ? JSON.parse(fs.readFileSync(log, 'utf8')) : [];
  calls.push({ hook, ...extra });
  fs.writeFileSync(log, JSON.stringify(calls));
}
module.exports = {
  manifest,
  lifecycle: {
    onMigrate: async function() { throw new Error('Migration failed on purpose.'); },
    onEnable: async function(ctx) { record(ctx.workerDir, 'onEnable', {}); },
  },
};
`;

interface LifecycleCall {
  hook: string;
  fromVersion?: string | null;
  toVersion?: string;
}

async function setupWorkerDir(parentDir: string, moduleJs: string): Promise<string> {
  const workerDir = path.join(parentDir, 'migtest');
  await mkdir(workerDir, { recursive: true });
  await writeFile(
    path.join(workerDir, 'worker.json'),
    JSON.stringify({
      manifestVersion: 1,
      bfrostApiVersion: '0.1',
      id: WORKER_ID,
      name: 'Migration Test Worker',
      version: WORKER_VERSION,
      description: 'Fake worker for migration lifecycle tests.',
      backendEntrypoint: 'module.js',
    }),
    'utf8',
  );
  await writeFile(path.join(workerDir, 'module.js'), moduleJs, 'utf8');
  return workerDir;
}

async function readLifecycleCalls(workerDir: string): Promise<LifecycleCall[]> {
  try {
    const raw = await readFile(path.join(workerDir, 'lifecycle.json'), 'utf8');
    return JSON.parse(raw) as LifecycleCall[];
  } catch {
    return [];
  }
}

type TestFn = (workerDir: string) => Promise<void>;

async function withBootstrapSetup(moduleJs: string, fn: TestFn): Promise<void> {
  const parentDir = await mkdtemp(path.join(os.tmpdir(), 'BFrost-bootstrap-'));
  const workerDir = await setupWorkerDir(parentDir, moduleJs);
  const prevDbPath = config.appDbPath;
  const prevWorkerPaths = config.workerPaths;
  const prevCodeEnabled = config.localWorkerCodeEnabled;
  config.appDbPath = path.join(parentDir, 'app.sqlite');
  config.workerPaths = [parentDir];
  // These fixtures ship executable code; enable the gate so the lifecycle tests can load them.
  // The gate itself is covered by the dedicated test below.
  config.localWorkerCodeEnabled = true;
  try {
    await fn(workerDir);
  } finally {
    unregisterLocalWorkerModule(WORKER_ID);
    config.appDbPath = prevDbPath;
    config.workerPaths = prevWorkerPaths;
    config.localWorkerCodeEnabled = prevCodeEnabled;
    closeDb();
    await rm(parentDir, { recursive: true, force: true });
  }
}

test('bootstrap — code-bearing local worker is gated behind localWorkerCodeEnabled', async () => {
  // Disable the flag for this case only; withBootstrapSetup enables it by default.
  await withBootstrapSetup(WORKER_MODULE_JS, async (workerDir) => {
    await saveWorkerState({ workers: { [WORKER_ID]: { builtIn: false, enabled: true } } });

    // Gate OFF: the worker must not load, and its onEnable must never run.
    config.localWorkerCodeEnabled = false;
    const blocked = await bootstrapLocalWorkers();
    assert.equal(blocked.loaded.includes(WORKER_ID), false, 'worker must not load when code execution is disabled');
    assert.ok(
      blocked.issues.some((issue) => /code execution is disabled/i.test(issue.message)),
      'a clear issue explains why the worker did not load',
    );
    assert.deepEqual(await readLifecycleCalls(workerDir), [], 'no lifecycle hooks ran while gated');

    // Gate ON: the same worker now loads.
    config.localWorkerCodeEnabled = true;
    const allowed = await bootstrapLocalWorkers();
    assert.ok(allowed.loaded.includes(WORKER_ID), 'worker loads once code execution is enabled');
  });
});

test('bootstrap — freshly discovered local workers stay disabled until explicitly enabled', async () => {
  await withBootstrapSetup(WORKER_MODULE_JS, async (workerDir) => {
    const result = await bootstrapLocalWorkers();

    assert.ok(result.skipped.includes(WORKER_ID), 'worker skipped');
    assert.equal(result.loaded.includes(WORKER_ID), false);
    assert.deepEqual(await readLifecycleCalls(workerDir), []);
  });
});

test('bootstrap — onMigrate called with fromVersion=null on first enabled boot', async () => {
  await withBootstrapSetup(WORKER_MODULE_JS, async (workerDir) => {
    await saveWorkerState({ workers: { [WORKER_ID]: { builtIn: false, enabled: true } } });

    const result = await bootstrapLocalWorkers();

    assert.ok(result.loaded.includes(WORKER_ID), 'worker loaded');

    const calls = await readLifecycleCalls(workerDir);
    const migrate = calls.find((c) => c.hook === 'onMigrate');
    assert.ok(migrate, 'onMigrate was called');
    assert.equal(migrate.fromVersion, null);
    assert.equal(migrate.toVersion, WORKER_VERSION);

    const enable = calls.find((c) => c.hook === 'onEnable');
    assert.ok(enable, 'onEnable was called');

    const state = await loadWorkerState();
    assert.equal(state.workers[WORKER_ID]?.installedVersion, WORKER_VERSION);
  });
});

test('bootstrap — onMigrate NOT called when version is unchanged', async () => {
  await withBootstrapSetup(WORKER_MODULE_JS, async (workerDir) => {
    // Simulate a prior boot that recorded the same version.
    await saveWorkerState({ workers: { [WORKER_ID]: { builtIn: false, enabled: true, installedVersion: WORKER_VERSION } } });

    const result = await bootstrapLocalWorkers();
    assert.ok(result.loaded.includes(WORKER_ID), 'worker loaded');

    const calls = await readLifecycleCalls(workerDir);
    const migrate = calls.find((c) => c.hook === 'onMigrate');
    assert.equal(migrate, undefined, 'onMigrate should not be called when version matches');

    const enable = calls.find((c) => c.hook === 'onEnable');
    assert.ok(enable, 'onEnable is still called even when version matches');
  });
});

test('bootstrap — onMigrate called with correct fromVersion when version bumps', async () => {
  await withBootstrapSetup(WORKER_MODULE_JS, async (workerDir) => {
    const previousVersion = '0.1.0';
    await saveWorkerState({ workers: { [WORKER_ID]: { builtIn: false, enabled: true, installedVersion: previousVersion } } });

    const result = await bootstrapLocalWorkers();
    assert.ok(result.loaded.includes(WORKER_ID), 'worker loaded');

    const calls = await readLifecycleCalls(workerDir);
    const migrate = calls.find((c) => c.hook === 'onMigrate');
    assert.ok(migrate, 'onMigrate was called');
    assert.equal(migrate.fromVersion, previousVersion);
    assert.equal(migrate.toVersion, WORKER_VERSION);

    const state = await loadWorkerState();
    assert.equal(state.workers[WORKER_ID]?.installedVersion, WORKER_VERSION);
  });
});

test('bootstrap — onMigrate failure leaves installedVersion unchanged for retry', async () => {
  await withBootstrapSetup(FAILING_MIGRATE_MODULE_JS, async () => {
    const previousVersion = '0.1.0';
    await saveWorkerState({ workers: { [WORKER_ID]: { builtIn: false, enabled: true, installedVersion: previousVersion } } });

    const result = await bootstrapLocalWorkers();
    // Worker still loads (bootstrap collects errors rather than crashing).
    assert.ok(result.loaded.includes(WORKER_ID), 'worker loaded despite migration failure');

    // installedVersion must remain at the old version so the next boot retries onMigrate.
    const state = await loadWorkerState();
    assert.equal(
      state.workers[WORKER_ID]?.installedVersion,
      previousVersion,
      'installedVersion must not advance when onMigrate throws',
    );
  });
});

/**
 * Built-ins are statically imported and never pass through `activateLocalWorker`, so before
 * `migrateBuiltInWorkers` existed a built-in could declare `onMigrate` and silently never have
 * it run. These cover the contract core now owes them.
 */
const BUILTIN_ID = 'core.migtest-builtin';

async function withBuiltInState(run: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'BFrost-builtin-migrate-'));
  const previousDbPath = config.appDbPath;
  config.appDbPath = path.join(dir, 'app.sqlite');
  try {
    await run();
  } finally {
    config.appDbPath = previousDbPath;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
}

function builtInModule(version: string, onMigrate: () => Promise<void>) {
  return [{ manifest: { id: BUILTIN_ID, version }, lifecycle: { onMigrate } }];
}

test('built-in onMigrate runs when the manifest version moved, and records the new version', async () => {
  await withBuiltInState(async () => {
    await saveWorkerState({ workers: { [BUILTIN_ID]: { builtIn: true, enabled: true, installedVersion: '0.1.0' } } });

    let calls = 0;
    const result = await migrateBuiltInWorkers(
      builtInModule('0.2.0', async () => { calls += 1; }),
      await loadWorkerState(),
    );

    assert.equal(calls, 1, 'onMigrate must run for a built-in whose version moved');
    assert.deepEqual(result.migrated, [BUILTIN_ID]);
    assert.equal((await loadWorkerState()).workers[BUILTIN_ID]?.installedVersion, '0.2.0');
  });
});

test('built-in onMigrate is skipped when the version is unchanged', async () => {
  await withBuiltInState(async () => {
    await saveWorkerState({ workers: { [BUILTIN_ID]: { builtIn: true, enabled: true, installedVersion: '0.2.0' } } });

    let calls = 0;
    const result = await migrateBuiltInWorkers(
      builtInModule('0.2.0', async () => { calls += 1; }),
      await loadWorkerState(),
    );

    assert.equal(calls, 0, 'an unchanged version must not re-run the migration');
    assert.deepEqual(result.migrated, []);
  });
});

test('built-in onMigrate runs on first sight, when no version was ever recorded', async () => {
  await withBuiltInState(async () => {
    // How every built-in starts today: a state record exists but installedVersion never was.
    await saveWorkerState({ workers: { [BUILTIN_ID]: { builtIn: true, enabled: true } } });

    const seen: Array<string | null> = [];
    await migrateBuiltInWorkers(
      builtInModule('0.2.0', async () => { seen.push(null); }),
      await loadWorkerState(),
    );

    assert.equal(seen.length, 1, 'a built-in with no recorded version must migrate once');
    assert.equal((await loadWorkerState()).workers[BUILTIN_ID]?.installedVersion, '0.2.0');
  });
});

test('a throwing built-in onMigrate does not advance the version, so the next boot retries', async () => {
  await withBuiltInState(async () => {
    await saveWorkerState({ workers: { [BUILTIN_ID]: { builtIn: true, enabled: true, installedVersion: '0.1.0' } } });

    const result = await migrateBuiltInWorkers(
      builtInModule('0.2.0', async () => { throw new Error('migration blew up'); }),
      await loadWorkerState(),
    );

    assert.deepEqual(result.failed, [BUILTIN_ID], 'the failure is reported, not thrown');
    assert.equal(
      (await loadWorkerState()).workers[BUILTIN_ID]?.installedVersion,
      '0.1.0',
      'installedVersion must not advance when onMigrate throws',
    );
  });
});
