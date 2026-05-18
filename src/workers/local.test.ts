import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { config } from '../config';
import { discoverLocalWorkerResult, discoverLocalWorkers } from './local';
import { isWorkerEnabled, loadWorkerState, rememberSeenWorkers, setWorkerEnabled } from './state';

test('local worker discovery loads manifest-only workers from configured directories', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-workers-'));
  const workerDir = path.join(dir, 'example');
  await mkdir(workerDir, { recursive: true });
  await writeFile(
    path.join(workerDir, 'worker.json'),
    JSON.stringify({
      id: 'local.example',
      name: 'Example Local Worker',
      version: '0.1.0',
      description: 'A manifest-only local worker for tests.',
      requiredCredentials: [{ key: 'googleSearchConfigured', label: 'Google Search credentials' }],
      ownedSettings: [
        {
          key: 'example-job-settings',
          label: 'Example job settings',
          description: 'Settings owned by this local worker.',
          scope: 'job',
          storageKey: 'admin.settings.jobs.local-example',
          dashboardTarget: 'jobs',
        },
      ],
      dashboard: {
        settings: [
          {
            id: 'example-settings',
            label: 'Example settings',
            description: 'A local worker settings surface.',
            tab: 'workers',
            path: '/api/workers/local.example',
          },
        ],
      },
    }),
  );

  try {
    const workers = await discoverLocalWorkers([dir]);
    assert.equal(workers.length, 1);
    assert.equal(workers[0].manifest.id, 'local.example');
    assert.equal(workers[0].manifest.builtIn, false);
    assert.equal(workers[0].manifest.jobs.length, 0);
    assert.equal(workers[0].manifest.ownedSettings?.[0]?.scope, 'job');
    assert.equal(workers[0].manifest.dashboard?.settings?.[0]?.id, 'example-settings');
    assert.equal(workers[0].sourcePath, path.join(workerDir, 'worker.json'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('local worker discovery reports incompatible manifests', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-workers-bad-'));
  const workerDir = path.join(dir, 'bad');
  await mkdir(workerDir, { recursive: true });
  await writeFile(
    path.join(workerDir, 'worker.json'),
    JSON.stringify({
      manifestVersion: 99,
      bfrostApiVersion: '0.1',
      id: 'local.bad',
      name: 'Bad Local Worker',
      version: '0.1.0',
      description: 'An incompatible local worker for tests.',
    }),
  );

  try {
    const result = await discoverLocalWorkerResult([dir]);
    assert.equal(result.workers.length, 0);
    assert.equal(result.issues.length, 1);
    assert.match(result.issues[0].message, /Unsupported manifestVersion 99/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('local worker discovery rejects unsafe backend entrypoints', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-workers-entrypoint-'));
  const workerDir = path.join(dir, 'unsafe');
  await mkdir(workerDir, { recursive: true });
  await writeFile(
    path.join(workerDir, 'worker.json'),
    JSON.stringify({
      id: 'local.unsafe-entrypoint',
      name: 'Unsafe Entrypoint',
      version: '0.1.0',
      description: 'A local worker with an unsafe backend entrypoint.',
      backendEntrypoint: '../outside.js',
    }),
  );

  const originalWarn = console.warn;
  try {
    console.warn = () => {};
    const result = await discoverLocalWorkerResult([dir]);
    assert.equal(result.workers.length, 0);
    assert.equal(result.issues.length, 1);
    assert.match(result.issues[0].message, /must stay inside the worker directory/);
  } finally {
    console.warn = originalWarn;
    await rm(dir, { recursive: true, force: true });
  }
});

test('local worker examples are valid manifests', async () => {
  const result = await discoverLocalWorkerResult([path.join(process.cwd(), 'workers', 'examples')]);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(
    result.workers.map((worker) => worker.manifest.id).sort(),
    ['local.complete-capability', 'local.dashboard-view-example', 'local.publisher.wordpress', 'local.research-style-job', 'local.simple-job'],
  );
});

test('worker state persists enable and disable lifecycle', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-worker-state-'));
  const previousDir = config.adminStoreDir;
  const previousDbPath = config.appDbPath;
  config.adminStoreDir = dir;
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    let state = await rememberSeenWorkers([{ id: 'local.example', builtIn: false, sourcePath: '/tmp/worker.json' }]);
    assert.equal(isWorkerEnabled('local.example', state), true);

    state = await setWorkerEnabled('local.example', false, { builtIn: false, sourcePath: '/tmp/worker.json' });
    assert.equal(isWorkerEnabled('local.example', state), false);

    const stored = await loadWorkerState();
    assert.equal(stored.workers['local.example'].enabled, false);
    assert.equal(stored.workers['local.example'].sourcePath, '/tmp/worker.json');
  } finally {
    config.adminStoreDir = previousDir;
    config.appDbPath = previousDbPath;
    await rm(dir, { recursive: true, force: true });
  }
});
