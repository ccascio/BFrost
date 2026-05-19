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
  builtIn: true,
  kind: 'provider',
  requiredCredentials: [
    { key: 'openaiConfigured', label: 'OpenAI API key', settingsTarget: 'system' },
  ],
  jobs: [],
  providers: [
    {
      id: 'openai',
      workerId: 'core.providers.openai',
      label: 'OpenAI',
      description: 'OpenAI Chat Completions API.',
      capabilities: {
        chat: true,
        embeddings: false,
        vision: false,
        localRuntime: false,
      },
    },
  ],
};
