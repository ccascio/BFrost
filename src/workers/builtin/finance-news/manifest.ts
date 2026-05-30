import {
  DEFAULT_WATCHLIST,
  DEFAULT_FINANCE_NEWS_PARAMS,
  DEFAULT_RELEVANCE_PROMPT,
  FinanceNewsParamsSchema,
  FINANCE_CATEGORIES,
  INVESTOR_LENSES,
  runFinanceNewsScan,
} from './job';
import type { WorkerManifest } from '../../types';

const CATEGORY_SUGGESTIONS = FINANCE_CATEGORIES.map((c) => c.value);

export const financeNewsWorker: WorkerManifest = {
  id: 'core.finance-news',
  name: 'Finance News',
  displayName: 'Finance News Watch',
  version: '0.1.0',
  description: 'Scans the web for developments on a watchlist of tickers/companies and queues finance.news items.',
  tagline:
    'Follows the companies and themes you care about, optionally has the AI keep only what is materially relevant, and can ping your channel when something matters. Informational only — never trading advice.',
  chatPrompts: [
    {
      label: 'Scan watchlist',
      description: 'Run the finance news intake job now.',
      prompt: 'Run the finance news scan now and summarize any new watchlist items.',
    },
    {
      label: 'Latest finance news',
      description: 'Review queued finance.news items.',
      prompt: 'Show me the latest finance news items in the queue.',
    },
  ],
  builtIn: true,
  deletable: true,
  requiredDependencies: [
    { key: 'googleSearchConfigured', label: 'Google Web Search', settingsTarget: 'config' },
  ],
  dashboard: {
    routes: [
      {
        id: 'finance-news-dashboard',
        label: 'Finance News Watch',
        description: 'Review the latest finance scan status, queued articles, and run guidance.',
        path: '/api/dashboard#workerData.core.finance-news',
      },
    ],
  },
  ownedSettings: [
    {
      key: 'finance-news-job',
      label: 'Finance news schedule',
      description: 'Cron, model, relevance prompt, and scan parameters for the finance news job.',
      scope: 'job',
      storageKey: 'admin.settings.jobs.finance-news-scan',
      dashboardTarget: 'jobs',
    },
  ],
  jobs: [
    {
      id: 'finance-news-scan',
      workerId: 'core.finance-news',
      label: 'Finance News Scan',
      description: 'Searches each watchlist name, optionally filters for relevance with AI, and queues finance.news items.',
      defaultEnabled: false,
      defaultCron: '0 7,13,19 * * 1-5',
      defaultModelAlias: '',
      approvalRequiredDefault: false,
      approvalRequiredEditable: false,
      defaultPrompt: DEFAULT_RELEVANCE_PROMPT,
      prompt: {
        editable: true,
        helpText:
          'These instructions tell the AI how to judge whether a finance article is materially relevant. Applies only when "Filter for relevance with AI" is on. Keep it about relevance — not buy/sell advice.',
        examples: [
          {
            label: 'Strict relevance (default)',
            description: 'Keeps only real developments; drops recaps and noise.',
            value: DEFAULT_RELEVANCE_PROMPT,
          },
          {
            label: 'Catalysts only',
            description: 'Keeps only hard, datable catalysts (earnings, M&A, ratings, guidance).',
            value: `You are a financial-news relevance filter for a catalyst-driven trader.

Keep an article ONLY if it reports a concrete, datable catalyst: an earnings/guidance release, an analyst rating or price-target change, a merger/acquisition, a regulatory or legal action, or a dividend/buyback decision. Drop opinion pieces, recaps, generic market wraps, and price-movement-only stories.

Never invent URLs. Do not give buy/sell advice — only judge relevance and say in one short sentence what the catalyst is.`,
          },
          {
            label: 'Risk watch',
            description: 'Keeps negative catalysts and risk signals.',
            value: `You are a financial-news relevance filter focused on downside risk.

Keep an article if it reports a negative or risk-raising development: a guidance cut, an earnings miss, a downgrade, an accounting/fraud concern, litigation/regulatory action, debt or liquidity stress, or executive departures. Drop routine positive PR and generic coverage.

Never invent URLs. Do not give buy/sell advice — only judge relevance and state the risk in one short sentence.`,
          },
        ],
      },
      paramsSchema: FinanceNewsParamsSchema,
      defaultParams: DEFAULT_FINANCE_NEWS_PARAMS,
      dashboardFields: [
        {
          key: 'watchlist',
          label: 'Watchlist (tickers or company names)',
          type: 'string-list',
          defaultValue: DEFAULT_WATCHLIST,
          rows: 5,
          placeholder: 'e.g. AAPL, or Apple, or Federal Reserve',
          suggestions: ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'Federal Reserve', 'S&P 500'],
          helpText: 'Each name is searched on its own. Use the ticker, the company name, or a theme — whatever you would type into a news search.',
        },
        {
          key: 'categories',
          label: 'News categories to search',
          type: 'string-list',
          defaultValue: DEFAULT_FINANCE_NEWS_PARAMS.categories,
          rows: 4,
          suggestions: [...CATEGORY_SUGGESTIONS],
          helpText: `Keyword groups added to each search. Choose from: ${FINANCE_CATEGORIES.map((c) => `${c.value} (${c.label})`).join(', ')}.`,
        },
        {
          key: 'investorLens',
          label: 'Investor lens',
          type: 'select',
          defaultValue: DEFAULT_FINANCE_NEWS_PARAMS.investorLens,
          options: INVESTOR_LENSES.map((l) => ({ value: l.value, label: l.label })),
          helpText: 'Tunes how the AI relevance pass frames "material" for you. Does not gate anything when the relevance filter is off.',
        },
        {
          key: 'maxResultsPerName',
          label: 'Articles to check per name',
          type: 'number',
          defaultValue: DEFAULT_FINANCE_NEWS_PARAMS.maxResultsPerName,
          min: 1,
          max: 20,
          helpText: 'Higher discovers more but uses more of your Google search quota and runs slower.',
        },
        {
          key: 'maxItems',
          label: 'Max items to queue per run',
          type: 'number',
          defaultValue: DEFAULT_FINANCE_NEWS_PARAMS.maxItems,
          min: 1,
          max: 40,
        },
        {
          key: 'seenTtlHours',
          label: 'Avoid repeats for (hours)',
          type: 'number',
          defaultValue: DEFAULT_FINANCE_NEWS_PARAMS.seenTtlHours,
          min: 1,
          max: 168,
          helpText: 'How long to remember already-queued articles so they are not re-published.',
        },
        {
          key: 'dateRestrict',
          label: 'Search window',
          type: 'select',
          defaultValue: DEFAULT_FINANCE_NEWS_PARAMS.dateRestrict,
          options: [
            { label: 'Past day', value: 'd1' },
            { label: 'Past week', value: 'w1' },
            { label: 'Past month', value: 'm1' },
          ],
        },
        {
          key: 'relevanceFilter',
          label: 'Filter for relevance with AI',
          type: 'boolean',
          defaultValue: DEFAULT_FINANCE_NEWS_PARAMS.relevanceFilter,
          helpText: 'When on, the AI reads each article (using the editable prompt above) and keeps only what is materially relevant.',
        },
        {
          key: 'notifyOnRelevant',
          label: 'Notify my channel when relevant items are found',
          type: 'boolean',
          defaultValue: DEFAULT_FINANCE_NEWS_PARAMS.notifyOnRelevant,
          helpText: 'Sends a short summary to your primary channel (Telegram / Discord / email) at the end of a run that produced items.',
        },
      ],
      presets: [
        {
          id: 'watchlist-intraday',
          label: 'Watchlist, three times a day',
          description: 'Scans your watchlist morning, midday, and evening on weekdays. AI relevance filter on.',
          cron: '0 7,13,19 * * 1-5',
          params: {
            ...DEFAULT_FINANCE_NEWS_PARAMS,
            categories: ['earnings', 'ratings', 'ma', 'regulatory'],
            relevanceFilter: true,
            notifyOnRelevant: true,
          },
        },
        {
          id: 'morning-brief',
          label: 'Morning brief only',
          description: 'One scan at 7am weekdays over the past day, AI-filtered, with a channel ping.',
          cron: '0 7 * * 1-5',
          params: {
            ...DEFAULT_FINANCE_NEWS_PARAMS,
            dateRestrict: 'd1',
            relevanceFilter: true,
            notifyOnRelevant: true,
          },
        },
      ],
      run: (modelId, params) => runFinanceNewsScan(modelId, FinanceNewsParamsSchema.parse(params ?? {})),
    },
  ],
  summarizeForAssistant(item) {
    const title = safeStr(item['title']) || 'Untitled';
    const shortDesc = safeStr(item['shortDesc']);
    const payload = item['payload'];
    const tickers =
      payload && typeof payload === 'object' && Array.isArray((payload as Record<string, unknown>)['tickers'])
        ? ((payload as Record<string, unknown>)['tickers'] as unknown[]).filter((t): t is string => typeof t === 'string')
        : [];
    const meta = ['from core.finance-news', 'finance.news', ...(tickers.length ? [tickers.slice(0, 3).join(', ')] : [])];
    const parts = [`"${title}"`, `(${meta.join(' · ')})`];
    if (shortDesc) parts.push(`— ${shortDesc.slice(0, 120)}${shortDesc.length > 120 ? '…' : ''}`);
    return parts.join(' ');
  },
};

function safeStr(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
