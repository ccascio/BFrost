import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { z } from 'zod';
import { config } from './config';
import { loadAdminSettings, updateAdminJob } from './admin-config';
import { getWorkerJob } from './workers/registry';
import { saveKvJson } from './sqlite';
import { registerLoadedLocalModule, unregisterLocalWorkerModule } from './workers/registry';
import type { BackendWorkerModule } from './workers/module';

test('admin settings normalize defaults and persist valid job updates', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-admin-'));
  const previousDir = config.adminStoreDir;
  const previousDbPath = config.appDbPath;
  config.adminStoreDir = dir;
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    const defaults = await loadAdminSettings();
    assert.equal(defaults.jobs['news-digest'].enabled, false);
    assert.equal(defaults.jobs['tweet-post'].approvalRequired, true);
    assert.equal(defaults.jobs['tweet-post'].prompt, getWorkerJob('tweet-post').defaultPrompt);

    const updated = await updateAdminJob('news-digest', {
      enabled: true,
      cron: '*/30 * * * *',
      modelAlias: 'gpt-5.4-mini',
    });

    assert.equal(updated.jobs['news-digest'].enabled, true);
    assert.equal(updated.jobs['news-digest'].cron, '*/30 * * * *');
    assert.equal(updated.jobs['news-digest'].modelAlias, 'gpt-5.4-mini');
  } finally {
    config.adminStoreDir = previousDir;
    config.appDbPath = previousDbPath;
    await rm(dir, { recursive: true, force: true });
  }
});

test('tweet post settings persist approval and prompt controls', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-admin-'));
  const previousDir = config.adminStoreDir;
  const previousDbPath = config.appDbPath;
  config.adminStoreDir = dir;
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    const updated = await updateAdminJob('tweet-post', {
      approvalRequired: false,
      prompt: 'Use this custom prompt with {items}.',
    });

    assert.equal(updated.jobs['tweet-post'].approvalRequired, false);
    assert.equal(updated.jobs['tweet-post'].prompt, 'Use this custom prompt with {items}.');
  } finally {
    config.adminStoreDir = previousDir;
    config.appDbPath = previousDbPath;
    await rm(dir, { recursive: true, force: true });
  }
});

test('admin settings reject invalid cron expressions', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-admin-'));
  const previousDir = config.adminStoreDir;
  const previousDbPath = config.appDbPath;
  config.adminStoreDir = dir;
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    await assert.rejects(
      () => updateAdminJob('tweet-post', { cron: 'not a cron' }),
      /Invalid cron expression/,
    );
  } finally {
    config.adminStoreDir = previousDir;
    config.appDbPath = previousDbPath;
    await rm(dir, { recursive: true, force: true });
  }
});

test('admin settings preserve unknown jobs as disabled historical settings', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-admin-'));
  const previousDir = config.adminStoreDir;
  const previousDbPath = config.appDbPath;
  config.adminStoreDir = dir;
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    const current = await updateAdminJob('tweet-post', { enabled: true });
    await saveKvJson('admin.settings', {
      ...current,
      jobs: {
        ...current.jobs,
        'missing-local-worker-job': {
          enabled: true,
          cron: '*/15 * * * *',
          modelAlias: 'old-local-model',
          approvalRequired: true,
          prompt: 'Historical prompt',
          params: { retained: true },
        },
      },
    });

    const normalized = await loadAdminSettings();
    assert.equal(normalized.jobs['missing-local-worker-job'].enabled, false);
    assert.equal(normalized.jobs['missing-local-worker-job'].cron, '*/15 * * * *');
    assert.equal(normalized.jobs['missing-local-worker-job'].modelAlias, '');
    assert.equal(normalized.jobs['missing-local-worker-job'].approvalRequired, true);
    assert.equal(normalized.jobs['missing-local-worker-job'].prompt, 'Historical prompt');
    assert.deepEqual(normalized.jobs['missing-local-worker-job'].params, { retained: true });
  } finally {
    config.adminStoreDir = previousDir;
    config.appDbPath = previousDbPath;
    await rm(dir, { recursive: true, force: true });
  }
});

test('admin settings clear stale model aliases for known jobs', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-admin-'));
  const previousDir = config.adminStoreDir;
  const previousDbPath = config.appDbPath;
  config.adminStoreDir = dir;
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    const job = getWorkerJob('personal-research');
    await saveKvJson('admin.settings', {
      timezone: 'Europe/Rome',
      jobs: {
        'personal-research': {
          enabled: true,
          cron: '15 0,7 * * *',
          modelAlias: 'qwen',
          approvalRequired: false,
          prompt: job.defaultPrompt,
          params: job.defaultParams,
        },
      },
    });

    const normalized = await loadAdminSettings();
    assert.equal(normalized.jobs['personal-research'].modelAlias, '');
  } finally {
    config.adminStoreDir = previousDir;
    config.appDbPath = previousDbPath;
    await rm(dir, { recursive: true, force: true });
  }
});

test('admin settings preserve known job params and fill new fields with manifest defaults on reload', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-admin-'));
  const previousDir = config.adminStoreDir;
  const previousDbPath = config.appDbPath;
  config.adminStoreDir = dir;
  config.appDbPath = path.join(dir, 'app.sqlite');

  const FAKE_WORKER_ID = 'test.migration-params-worker';
  const FAKE_JOB_ID = 'test.migration-params-job';

  const fakeModule: BackendWorkerModule = {
    manifest: {
      id: FAKE_WORKER_ID,
      name: 'Params Migration Test Worker',
      version: '0.2.0',
      description: 'Tests that job param defaults fill in new fields on settings reload.',
      builtIn: false,
      jobs: [
        {
          id: FAKE_JOB_ID,
          workerId: FAKE_WORKER_ID,
          label: 'Params Migration Job',
          description: 'A job with a two-field params schema.',
          defaultEnabled: false,
          defaultCron: '0 0 * * *',
          defaultModelAlias: 'gpt-5.4-mini',
          approvalRequiredDefault: false,
          approvalRequiredEditable: false,
          defaultPrompt: '',
          prompt: { editable: false },
          paramsSchema: z.object({
            limit: z.number().default(5),
            category: z.string().default('tech'),
          }),
          defaultParams: { limit: 5, category: 'tech' },
          dashboardFields: [],
          run: async () => ({ summary: 'ok' }),
        },
      ],
    },
  };

  registerLoadedLocalModule(fakeModule);

  try {
    // Simulate stored settings from an older manifest version that only knew about 'limit'.
    await saveKvJson('admin.settings', {
      timezone: 'Europe/Rome',
      jobs: {
        [FAKE_JOB_ID]: {
          enabled: true,
          cron: '*/10 * * * *',
          modelAlias: '',
          approvalRequired: false,
          prompt: '',
          params: { limit: 20 },
        },
      },
    });

    const normalized = await loadAdminSettings();
    const jobSettings = normalized.jobs[FAKE_JOB_ID];
    assert.ok(jobSettings, 'job settings present');
    assert.equal((jobSettings.params as { limit: number }).limit, 20, 'known field preserved');
    assert.equal((jobSettings.params as { category: string }).category, 'tech', 'new field filled with manifest default');
    assert.equal(jobSettings.enabled, true, 'enabled flag preserved');
    assert.equal(jobSettings.cron, '*/10 * * * *', 'cron preserved');
  } finally {
    unregisterLocalWorkerModule(FAKE_WORKER_ID);
    config.adminStoreDir = previousDir;
    config.appDbPath = previousDbPath;
    await rm(dir, { recursive: true, force: true });
  }
});
