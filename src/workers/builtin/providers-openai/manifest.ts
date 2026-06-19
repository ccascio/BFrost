import type { WorkerManifest } from '../../types';

export const openaiProviderWorker: WorkerManifest = {
  manifestVersion: 1,
  bfrostApiVersion: '0.1',
  id: 'core.providers.openai',
  name: 'OpenAI Provider',
  displayName: 'OpenAI (cloud)',
  version: '0.1.0',
  description:
    'Serves OpenAI chat models (GPT family) through the OpenAI HTTP API. Requires an API key.',
  tagline:
    'Use your OpenAI account to power BFrost. Bring an API key and pick any GPT model — no local install required.',
  chatPrompts: [
    {
      label: 'OpenAI health',
      description: 'Check whether the cloud provider is configured.',
      prompt: 'Is the OpenAI provider configured and available for chat?',
    },
  ],
  builtIn: true,
  kind: 'provider',
  requiredCredentials: [
    { key: 'openaiConfigured', label: 'OpenAI API key', settingsTarget: 'system' },
  ],
  dashboard: {
    settings: [
      {
        id: 'credentials',
        label: 'API key',
        description: 'Your OpenAI API key — stored in your local .env file.',
        path: '/api/workers/providers-openai/credentials',
        fields: [
          {
            type: 'secret-reference' as const,
            key: 'apiKey',
            label: 'OpenAI API key',
            defaultValue: '',
            helpText: 'Starts with sk-. Get one at platform.openai.com.',
          },
        ],
      },
    ],
  },
  jobs: [],
  providers: [
    {
      id: 'openai',
      workerId: 'core.providers.openai',
      label: 'OpenAI',
      description: 'OpenAI Chat Completions API.',
      capabilities: {
        chat: true,
        embeddings: true,
        vision: false,
        localRuntime: false,
      },
      defaultModels: [
        {
          alias: 'gpt-5.5',
          id: 'gpt-5.5',
          label: 'GPT-5.5',
        },
        {
          alias: 'gpt-5.4-mini',
          id: 'gpt-5.4-mini',
          label: 'GPT-5.4 mini',
        },
      ],
    },
  ],
};
