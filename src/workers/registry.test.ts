import assert from 'node:assert/strict';
import test from 'node:test';
import { builtInWorkerApiRoutes } from './builtin/api-routes';
import { builtInWorkerModules } from './builtin';
import type { BackendWorkerModule } from './module';
import {
  getRegisteredWorkerJob,
  isJobName,
  jobLabels,
  knownJobs,
  listRegisteredApiRoutes,
  listWorkerModules,
  listWorkers,
  registerLoadedLocalModule,
  unregisterLocalWorkerModule,
} from './registry';
import { validateBackendWorkerModules } from './validation';

test('built-in worker modules pass central validation', () => {
  assert.doesNotThrow(() => validateBackendWorkerModules(builtInWorkerModules));
});

test('built-in worker registry exposes existing jobs with stable ids', () => {
  assert.deepEqual(knownJobs(), [
    'finance-analysis',
    'finance-news-scan',
    'news-digest',
    'ops-digest',
    'tweet-post',
    'personal-research',
  ]);

  assert.equal(isJobName('tweet-post'), true);
  assert.equal(isJobName('missing-job'), false);
  assert.equal(jobLabels()['personal-research'], 'Personal Research');
});

test('built-in jobs include worker ownership and defaults', () => {
  const workers = listWorkers();
  assert.equal(workers.length, 23);
  assert.equal(workers.every((worker) => worker.builtIn), true);

  const tweetPost = getRegisteredWorkerJob('tweet-post');
  assert.equal(tweetPost.worker.id, 'core.publisher.x');
  assert.equal(tweetPost.worker.name, 'X Publisher');
  assert.equal(tweetPost.job.defaultEnabled, false);
  assert.equal(tweetPost.job.approvalRequiredDefault, true);
  assert.equal(tweetPost.job.defaultCron, '45 0,7 * * *');
  assert.equal(tweetPost.job.paramsSchema.safeParse(tweetPost.job.defaultParams).success, true);
  assert.equal(tweetPost.worker.dashboard?.settings?.[0]?.path, '/api/workers/publisher-x/params');
  assert.equal(tweetPost.worker.dashboard?.settings?.[1]?.path, '/api/cron-jobs/tweet-post');
  assert.equal(tweetPost.worker.dashboard?.settings?.[2]?.path, '/api/x-credentials');
  assert.equal(tweetPost.worker.dashboard?.routes?.[0]?.tab, 'queue');
  assert.equal(tweetPost.worker.ownedSettings?.[0]?.storageKey, 'admin.settings.jobs.tweet-post');
});

test('built-in job dashboard fields match valid default params', () => {
  for (const jobId of knownJobs()) {
    const { job } = getRegisteredWorkerJob(jobId);
    assert.equal(job.paramsSchema.safeParse(job.defaultParams).success, true);
    for (const field of job.dashboardFields) {
      assert.ok(field.key in (job.defaultParams ?? {}), `${job.id} field ${field.key} is missing from default params`);
    }
  }
});

test('built-in worker API routes have unique method/path pairs and known owners', () => {
  const workerIds = new Set(listWorkers().map((worker) => worker.id));
  const seen = new Set<string>();

  for (const route of builtInWorkerApiRoutes) {
    const key = `${route.method} ${route.path}`;
    assert.equal(seen.has(key), false, `Duplicate worker API route: ${key}`);
    seen.add(key);
    assert.ok(route.workerIds.length > 0, `${key} should declare worker owners`);
    for (const workerId of route.workerIds) {
      assert.equal(workerIds.has(workerId), true, `${key} declares unknown worker owner ${workerId}`);
    }
  }
});

test('local module registration validates modules before exposing routes', () => {
  const badModule = {
    manifest: {
      id: 'local.invalid-registry-test',
      name: 'Invalid Local Worker',
      version: '0.1.0',
      description: 'A malformed worker module.',
      builtIn: false,
      jobs: [
        {
          id: 'local-invalid-job',
          label: 'Invalid job',
          description: 'Missing workerId and the rest of the job contract.',
        },
      ],
    },
  } as unknown as BackendWorkerModule;

  assert.throws(
    () => registerLoadedLocalModule(badModule),
    /expected local.invalid-registry-test/,
  );
  assert.equal(listWorkers().some((worker) => worker.id === 'local.invalid-registry-test'), false);
});

test('registered local modules expose API routes and dashboard data hooks through the registry', () => {
  const module: BackendWorkerModule = {
    manifest: {
      id: 'local.registry-test',
      name: 'Registry Test Worker',
      version: '0.1.0',
      description: 'A local module used by registry tests.',
      builtIn: false,
      jobs: [],
    },
    apiRoutes: [
      {
        method: 'GET',
        path: '/api/workers/local.registry-test/status',
        workerIds: ['local.registry-test'],
        async handle() {
          return { status: 200, body: { ok: true } };
        },
      },
    ],
    async loadDashboardData() {
      return { ok: true };
    },
  };

  registerLoadedLocalModule(module);
  try {
    assert.equal(
      listRegisteredApiRoutes().some((route) => route.path === '/api/workers/local.registry-test/status'),
      true,
    );
    assert.equal(
      listWorkerModules().some((entry) => entry.manifest.id === 'local.registry-test' && entry.loadDashboardData),
      true,
    );
  } finally {
    unregisterLocalWorkerModule('local.registry-test');
  }
});
