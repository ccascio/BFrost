import { z } from 'zod';
import { generateText } from 'ai';
import { config, findModel, type ModelOption } from '../../../config';
import { getChatModel } from '../../../llm';
import { searchGoogle, type SearchResult } from '../search-google/module';
import { fetchArticle } from '../article-fetch/module';
import { publishItem } from '../../../jobs/item-bus';
import { loadKvJson, saveKvJson } from '../../../sqlite';
import { recordEventSafe } from '../../../event-log';

/**
 * Finance-news producer. Searches the web (via the Google search worker) for
 * developments on a user-defined watchlist, optionally runs an LLM relevance
 * pass with an editable prompt, publishes `finance.news` items to the Item Bus
 * for downstream consumers (e.g. an analysis agent), and can notify the
 * operator's channels when relevant items are found.
 *
 * This worker is deliberately a *filter + alert*, not an oracle: the LLM pass
 * decides relevance and writes a short "why it matters" note. The deeper
 * "likely effect on the name" reasoning belongs to a separate consumer worker.
 */

export const FINANCE_NEWS_ITEM_TYPE = 'finance.news';

const STATE_STORE_KEY = 'finance-news.state';
const ADMIN_SETTINGS_STORE_KEY = 'admin.settings';
const JOB_ID = 'finance-news-scan';

const ARTICLE_FETCH_CONCURRENCY = 4;
const LLM_EXCERPT_CHARS = 1_000; // per the authoring guide: cap excerpts so the prompt fits the context window
const ARTICLE_FETCH_CHARS = 4_000; // full text kept in payload for downstream consumers

/** News categories. Each maps to a group of search keywords OR'd into the query. */
export const FINANCE_CATEGORIES = [
  { value: 'earnings', label: 'Earnings & guidance', keywords: ['earnings', 'guidance', 'results', 'revenue', 'EPS'] },
  { value: 'ratings', label: 'Analyst ratings', keywords: ['upgrade', 'downgrade', 'price target', 'analyst', 'initiated'] },
  { value: 'ma', label: 'M&A', keywords: ['merger', 'acquisition', 'takeover', 'acquire', 'deal'] },
  { value: 'regulatory', label: 'Regulatory & legal', keywords: ['lawsuit', 'investigation', 'SEC', 'antitrust', 'probe'] },
  { value: 'insider', label: 'Insider & management', keywords: ['insider', 'stake', 'CEO', 'resign', 'appoint'] },
  { value: 'macro', label: 'Macro & rates', keywords: ['Federal Reserve', 'interest rate', 'inflation', 'tariff'] },
  { value: 'dividend', label: 'Dividends & buybacks', keywords: ['dividend', 'buyback', 'repurchase', 'payout'] },
  { value: 'product', label: 'Product & operations', keywords: ['launch', 'partnership', 'contract', 'recall'] },
] as const;

const CATEGORY_VALUES = FINANCE_CATEGORIES.map((c) => c.value);

/** Investor lens — tunes how the relevance pass frames "material" for this user. */
export const INVESTOR_LENSES = [
  { value: 'none', label: 'No lens (general relevance)' },
  { value: 'long-value', label: 'Long-term / value' },
  { value: 'swing-momentum', label: 'Swing / momentum' },
  { value: 'short-seller', label: 'Short seller' },
  { value: 'income', label: 'Income / dividend' },
  { value: 'macro', label: 'Macro / thematic' },
] as const;

const LENS_FRAMING: Record<string, string> = {
  'none': 'Judge whether each item is materially relevant to an investor following these names.',
  'long-value':
    'Prioritise durable, fundamental developments (earnings quality, guidance, competitive position, management). Downweight short-term noise.',
  'swing-momentum':
    'Prioritise near-term catalysts that could move the price within days (earnings surprises, upgrades/downgrades, M&A, guidance changes).',
  'short-seller':
    'Prioritise negative catalysts and risks (guidance cuts, accounting/fraud concerns, downgrades, debt, regulatory). Note any short-squeeze risk.',
  'income':
    'Prioritise developments affecting dividend safety and capital return (payout changes, buybacks, cash flow, leverage).',
  'macro':
    'Prioritise macro and sector developments (rates, inflation, policy) and how they bear on these names.',
};

