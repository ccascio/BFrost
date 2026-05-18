import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CronJobUpdateBodySchema,
  DashboardStateSchema,
  ChatMessageBodySchema,
  CloudApiKeysBodySchema,
  DefaultModelBodySchema,
  LmStudioActionBodySchema,
  QueueItemActionBodySchema,
  SourceQualityRulesSchema,
} from './admin-api';

test('admin API schemas accept expected dashboard payloads', () => {
  assert.deepEqual(
    QueueItemActionBodySchema.parse({ id: 'q_123', action: 'approve' }),
    { id: 'q_123', action: 'approve' },
  );
  assert.deepEqual(
    DefaultModelBodySchema.parse({ alias: 'local-model' }),
    { alias: 'local-model' },
  );
  assert.deepEqual(
    CloudApiKeysBodySchema.parse({ openaiApiKey: 'sk-test', anthropicApiKey: 'sk-ant-test' }),
    { openaiApiKey: 'sk-test', anthropicApiKey: 'sk-ant-test' },
  );
  assert.deepEqual(
    CronJobUpdateBodySchema.parse({
      enabled: true,
      cron: '*/30 * * * *',
      modelAlias: 'local-model',
      approvalRequired: true,
      prompt: 'Use {items}.',
    }),
    {
      enabled: true,
      cron: '*/30 * * * *',
      modelAlias: 'local-model',
      approvalRequired: true,
      prompt: 'Use {items}.',
    },
  );
  assert.deepEqual(
    LmStudioActionBodySchema.parse({ action: 'load-default' }),
    { action: 'load-default' },
  );
  assert.deepEqual(
    LmStudioActionBodySchema.parse({ action: 'unload-all' }),
    { action: 'unload-all' },
  );
  assert.deepEqual(
    ChatMessageBodySchema.parse({ message: 'Hello', conversationId: 'dashboard' }),
    { message: 'Hello', conversationId: 'dashboard' },
  );
  assert.deepEqual(
    SourceQualityRulesSchema.parse({
      minScore: 1,
      allowHosts: ['example.com'],
      blockHosts: ['bad.example'],
      preferredHosts: [],
      lowQualityHosts: [],
    }),
    {
      minScore: 1,
      allowHosts: ['example.com'],
      blockHosts: ['bad.example'],
      preferredHosts: [],
      lowQualityHosts: [],
    },
  );
});

test('admin API schemas reject unexpected actions and keys', () => {
  assert.equal(QueueItemActionBodySchema.safeParse({ id: 'q_123', action: 'delete' }).success, false);
  assert.equal(LmStudioActionBodySchema.safeParse({ action: 'restart' }).success, false);
  assert.equal(DefaultModelBodySchema.safeParse({ alias: 'local-model', extra: true }).success, false);
  assert.equal(CloudApiKeysBodySchema.safeParse({ openaiApiKey: 'sk-test', extra: true }).success, false);
});

