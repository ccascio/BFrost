import {
  DEFAULT_FINANCE_ANALYSIS_PARAMS,
  DEFAULT_ANALYSIS_PROMPT,
  FinanceAnalysisParamsSchema,
  INVESTOR_LENSES,
  runFinanceAnalysis,
} from './job';
import type { WorkerManifest } from '../../types';

export const financeAnalystWorker: WorkerManifest = {
  id: 'core.finance-analyst',
  name: 'Finance Analyst',
  displayName: 'Finance Analyst',
  version: '0.1.0',
  description: 'Reads finance.news items and attaches a structured, informational read of the likely market impact.',
  tagline:
    'Reads the finance news collected for your watchlist and writes a short, sober take on each — likely direction, size, horizon, confidence, and whether it is already priced in. Informational only, never buy/sell advice.',
  builtIn: true,
  deletable: true,
  dashboard: {
    routes: [
      {
        id: 'finance-analyst-dashboard',
        label: 'Finance Analyst',
        description: 'Review analysed finance.news items, pending work, and recent analysis runs.',
        path: '/api/dashboard#workerData.core.finance-analyst',
      },
    ],
  },
  ownedSettings: [
    {
      key: 'finance-analysis-job',
      label: 'Finance analysis schedule',
      description: 'Cron, model, analysis prompt, and parameters for the finance analyst job.',
      scope: 'job',
      storageKey: 'admin.settings.jobs.finance-analysis',
      dashboardTarget: 'jobs',
    },
  ],
  jobs: [
    {
      id: 'finance-analysis',
      workerId: 'core.finance-analyst',
      label: 'Finance Analysis',
      description: 'Analyses unhandled finance.news items and annotates each with a structured impact read.',
      defaultEnabled: false,
      // Runs shortly after the finance-news scan presets so fresh items get a read.
      defaultCron: '20 7,13,19 * * 1-5',
      defaultModelAlias: '',
      approvalRequiredDefault: false,
      approvalRequiredEditable: false,
      defaultPrompt: DEFAULT_ANALYSIS_PROMPT,
      prompt: {
        editable: true,
        helpText:
          'Instructions for how the AI should read each finance news item. Keep it informational — the worker is designed to characterise impact and uncertainty, not to give buy/sell advice.',
        examples: [
          {
            label: 'Sober analyst (default)',
            description: 'Balanced, uncertainty-aware read grounded in the article.',
            value: DEFAULT_ANALYSIS_PROMPT,
          },
          {
            label: 'Mechanism-first',
            description: 'Emphasises the causal chain from the news to the share price.',
            value: `You are a financial analyst. For each item, explain the causal mechanism first: what specifically changed, which line item or driver it affects, and how that transmits to the share price.

Ground every claim in the provided article text only. Be explicit about second-order effects and what is uncertain. Do NOT give buy/sell/hold advice — characterise the likely reaction and the mechanism only.`,
          },
        ],
      },
      paramsSchema: FinanceAnalysisParamsSchema,
      defaultParams: DEFAULT_FINANCE_ANALYSIS_PARAMS,
      dashboardFields: [
        {
          key: 'maxItems',
          label: 'Items to analyse per run',
          type: 'number',
          defaultValue: DEFAULT_FINANCE_ANALYSIS_PARAMS.maxItems,
          min: 1,
          max: 25,
          helpText: 'The most recent unhandled finance.news items are analysed first.',
        },
        {
          key: 'investorLens',
          label: 'Investor lens',
          type: 'select',
          defaultValue: DEFAULT_FINANCE_ANALYSIS_PARAMS.investorLens,
          options: INVESTOR_LENSES.map((l) => ({ value: l.value, label: l.label })),
          helpText: 'Tilts the read toward what matters for your style. Does not change the facts, only the emphasis.',
        },
        {
          key: 'notifyOnAnalysis',
          label: 'Send the reads to my channel',
          type: 'boolean',
          defaultValue: DEFAULT_FINANCE_ANALYSIS_PARAMS.notifyOnAnalysis,
          helpText: 'Delivers a compact digest of the reads to your primary channel (Telegram / Discord / email).',
        },
      ],
      run: (modelId, params) => runFinanceAnalysis(modelId, FinanceAnalysisParamsSchema.parse(params ?? {})),
    },
  ],
  summarizeForAssistant(item) {
    const title = safeStr(item['title']) || 'Untitled';
    const metadata = item['metadata'];
    const read =
      metadata && typeof metadata === 'object' && 'core.finance-analyst' in metadata
        ? (metadata as Record<string, Record<string, unknown>>)['core.finance-analyst']
        : undefined;
    const dir = read ? safeStr(read['direction']) : '';
    const meta = ['from core.finance-analyst', 'finance.news', ...(dir ? [`read: ${dir}`] : ['no read yet'])];
    return `"${title}" (${meta.join(' · ')})`;
  },
};

function safeStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