export const DEFAULT_WATCHLIST = ['AAPL', 'NVDA', 'Federal Reserve'];

export const DEFAULT_RELEVANCE_PROMPT = `You are a financial-news relevance filter working for an investor.

For each article, decide whether it is *materially relevant* — i.e. a real development that a holder of these names would want to know about — versus noise (recaps, listicles, generic market wraps, ads, or stale repeats).

Be strict: when in doubt, mark it not relevant. Never invent URLs; only use URLs present verbatim in the input. Do not give buy/sell advice — only judge relevance and state in one short sentence why it could matter.`;

export const FinanceNewsParamsSchema = z.object({
  watchlist: z.array(z.string().min(1)).min(1).catch(DEFAULT_WATCHLIST),
  categories: z.array(z.enum(CATEGORY_VALUES as [string, ...string[]])).min(1).catch([...CATEGORY_VALUES]),
  maxResultsPerName: z.number().int().min(1).max(20).catch(8),
  maxItems: z.number().int().min(1).max(40).catch(12),
  seenTtlHours: z.number().int().min(1).max(168).catch(48),
  dateRestrict: z.string().min(1).catch('d1'),
  investorLens: z.enum(INVESTOR_LENSES.map((l) => l.value) as [string, ...string[]]).catch('none'),
  relevanceFilter: z.boolean().catch(true),
  notifyOnRelevant: z.boolean().catch(false),
});
export type FinanceNewsParams = z.infer<typeof FinanceNewsParamsSchema>;
export const DEFAULT_FINANCE_NEWS_PARAMS: FinanceNewsParams = FinanceNewsParamsSchema.parse({});

interface State {
  lastRunAt: string | null;
  seenUrls: Record<string, string>;
}

async function loadState(): Promise<State> {
  const stored = await loadKvJson<Partial<State>>(STATE_STORE_KEY);
  return {
    lastRunAt: typeof stored?.lastRunAt === 'string' ? stored.lastRunAt : null,
    seenUrls: stored?.seenUrls && typeof stored.seenUrls === 'object' ? stored.seenUrls : {},
  };
}

async function saveState(state: State): Promise<void> {
  await saveKvJson(STATE_STORE_KEY, state);
}

function pruneSeen(seen: Record<string, string>, nowMs: number, ttlMs: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [url, ts] of Object.entries(seen)) {
    const tsMs = Date.parse(ts);
    if (!Number.isNaN(tsMs) && nowMs - tsMs < ttlMs) out[url] = ts;
  }
  return out;
}

interface StoredAdminSettings {
  jobs?: Record<string, { prompt?: string }>;
}

/** Operator-edited relevance prompt (Jobs panel) falls back to the default. */
async function loadRelevancePrompt(): Promise<string> {
  const stored = await loadKvJson<StoredAdminSettings>(ADMIN_SETTINGS_STORE_KEY);
  const prompt = stored?.jobs?.[JOB_ID]?.prompt;
  return typeof prompt === 'string' && prompt.trim() ? prompt : DEFAULT_RELEVANCE_PROMPT;
}

/** Build one search query per watchlist name, OR-ing the selected category keywords. */
export function buildQueries(watchlist: string[], categories: string[]): { name: string; query: string }[] {
  const cats = FINANCE_CATEGORIES.filter((c) => categories.includes(c.value));
  const keywords = [...new Set(cats.flatMap((c) => c.keywords))].slice(0, 12);
  const orGroup = keywords.length ? ` (${keywords.join(' OR ')})` : '';
  return watchlist.map((name) => ({ name, query: `"${name}"${orGroup}` }));
}

/** Best-effort category tag from the result text. */
export function tagCategory(text: string): string {
  const lower = text.toLowerCase();
  for (const cat of FINANCE_CATEGORIES) {
    if (cat.keywords.some((kw) => lower.includes(kw.toLowerCase()))) return cat.value;
  }
  return 'general';
}

/** Watchlist names mentioned in the text, plus the name that produced the query. */
export function matchTickers(text: string, watchlist: string[], producedBy: string): string[] {
  const lower = text.toLowerCase();
  const hits = watchlist.filter((n) => lower.includes(n.toLowerCase()));
  return [...new Set([producedBy, ...hits])];
}