test('dashboard response schema accepts the control-room payload shape', () => {
  const payload = {
    app: {
      name: 'BFrost Control Room',
      adminUrl: 'http://127.0.0.1:3030',
      timezone: 'UTC',
      now: '2026-04-24T12:00:00.000Z',
      pid: 123,
    },
    models: [{ alias: 'local-model', id: 'local/model', label: 'Local Model', provider: 'lmstudio' }],
    defaultModel: { alias: 'local-model', id: 'local/model', label: 'Local Model', provider: 'lmstudio' },
    lmStudio: {
      running: true,
      loadedModels: ['local/model'],
      loadedCount: 1,
      pinnedModelId: null,
    },
    cron: {
      timezone: 'UTC',
      jobs: [
        {
          name: 'tweet-post',
          label: 'Tweet Post',
          description: 'Chooses a strong queue item and writes a bounded post for X.',
          workerId: 'core.publisher.x',
          workerName: 'X Publisher',
          workerBuiltIn: true,
          workerEnabled: true,
          approvalRequiredEditable: true,
          enabled: false,
          cron: '30 9,14,19 * * *',
          modelAlias: '',
          approvalRequired: true,
          promptEditable: true,
          promptHelpText: 'Available placeholders: {items}, {maxContentLength}, {signature}.',
          prompt: 'Use {items}.',
          params: {
            signature: '',
            maxContentLength: 250,
          },
          dashboardFields: [
            {
              key: 'signature',
              label: 'Signature',
              type: 'text',
              defaultValue: '',
            },
            {
              key: 'maxContentLength',
              label: 'Max content length',
              type: 'number',
              defaultValue: 250,
              min: 1,
              max: 280,
            },
          ],
          effectiveModelAlias: 'local-model',
          running: false,
          lastStartedAt: null,
          lastFinishedAt: null,
          lastStatus: 'idle',
          lastSummary: null,
          lastError: null,
          lastTrigger: null,
        },
      ],
      runs: [
        {
          id: 'run-1',
          job: 'tweet-post',
          label: 'Tweet Post',
          trigger: 'manual',
          modelAlias: 'local-model',
          startedAt: '2026-04-24T08:00:00.000Z',
          finishedAt: '2026-04-24T08:01:00.000Z',
          status: 'success',
          summary: 'Tweet posted.',
          error: null,
          itemCount: 1,
        },
      ],
    },
    workers: [
      {
        id: 'core.publisher.x',
        name: 'X Publisher',
        version: '0.1.0',
        description: 'Selects approved queue items and drafts or publishes X posts.',
        builtIn: true,
        kind: 'feature',
        enabled: true,
        missing: false,
        healthState: 'disabled',
        healthDetail: 'All worker jobs are disabled.',
        jobCount: 1,
        enabledJobCount: 0,
        runningJobCount: 0,
        health: [
          {
            key: 'xConfigured',
            label: 'X API credentials',
            ok: true,
            detail: 'X posting credentials present.',
            required: true,
            kind: 'credential',
            settingsTarget: 'health-x',
          },
        ],
        ownedSettings: [
          {
            key: 'tweet-post-job',
            label: 'Tweet post schedule',
            description: 'Cron, approval, model, prompt, and parameter settings for the X publisher job.',
            scope: 'job',
            storageKey: 'admin.settings.jobs.tweet-post',
            dashboardTarget: 'jobs',
          },
        ],
        dashboard: {
          settings: [
            {
              id: 'x-credentials',
              label: 'X credentials',
              description: 'Credential fields used by the X publishing job.',
              tab: 'health',
              path: '/api/x-credentials',
            },
          ],
          routes: [
            {
              id: 'queue-publishing',
              label: 'Publishing queue',
              description: 'Approved queue items consumed by the X publisher.',
              tab: 'queue',
              path: '/api/queue-item',
            },
          ],
        },
        jobs: [
          {
            id: 'tweet-post',
            label: 'Tweet Post',
            description: 'Chooses a strong queue item and writes a bounded post for X.',
            enabled: false,
            running: false,
            lastStatus: 'idle',
          },
        ],
      },
    ],
    workerIssues: [
      {
        sourcePath: 'workers/broken/worker.json',
        message: 'Unsupported manifestVersion 99; expected 1.',
      },
    ],
    platform: {
      activeLocalProviderId: 'lmstudio',
      primaryChannelId: 'telegram',
      embeddingProvider: 'local',
      embeddingModel: 'text-embedding-nomic-embed-text-v1.5',
    },
    availableLocalProviders: [
      { id: 'lmstudio', label: 'LM Studio', workerId: 'core.providers.lmstudio', workerName: 'LM Studio Provider' },
    ],
    availableChannels: [
      { id: 'telegram', label: 'Telegram', workerId: 'core.channels.telegram', workerName: 'Telegram Channel' },
    ],
    queue: {
      total: 1,
      queued: 1,
      approved: 0,
      posted: 0,
      rejected: 0,
      failed: 0,
      seen: 0,
      retrying: 0,
      recentItems: [
        {
          id: 'q_123',
          title: 'Queued story',
          shortDesc: 'A queued item.',
          url: 'https://example.com/story',
          addedAt: '2026-04-24T08:00:00.000Z',
          state: 'queued',
          stateChangedAt: '2026-04-24T08:00:00.000Z',
          sourceHost: 'example.com',
          sourceScore: 4,
          sourceLabel: 'high',
          sourceReasons: ['Preferred host: example.com.'],
          articleFetched: true,
          articleTitle: 'Queued story',
          articleDescription: 'A detailed article description.',
          articleExcerpt: 'A useful excerpt from the article body.',
          articleFinalUrl: 'https://example.com/story',
          digestRunId: '2026-04-24T12-00-00-000Z.json',
        },
      ],
    },
    sourceRules: {
      minScore: 0,
      allowHosts: [],
      blockHosts: ['x.com'],
      preferredHosts: ['openai.com'],
      lowQualityHosts: ['prnewswire.com'],
    },
    integrations: {
      telegramConfigured: { ok: true, detail: 'Configured' },
      googleSearchConfigured: { ok: true, detail: 'Configured' },
      xConfigured: { ok: true, detail: 'Configured' },
      allowedUserConfigured: { ok: true, detail: 'Configured' },
      openaiConfigured: { ok: false, detail: 'Missing' },
      anthropicConfigured: { ok: false, detail: 'Missing' },
    },
    dependencies: {
      lmStudioCli: { ok: true, detail: 'Available' },
      ffmpeg: { ok: true, detail: 'Available' },
      whisperCli: { ok: true, detail: 'Available' },
      whisperModel: { ok: true, detail: 'Available' },
      sqliteCli: { ok: true, detail: 'Available' },
      embeddingModelReachable: { ok: true, detail: 'Available' },
    },
    events: [],
    backups: [
      {
        file: 'bfrost-2026-04-24T08-00-00-000Z.sqlite',
        path: 'data/admin/backups/bfrost-2026-04-24T08-00-00-000Z.sqlite',
        createdAt: '2026-04-24T08:00:00.000Z',
        sizeBytes: 4096,
      },
    ],
    research: {
      settings: { topics: ['ai'] },
      notes: [],
      events: [],
    },
  };

  assert.equal(DashboardStateSchema.safeParse(payload).success, true);
});
