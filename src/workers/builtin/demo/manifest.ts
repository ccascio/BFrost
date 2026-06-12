import type { WorkerManifest } from '../../types';

// The demo worker is the platform's first-run "wow": it contributes an onboarding action
// (the generic CTA the core renders on the wizard welcome step and the overview empty state)
// that runs a self-contained sample pipeline with zero configuration. Because it is a normal
// worker, deleting or disabling it removes the CTA — no core change.
export const demoWorker: WorkerManifest = {
  manifestVersion: 1,
  bfrostApiVersion: '0.1',
  id: 'core.demo',
  name: 'Demo',
  displayName: 'Demo (no setup)',
  version: '0.1.0',
  description: 'Zero-config demo: runs a sample news → research pipeline on the Item Bus with no credentials.',
  tagline:
    'See BFrost work in one click — no API key, no model. Publishes a few sample articles and a synthesized research note so you can watch the pipeline run before configuring anything. Disable or delete it once you have your own workers set up.',
  chatPrompts: [
    {
      label: 'Run the demo',
      description: 'Trigger the zero-config sample pipeline now.',
      prompt: 'Run the demo pipeline and tell me what it queued.',
    },
  ],
  builtIn: true,
  deletable: true,
  demoNotice:
    'Demo mode is on — sample data is being produced so you can explore BFrost without any setup. Delete this worker once your own workers are configured.',
  onboarding: {
    id: 'try-demo',
    title: '▶ Try the live demo — no setup',
    description: 'Run a sample news → research pipeline now. No API key or model required — see results in seconds.',
    // Hits the worker's own route, not the job runner, so it works with zero providers configured.
    endpoint: '/api/workers/demo/run',
    priority: 0,
  },
  dashboard: {
    routes: [
      {
        id: 'demo-run-output',
        label: 'Demo output',
        description: 'The sample items and research note from the last demo run.',
        tab: 'queue',
        path: '/api/dashboard#workerData.core.demo',
      },
    ],
  },
  // Endpoint-only worker: the onboarding CTA hits the worker's own route, so there is no
  // schedulable job to fail with "no provider configured" on a worker called "no setup".
  jobs: [],
};
