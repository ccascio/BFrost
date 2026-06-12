import type { WorkerManifest } from '../../types';

export const demoProviderWorker: WorkerManifest = {
  manifestVersion: 1,
  bfrostApiVersion: '0.1',
  id: 'core.providers.demo',
  name: 'Demo Provider',
  displayName: 'Demo Brain (no API key)',
  version: '0.1.0',
  description:
    'Always-configured demo language model — returns plausible canned text with no credentials required.',
  tagline:
    'A zero-credential stand-in model. Select "Demo Brain" in the model picker to run scheduled jobs without any API key or local model install. Delete this worker when you configure a real provider.',
  builtIn: true,
  kind: 'provider',
  jobs: [],
  providers: [
    {
      id: 'demo',
      workerId: 'core.providers.demo',
      label: 'Demo Brain',
      description: 'A canned language model that always responds — no credentials needed.',
      capabilities: {
        chat: true,
        embeddings: false,
        vision: false,
        localRuntime: false,
      },
    },
  ],
};
