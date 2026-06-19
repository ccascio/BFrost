import type { WorkerManifest } from '../../types';

export const anthropicProviderWorker: WorkerManifest = {
  manifestVersion: 1,
  bfrostApiVersion: '0.1',
  id: 'core.providers.anthropic',
  name: 'Anthropic Provider',
  displayName: 'Anthropic (cloud)',
  version: '0.1.0',
  description:
    'Serves Anthropic Claude chat models through the Anthropic HTTP API. Requires an API key.',
  tagline:
    'Use your Anthropic account to power BFrost. Bring an API key and pick any Claude model — no local install required.',
  chatPrompts: [
    {
      label: 'Anthropic health',
      description: 'Check whether the cloud provider is configured.',
      prompt: 'Is the Anthropic provider configured and available for chat?',
    },
  ],
  builtIn: true,
  kind: 'provider',
  requiredCredentials: [
    { key: 'anthropicConfigured', label: 'Anthropic API key', settingsTarget: 'system' },
  ],
  dashboard: {
    settings: [
      {
        id: 'credentials',
        label: 'API key',
        description: 'Your Anthropic API key — stored in your local .env file.',
        path: '/api/workers/providers-anthropic/credentials',
        fields: [
          {
            type: 'secret-reference' as const,
            key: 'apiKey',
            label: 'Anthropic API key',
            defaultValue: '',
            helpText: 'Starts with sk-ant-. Get one at console.anthropic.com.',
          },
        ],
      },
    ],
  },
  jobs: [],
  providers: [
    {
      id: 'anthropic',
      workerId: 'core.providers.anthropic',
      label: 'Anthropic',
      description: 'Anthropic Claude Messages API.',
      capabilities: {
        chat: true,
        embeddings: false,
        vision: false,
        localRuntime: false,
      },
      defaultModels: [
        {
          alias: 'claude-sonnet-4.6',
          id: 'claude-sonnet-4-6',
          label: 'Claude Sonnet 4.6',
        },
      ],
    },
  ],
};
