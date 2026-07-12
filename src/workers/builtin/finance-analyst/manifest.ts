import {
  DEFAULT_FINANCE_ANALYSIS_PARAMS,
  DEFAULT_ANALYSIS_PROMPT,
  FinanceAnalysisParamsSchema,
  INVESTOR_LENSES,
  RISK_TOLERANCES,
  hasFinanceAnalysisWork,
  runFinanceAnalysis,
} from './job';
import type { WorkerManifest } from '../../types';

export const financeAnalystWorker: WorkerManifest = {
  id: 'core.finance-analyst',
  name: 'Finance Analyst',
  displayName: 'Finance Analyst',
  version: '0.1.0',
  description: 'Reads finance.news items and attaches advice plus a practical non-trading research priority for each verified target.',
  tagline:
    'Turns verified watchlist news into grounded advice plus a practical research priority: act on research, watch, no action, or insufficient evidence.',
  chatPrompts: [
    {
      label: 'Analyze finance news',
      description: 'Run analysis for pending finance.news items.',
      prompt: 'Analyze pending finance news now and summarize the BUY, HOLD, or SELL recommendations.',
    },
    {
      label: 'Latest recommendations',
      description: 'Review recent finance research priorities.',
      prompt: 'Show me the latest finance analyst priorities with catalyst, evidence, confidence, risks, and next check.',
    },
  ],
  builtIn: true,
  deletable: true,
  dashboard: {
    routes: [
      {
        id: 'finance-analyst-dashboard',
        label: 'Finance Analyst',
        description: 'Review finance.news recommendations, pending work, and recent analysis runs.',
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
      description: 'Analyses unhandled finance.news items and annotates each target with structured investment advice.',
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
          'Instructions for how the AI should turn each finance news item into grounded advice and a separate non-trading research priority. The output contract always requires both for every verified target.',
        examples: [
          {
            label: 'Decisive analyst (default)',
            description: 'Grounded advice with a practical research priority instead of defaulting to HOLD.',
            value: DEFAULT_ANALYSIS_PROMPT,
          },
          {
            label: 'Mechanism-first',
            description: 'Gives advice after tracing the causal chain from the news to the share price.',
            value: `You are an investment analyst. Give a BUY, HOLD, or SELL recommendation and a separate research priority for every target after explaining the causal mechanism: what specifically changed, which line item or driver it affects, and how that transmits to the share price.

Ground factual claims in the supplied input. Be explicit about catalyst, evidence, second-order effects, risks, and what evidence would change the recommendation. Use attention to say whether the operator should investigate now, watch, take no further research action, or treat the article as insufficient evidence.`,
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
          key: 'riskTolerance',
          label: 'Risk tolerance',
          type: 'select',
          defaultValue: DEFAULT_FINANCE_ANALYSIS_PARAMS.riskTolerance,
          options: RISK_TOLERANCES.map((entry) => ({ value: entry.value, label: entry.label })),
          helpText: 'Calibrates how much uncertainty and downside the recommendation may accept.',
        },
        {
          key: 'portfolioContext',
          label: 'Portfolio context',
          type: 'textarea',
          defaultValue: DEFAULT_FINANCE_ANALYSIS_PARAMS.portfolioContext,
          rows: 5,
          placeholder: 'Optional: current holdings, cost basis, target horizon, position limits, or constraints.',
          helpText: 'Passed to the analyst with every run so advice can reflect your actual exposure and constraints.',
        },
        {
          key: 'notifyOnAnalysis',
          label: 'Send the advice to my channel',
          type: 'boolean',
          defaultValue: DEFAULT_FINANCE_ANALYSIS_PARAMS.notifyOnAnalysis,
          helpText: 'Delivers a compact digest of the recommendations to your primary channel (Telegram / Discord / email).',
        },
      ],
      hasWork: () => hasFinanceAnalysisWork(),
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
    const recommendation = read ? safeStr(read['recommendation']) : '';
    const meta = [
      'from core.finance-analyst',
      'finance.news',
      ...(recommendation ? [`advice: ${recommendation}`] : dir ? [`legacy read: ${dir}`] : ['no advice yet']),
    ];
    return `"${title}" (${meta.join(' · ')})`;
  },
};

function safeStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
