import type { WorkerManifest } from '../../types';
import { OpsDigestParamsSchema, DEFAULT_OPS_DIGEST_PARAMS, runOpsDigest } from './job';

export const opsDigestWorker: WorkerManifest = {
  manifestVersion: 1,
  bfrostApiVersion: '0.1',
  id: 'core.ops-digest',
  name: 'Ops Digest',
  displayName: 'Ops Digest',
  version: '0.1.0',
  description: 'Sends a periodic summary of all job execution history to your notification channel.',
  tagline:
    'Aggregates scheduler runs since the last digest, highlights errors and skipped jobs, and sends a concise report to Telegram (or whichever channel you have configured).',
  builtIn: true,
  deletable: true,
  dashboard: {
    routes: [],
  },
  jobs: [
    {
      id: 'ops-digest',
      workerId: 'core.ops-digest',
      label: 'Ops Digest',
      description:
        'Reads job run history since the last digest, formats a summary, and sends it to your configured notification channel.',
      defaultEnabled: false,
      defaultCron: '0 8 * * *',
      defaultModelAlias: '',
      approvalRequiredDefault: false,
      approvalRequiredEditable: false,
      defaultPrompt: '',
      prompt: { editable: false },
      paramsSchema: OpsDigestParamsSchema,
      defaultParams: DEFAULT_OPS_DIGEST_PARAMS,
      dashboardFields: [
        {
          key: 'notifyErrors',
          label: 'Highlight job errors',
          type: 'boolean',
          defaultValue: true,
          helpText: 'Flag runs that finished with an error in the digest summary.',
        },
        {
          key: 'notifySkipped',
          label: 'Highlight skipped runs',
          type: 'boolean',
          defaultValue: false,
          helpText: 'Flag runs that were skipped (e.g. nothing to produce) in the digest summary.',
        },
      ],
      presets: [
        {
          id: 'daily-morning',
          label: 'Daily morning digest',
          description: 'One summary every day at 8am, errors highlighted.',
          cron: '0 8 * * *',
          params: { notifyErrors: true, notifySkipped: false },
        },
        {
          id: 'weekly-monday',
          label: 'Weekly Monday digest',
          description: 'One summary every Monday at 8am covering the past week.',
          cron: '0 8 * * 1',
          params: { notifyErrors: true, notifySkipped: true },
        },
      ],
      run: (_modelId, params) => runOpsDigest(OpsDigestParamsSchema.parse(params ?? {})),
    },
  ],
};
