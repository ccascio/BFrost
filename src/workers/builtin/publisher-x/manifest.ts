import {
  DEFAULT_TWEET_POST_PARAMS,
  DEFAULT_TWEET_POST_PROMPT,
  TweetPostParamsSchema,
  runTweetPost,
} from './job';
import type { WorkerManifest } from '../../types';

// This worker shows an approval-first publisher: the job can be scheduled,
// but the manifest owns the default approval policy and editable controls.
export const xPublisherWorker: WorkerManifest = {
  id: 'core.publisher.x',
  name: 'X Publisher',
  displayName: 'Post to X',
  version: '0.1.0',
  description: 'Selects approved queue items and drafts or publishes X posts.',
  tagline: 'Turns digest items you have approved into X posts. Drafts go out only after you say yes — nothing is published behind your back.',
  builtIn: true,
  requiredCredentials: [
    { key: 'xConfigured', label: 'X API credentials', settingsTarget: 'health-x' },
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
    {
      key: 'x-credentials',
      label: 'X credentials',
      description: 'Local environment values used for X publishing.',
      scope: 'worker',
      storageKey: '.env.X_*',
      dashboardTarget: 'health',
    },
  ],
  dashboard: {
    settings: [
      {
        id: 'x-credentials',
        label: 'X credentials',
        description: 'OAuth 1.0a app credentials used by the X publishing job. Stored in this worker’s KV; .env is kept in sync.',
        tab: 'config',
        path: '/api/x-credentials',
        fields: [
          {
            key: 'xConsumerKey',
            label: 'Consumer (API) key',
            type: 'secret-reference',
            defaultValue: '',
            placeholder: 'Configured in local .env',
            helpText: 'Stored as X_CONSUMER_KEY. Leave blank to keep the current value.',
          },
          {
            key: 'xConsumerSecret',
            label: 'Consumer (API) secret',
            type: 'secret-reference',
            defaultValue: '',
            placeholder: 'Configured in local .env',
            helpText: 'Stored as X_CONSUMER_SECRET. Leave blank to keep the current value.',
          },
          {
            key: 'xAccessToken',
            label: 'Access token',
            type: 'secret-reference',
            defaultValue: '',
            placeholder: 'Configured in local .env',
            helpText: 'Stored as X_ACCESS_TOKEN. Leave blank to keep the current value.',
          },
          {
            key: 'xAccessTokenSecret',
            label: 'Access token secret',
            type: 'secret-reference',
            defaultValue: '',
            placeholder: 'Configured in local .env',
            helpText: 'Stored as X_ACCESS_TOKEN_SECRET. Leave blank to keep the current value.',
          },
          {
            key: 'xUsername',
            label: 'X handle (optional)',
            type: 'text',
            defaultValue: '',
            helpText: 'Stored as X_USERNAME. Used to build the tweet permalink in the dashboard.',
          },
        ],
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
      workerId: 'core.publisher.x',
      label: 'Tweet Post',
      description: 'Chooses a strong queue item and writes a bounded post for X.',
      defaultEnabled: false,
      defaultCron: '45 0,7 * * *',
      defaultModelAlias: '',
      approvalRequiredDefault: true,
      approvalRequiredEditable: true,
      defaultPrompt: DEFAULT_TWEET_POST_PROMPT,
      prompt: {
        editable: true,
        helpText: 'Available placeholders: {items}, {maxContentLength}, {signature}.',
      },
      paramsSchema: TweetPostParamsSchema,
      defaultParams: DEFAULT_TWEET_POST_PARAMS,
      dashboardFields: [
        { key: 'signature', label: 'Signature', type: 'text', defaultValue: DEFAULT_TWEET_POST_PARAMS.signature },
        { key: 'maxContentLength', label: 'Max content length', type: 'number', defaultValue: DEFAULT_TWEET_POST_PARAMS.maxContentLength, min: 1, max: 280 },
        { key: 'eligibilityWindowHours', label: 'Eligibility window (hours)', type: 'number', defaultValue: DEFAULT_TWEET_POST_PARAMS.eligibilityWindowHours, min: 1, max: 168 },
        { key: 'maxAttempts', label: 'Max post attempts', type: 'number', defaultValue: DEFAULT_TWEET_POST_PARAMS.maxAttempts, min: 1, max: 10 },
        { key: 'maxLlmCandidates', label: 'Max LLM candidates', type: 'number', defaultValue: DEFAULT_TWEET_POST_PARAMS.maxLlmCandidates, min: 1, max: 20 },
      ],
      run: (modelId, params) => runTweetPost(modelId, TweetPostParamsSchema.parse(params ?? {})),
    },
  ],
};
