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
  builtIn: true,
  kind: 'provider',
  requiredCredentials: [
    { key: 'anthropicConfigured', label: 'Anthropic API key', settingsTarget: 'system' },
  ],
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
    },
  ],
};