function extractJsonArray(text: string): unknown {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) throw new Error('No JSON array found in LLM output');
  return JSON.parse(text.slice(start, end + 1));
}

const RelevanceDecisionSchema = z.object({
  url: z.string().url(),
  relevant: z.boolean(),
  reason: z.string().min(1).max(240),
});
const RelevanceArraySchema = z.array(RelevanceDecisionSchema);
export type RelevanceDecision = z.infer<typeof RelevanceDecisionSchema>;

/** Parse the relevance-pass model output into a url→decision map. Exposed for tests. */
export function parseRelevanceDecisions(text: string): Map<string, RelevanceDecision> {
  const parsed = RelevanceArraySchema.parse(extractJsonArray(text));
  const map = new Map<string, RelevanceDecision>();
  for (const d of parsed) map.set(d.url, d);
  return map;
}

interface Candidate {
  result: SearchResult;
  name: string;
  tickers: string[];
  category: string;
  excerpt: string; // capped article/snippet text
  fullText: string; // longer text stored in payload for consumers
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    out.push(...(await Promise.all(batch.map(fn))));
  }
  return out;
}

async function runRelevancePass(
  modelOption: ModelOption,
  candidates: Candidate[],
  lensFraming: string,
  promptTemplate: string,
): Promise<Map<string, RelevanceDecision>> {
  const payload = candidates.map((c) => ({
    url: c.result.link,
    title: c.result.title,
    snippet: c.result.snippet ?? '',
    excerpt: c.excerpt.slice(0, LLM_EXCERPT_CHARS),
  }));
  const system =
    'You output only a valid JSON array. Never invent URLs; only use URLs present verbatim in the provided input.';
  const prompt =
    '/no_think\n' +
    `${promptTemplate}\n\nInvestor focus: ${lensFraming}\n\n` +
    'Return a JSON array; one object per article: {"url": string, "relevant": boolean, "reason": string (<=200 chars)}.\n\n' +
    `Articles:\n${JSON.stringify(payload, null, 2)}`;

  const { text } = await generateText({
    model: getChatModel(modelOption),
    system,
    prompt,
    timeout: config.jobLlmTimeoutMs,
  });

  try {
    return parseRelevanceDecisions(text);
  } catch (err) {
    const preview = text.length > 3000 ? text.slice(0, 3000) + `\n… (truncated, total ${text.length} chars)` : text;
    console.log(
      '[FinanceNews] LLM parse error — raw output follows:\n--- LLM OUTPUT BEGIN ---\n' + preview + '\n--- LLM OUTPUT END ---',
    );
    throw new Error(`LLM relevance output not valid: ${err instanceof Error ? err.message : err}`);
  }
}

