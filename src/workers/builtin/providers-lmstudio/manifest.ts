import type { WorkerManifest } from '../../types';

export const lmStudioProviderWorker: WorkerManifest = {
  manifestVersion: 1,
  bfrostApiVersion: '0.1',
  id: 'core.providers.lmstudio',
  name: 'LM Studio Provider',
  version: '0.1.0',
  description:
    'Runs and serves local OpenAI-compatible chat models through the LM Studio CLI and HTTP server.',
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
        embeddings: false,
        vision: false,
        localRuntime: true,
      },
    },
  ],
};
