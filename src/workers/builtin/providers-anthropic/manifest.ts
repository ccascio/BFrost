import type { WorkerManifest } from '../../types';

export const anthropicProviderWorker: WorkerManifest = {
  manifestVersion: 1,
  bfrostApiVersion: '0.1',
  id: 'core.providers.anthropic',
  name: 'Anthropic Provider',
  displayName: 'Anthropic (cloud)',
  version: '0.1.0',
  description:
    'Serves Anthropic Claude chat models through either the Anthropic API or a local Claude CLI logged into a Claude subscription.',
  tagline:
    'Use your Anthropic account to power BFrost. Choose API billing with an API key, or subscription access through the Claude CLI.',
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
    settings: [
      {
        id: 'credentials',
        label: 'Provider access',
        description:
          'Choose Anthropic API key billing or Claude subscription access through the local Claude CLI. API keys are stored in your local .env file.',
        path: '/api/workers/providers-anthropic/credentials',
        fields: [
          {
            type: 'select' as const,
            key: 'authMode',
            label: 'Access mode',
            defaultValue: 'api',
            seedPath: 'core.providers.anthropic.authMode',
            options: [
              { label: 'Anthropic API key', value: 'api' },
              { label: 'Claude subscription via Claude CLI', value: 'subscription' },
            ],
            helpText:
              'Claude subscriptions do not include direct API usage. Subscription mode uses your local Claude CLI login instead of the API.',
          },
          {
            type: 'secret-reference' as const,
            key: 'apiKey',
            label: 'Anthropic API key',
            defaultValue: '',
            helpText: 'Required for API-key mode. Starts with sk-ant-. Leave blank to keep the current key.',
          },
          {
            type: 'text' as const,
            key: 'claudeCliPath',
            label: 'Claude CLI command',
            defaultValue: 'claude',
            seedPath: 'core.providers.anthropic.claudeCliPath',
            helpText: 'Used only in subscription mode. The CLI must be logged in with `claude auth`.',
          },
          {
            type: 'text' as const,
            key: 'claudeCliModel',
            label: 'Claude CLI model',
            defaultValue: 'sonnet',
            seedPath: 'core.providers.anthropic.claudeCliModel',
            helpText: 'Used only in subscription mode. Pick an alias or model your Claude subscription can access.',
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
      description: 'Anthropic API or Claude subscription via Claude CLI.',
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
