import type { WorkerManifest } from '../../types';

export const openaiProviderWorker: WorkerManifest = {
  manifestVersion: 1,
  bfrostApiVersion: '0.1',
  id: 'core.providers.openai',
  name: 'OpenAI Provider',
  displayName: 'OpenAI (cloud)',
  version: '0.1.0',
  description:
    'Serves OpenAI chat models through either the OpenAI API or a local Codex ChatGPT subscription login.',
  tagline:
    'Use your OpenAI account to power BFrost. Choose API billing with an API key, or subscription access through your local Codex login.',
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
    { key: 'openaiConfigured', label: 'OpenAI provider access', settingsTarget: 'system' },
  ],
  dashboard: {
    settings: [],
  },
  jobs: [],
  providers: [
    {
      id: 'openai',
      workerId: 'core.providers.openai',
      label: 'OpenAI',
      description: 'OpenAI API or ChatGPT subscription through Codex OAuth.',
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