export async function runFinanceNewsScan(
  modelId: string,
  params: FinanceNewsParams = DEFAULT_FINANCE_NEWS_PARAMS,
): Promise<{ summary: string; itemCount: number }> {
  const now = new Date();
  const nowMs = now.getTime();
  const ttlMs = params.seenTtlHours * 60 * 60 * 1000;

  const state = await loadState();
  const seen = pruneSeen(state.seenUrls, nowMs, ttlMs);

  // 1. Search — one query per watchlist name, dedup by URL, drop already-seen.
  const queries = buildQueries(params.watchlist, params.categories);
  const byUrl = new Map<string, { result: SearchResult; name: string }>();
  for (const { name, query } of queries) {
    const results = await searchGoogle(query, {
      num: params.maxResultsPerName,
      dateRestrict: params.dateRestrict,
      sort: 'date',
    });
    for (const r of results) {
      if (!r.link || seen[r.link] || byUrl.has(r.link)) continue;
      byUrl.set(r.link, { result: r, name });
    }
  }
  const discovered = [...byUrl.values()].slice(0, Math.max(params.maxItems * 2, params.maxItems));

  if (discovered.length === 0) {
    state.lastRunAt = now.toISOString();
    state.seenUrls = seen;
    await saveState(state);
    return { summary: 'Finance news: no new articles found for your watchlist.', itemCount: 0 };
  }

  // 2. Enrich — fetch article text (used by the relevance pass and stored for consumers).
  const candidates: Candidate[] = await mapWithConcurrency(discovered, ARTICLE_FETCH_CONCURRENCY, async ({ result, name }) => {
    let fullText = result.snippet ?? '';
    try {
      const article = await fetchArticle(result.link, { maxExtractedTextChars: ARTICLE_FETCH_CHARS });
      if (article?.fetched && article.content) fullText = article.content;
    } catch {
      // keep the snippet on fetch failure
    }
    const tagText = `${result.title} ${result.snippet ?? ''} ${fullText}`;
    return {
      result,
      name,
      tickers: matchTickers(`${result.title} ${result.snippet ?? ''}`, params.watchlist, name),
      category: tagCategory(tagText),
      excerpt: fullText,
      fullText,
    };
  });

  // 3. Optional LLM relevance pass.
  let relevanceByUrl = new Map<string, RelevanceDecision>();
  let kept = candidates;
  if (params.relevanceFilter) {
    const modelOption = findModel(modelId);
    if (!modelOption) throw new Error(`Unknown model: ${modelId}`);
    const lensFraming = LENS_FRAMING[params.investorLens] ?? LENS_FRAMING['none'];
    const promptTemplate = await loadRelevancePrompt();
    relevanceByUrl = await runRelevancePass(modelOption, candidates, lensFraming, promptTemplate);
    kept = candidates.filter((c) => relevanceByUrl.get(c.result.link)?.relevant);
  }
  kept = kept.slice(0, params.maxItems);

  // 4. Publish kept items to the Item Bus.
  for (const c of kept) {
    const decision = relevanceByUrl.get(c.result.link);
    await publishItem({
      producerWorkerId: 'core.finance-news',
      itemType: FINANCE_NEWS_ITEM_TYPE,
      tags: [c.category, ...c.tickers],
      title: c.result.title.slice(0, 200) || 'Untitled',
      shortDesc: (decision?.reason || c.result.snippet || '').slice(0, 400),
      url: c.result.link,
      payload: {
        tickers: c.tickers,
        category: c.category,
        source: { host: hostOf(c.result.link), title: c.result.title },
        snippet: c.result.snippet ?? '',
        articleText: c.fullText.slice(0, ARTICLE_FETCH_CHARS),
        relevanceReason: decision?.reason ?? null,
        producedFor: c.name,
        fetchedAt: now.toISOString(),
      },
      selectionReason: decision?.reason,
    });
    seen[c.result.link] = now.toISOString();
  }

  state.lastRunAt = now.toISOString();
  state.seenUrls = seen;
  await saveState(state);

  // 5. Optional channel notification.
  if (params.notifyOnRelevant && kept.length > 0) {
    await notifyRelevant(kept, relevanceByUrl, params.relevanceFilter);
  }

  await recordEventSafe({
    category: 'worker',
    action: 'finance_news_scan',
    summary: `Finance news: published ${kept.length} of ${candidates.length} candidate(s).`,
    metadata: { workerId: 'core.finance-news', kept: kept.length, candidates: candidates.length },
  });

  const filtered = params.relevanceFilter ? ` (${candidates.length} reviewed)` : '';
  return {
    summary: `Finance news: published ${kept.length} item(s) for ${params.watchlist.length} name(s)${filtered}.`,
    itemCount: kept.length,
  };
}

async function notifyRelevant(
  kept: Candidate[],
  relevance: Map<string, RelevanceDecision>,
  filtered: boolean,
): Promise<void> {
  const lines = kept.slice(0, 6).map((c) => {
    const reason = relevance.get(c.result.link)?.reason;
    const who = c.tickers.slice(0, 3).join(', ');
    return `• ${who}: ${reason || c.result.title}`;
  });
  const more = kept.length > 6 ? `\n…and ${kept.length - 6} more.` : '';
  // Only call them "relevant" when the AI relevance pass actually judged them.
  const label = filtered ? 'relevant update(s)' : 'new item(s)';
  const text = `📈 Finance watch — ${kept.length} ${label}:\n${lines.join('\n')}${more}`;
  try {
    // Lazy-required to break a CJS cycle: registry → builtin/index → this worker → registry.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { notifyOperatorChannels } = require('../../registry') as typeof import('../../registry');
    await notifyOperatorChannels(text);
  } catch (err) {
    console.warn('[FinanceNews] Failed to notify operator channels:', err);
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
