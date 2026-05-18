import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { config } from '../config';
import { bootstrapLocalWorkers } from './bootstrap';
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
  const parentDir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-bootstrap-'));
  const workerDir = await setupWorkerDir(parentDir, moduleJs);
  const prevDbPath = config.appDbPath;
  const prevWorkerPaths = config.workerPaths;
  config.appDbPath = path.join(parentDir, 'app.sqlite');
  config.workerPaths = [parentDir];
  try {
    await fn(workerDir);
  } finally {
    unregisterLocalWorkerModule(WORKER_ID);
    config.appDbPath = prevDbPath;
    config.workerPaths = prevWorkerPaths;
    await rm(parentDir, { recursive: true, force: true });
  }
}

test('bootstrap — onMigrate called with fromVersion=null on first boot', async () => {
  await withBootstrapSetup(WORKER_MODULE_JS, async (workerDir) => {
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
