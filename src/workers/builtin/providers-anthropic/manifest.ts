import type { WorkerManifest } from '../../types';

export const anthropicProviderWorker: WorkerManifest = {
  manifestVersion: 1,
  bfrostApiVersion: '0.1',
  id: 'core.providers.anthropic',
  name: 'Anthropic Provider',
  displayName: 'Anthropic (cloud)',
  version: '0.1.0',
  description:
    'Serves Anthropic Claude chat models through either the Anthropic API or a Claude subscription login.',
  tagline:
    'Use your Anthropic account to power BFrost. Choose API billing with an API key, or subscription access through Claude login.',
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
    { key: 'anthropicConfigured', label: 'Anthropic provider access', settingsTarget: 'system' },
  ],
  dashboard: {
    settings: [],
  },
  jobs: [],
  providers: [
    {
      id: 'anthropic',
      workerId: 'core.providers.anthropic',
      label: 'Anthropic',
      description: 'Anthropic API or Claude subscription login.',
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
