import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRegisteredWorkerDashboardData } from './dashboard-data';
import type { BackendWorkerModule } from './module';
import { registerLoadedLocalModule, unregisterLocalWorkerModule } from './registry';

function dashboardModule(id: string, calls: string[]): BackendWorkerModule {
  return {
    manifest: {
      id,
      name: id,
      version: '0.1.0',
      description: `Dashboard data test worker ${id}.`,
      builtIn: false,
      jobs: [],
    },
    async loadDashboardData(context) {
      calls.push(id);
      return { id, activeScopeId: context?.activeScopeId ?? null };
    },
  };
}

test('worker dashboard data can load only requested worker slices', async () => {
  const firstId = 'local.dashboard-data-first';
  const secondId = 'local.dashboard-data-second';
  const calls: string[] = [];
  registerLoadedLocalModule(dashboardModule(firstId, calls));
  registerLoadedLocalModule(dashboardModule(secondId, calls));

  try {
    const data = await loadRegisteredWorkerDashboardData(
      { activeScopeId: 'scope-a' },
      [secondId, 'local.dashboard-data-missing'],
    );

    assert.deepEqual(calls, [secondId]);
    assert.deepEqual(data, {
      [secondId]: { id: secondId, activeScopeId: 'scope-a' },
    });
  } finally {
    unregisterLocalWorkerModule(firstId);
    unregisterLocalWorkerModule(secondId);
  }
});
