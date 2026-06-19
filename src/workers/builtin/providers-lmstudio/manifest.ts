import type { WorkerManifest } from '../../types';

export const lmStudioProviderWorker: WorkerManifest = {
  manifestVersion: 1,
  bfrostApiVersion: '0.1',
  id: 'core.providers.lmstudio',
  name: 'LM Studio Provider',
  displayName: 'LM Studio (local AI)',
  version: '0.1.0',
  description:
    'Runs and serves local OpenAI-compatible chat models through the LM Studio CLI and HTTP server.',
  tagline: 'Runs AI models on your own computer through LM Studio — no API keys, no monthly bill, your data never leaves the machine.',
  chatPrompts: [
    {
      label: 'Model status',
      description: 'Check the local runtime and loaded models.',
      prompt: 'Is LM Studio running, and what local models are loaded?',
    },
  ],
  builtIn: true,
  kind: 'provider',
  requiredDependencies: [
    { key: 'lmStudioCli', label: 'LM Studio CLI binary', settingsTarget: 'health-dependencies' },
  ],
  jobs: [],
  providers: [
    {
      id: 'lmstudio',
      workerId: 'core.providers.lmstudio',
      label: 'LM Studio',
      description: 'Local OpenAI-compatible chat model server managed by the LM Studio CLI.',
      capabilities: {
        chat: true,
        embeddings: true,
        vision: false,
        localRuntime: true,
      },
    },
  ],
  dashboard: {
    settings: [],
    routes: [
      {
        id: 'lmstudio-runtime',
        label: 'Runtime controls',
        description: 'Start, stop, load and unload LM Studio models.',
      },
    ],
  },
};
