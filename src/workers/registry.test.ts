import assert from 'node:assert/strict';
import test from 'node:test';
import { builtInWorkerApiRoutes } from './builtin/api-routes';
import { builtInWorkerModules } from './builtin';
import {
  getRegisteredWorkerJob,
  isJobName,
  jobLabels,
  knownJobs,
  listWorkers,
} from './registry';
import { validateBackendWorkerModules } from './validation';

test('built-in worker modules pass central validation', () => {
  assert.doesNotThrow(() => validateBackendWorkerModules(builtInWorkerModules));
});

test('built-in worker registry exposes existing jobs with stable ids', () => {
  assert.deepEqual(knownJobs(), [
    'news-digest',
    'tweet-post',
    'personal-research',
  ]);

  assert.equal(isJobName('tweet-post'), true);
  assert.equal(isJobName('missing-job'), false);
  assert.equal(jobLabels()['personal-research'], 'Personal Research');
});

test('built-in jobs include worker ownership and defaults', () => {
  const workers = listWorkers();
  assert.equal(workers.length, 8);
  assert.equal(workers.every((worker) => worker.builtIn), true);

  const tweetPost = getRegisteredWorkerJob('tweet-post');
  assert.equal(tweetPost.worker.id, 'core.publisher.x');
  assert.equal(tweetPost.worker.name, 'X Publisher');
  assert.equal(tweetPost.job.defaultEnabled, false);
  assert.equal(tweetPost.job.approvalRequiredDefault, true);
  assert.equal(tweetPost.job.defaultCron, '45 0,7 * * *');
  assert.equal(tweetPost.job.paramsSchema.safeParse(tweetPost.job.defaultParams).success, true);
  assert.equal(tweetPost.worker.dashboard?.settings?.[0]?.path, '/api/x-credentials');
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
