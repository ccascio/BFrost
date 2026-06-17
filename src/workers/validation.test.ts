import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import type { BackendWorkerModule } from './module';
import {
  WorkerModuleValidationError,
  validateAdminApiRoutes,
  validateBackendWorkerModules,
} from './validation';

test('worker module validation accepts a well-formed backend module', () => {
  assert.doesNotThrow(() => validateBackendWorkerModules([moduleFixture()]));
});

test('worker module validation rejects duplicate worker and job ids', () => {
  assert.throws(
    () => validateBackendWorkerModules([moduleFixture({ workerId: 'local.one' }), moduleFixture({ workerId: 'local.one' })]),
    WorkerModuleValidationError,
  );

  assert.throws(
    () => validateBackendWorkerModules([moduleFixture({ jobId: 'same-job' }), moduleFixture({ workerId: 'local.two', jobId: 'same-job' })]),
    WorkerModuleValidationError,
  );
});

test('worker module validation rejects mismatched job ownership and invalid defaults', () => {
  assert.throws(
    () => validateBackendWorkerModules([moduleFixture({ jobWorkerId: 'local.other' })]),
    /expected local.one/,
  );

  assert.throws(
    () => validateBackendWorkerModules([moduleFixture({ defaultParams: { count: 'bad' } })]),
    /Default params/,
  );
});

test('admin route validation rejects duplicate routes and unknown owners', () => {
  const route = {
    method: 'POST',
    path: '/api/local/example',
    workerIds: ['local.one'],
    async handle() {
      return { status: 200, body: { ok: true } };
    },
  };

  assert.throws(() => validateAdminApiRoutes([route, route], ['local.one']), /Duplicate admin API route/);
  assert.throws(() => validateAdminApiRoutes([route], ['local.other']), /unknown worker owner/);
});

test('admin route validation rejects duplicate parameterized route patterns', () => {
  const first = routeFixture('/api/workers/:id/settings');
  const second = routeFixture('/api/workers/:workerId/settings');
  const specific = routeFixture('/api/workers/rescan/settings');

  assert.throws(
    () => validateAdminApiRoutes([first, second], ['local.one']),
    /Duplicate admin API route pattern/,
  );
  assert.doesNotThrow(() => validateAdminApiRoutes([first, specific], ['local.one']));
});

function moduleFixture(options: {
  workerId?: string;
  jobId?: string;
  jobWorkerId?: string;
  defaultParams?: Record<string, unknown>;
} = {}): BackendWorkerModule {
  const workerId = options.workerId ?? 'local.one';
  const jobId = options.jobId ?? `${workerId}.job`;
  const paramsSchema = z.object({ count: z.number().int().min(1) });

  return {
    manifest: {
      id: workerId,
      name: 'Local Test Worker',
      version: '0.1.0',
      description: 'A worker module used by validation tests.',
      builtIn: false,
      jobs: [
        {
          id: jobId,
          workerId: options.jobWorkerId ?? workerId,
          label: 'Local Test Job',
          description: 'A local test job.',
          defaultEnabled: false,
          defaultCron: '0 0 * * *',
          defaultModelAlias: '',
          approvalRequiredDefault: false,
          approvalRequiredEditable: false,
          defaultPrompt: '',
          prompt: { editable: false },
          paramsSchema,
          defaultParams: options.defaultParams ?? { count: 1 },
          dashboardFields: [
            {
              key: 'count',
              label: 'Count',
              type: 'number',
              defaultValue: 1,
            },
          ],
          async run() {
            return { summary: 'ok', itemCount: 0 };
          },
        },
      ],
    },
  };
}

function routeFixture(path: string) {
  return {
    method: 'POST',
    path,
    workerIds: ['local.one'],
    async handle() {
      return { status: 200, body: { ok: true } };
    },
  };
}
