import { z } from 'zod';
import { generateText } from 'ai';
import { config, findModel, type ModelOption } from '../../../config';
import { getChatModel } from '../../../llm';
import { loadQueue, saveQueue, withQueueLock, pruneQueue, type QueueItem } from '../../../jobs/queue';
import { filterItemsForConsumer, setConsumerMetadata } from '../../../jobs/item-bus';
import { loadKvJson } from '../../../sqlite';
import { recordEventSafe } from '../../../event-log';

/**
 * Finance-analyst consumer. Subscribes to `finance.news` items produced by the
 * finance-news worker and attaches a STRUCTURED, INFORMATIONAL read to each:
 * likely direction, magnitude, horizon, confidence, the mechanism, and whether
 * it is plausibly already priced in. It never gives buy/sell advice.
 *
 * Inspired by structured-reasoning-per-news (cf. the StockAgent research idea),
 * but explicitly NOT a trading signal: the model grounds its read only in the
 * article text it is given, and is required to express uncertainty.
 */

const CONSUMER_ID = 'core.finance-analyst';
const SUBSCRIBES_TO = 'finance.news';
const JOB_ID = 'finance-analysis';
const ADMIN_SETTINGS_STORE_KEY = 'admin.settings';
const LLM_EXCERPT_CHARS = 2_500;

export const INVESTOR_LENSES = [
  { value: 'none', label: 'No lens (balanced)' },
  { value: 'long-value', label: 'Long-term / value' },
  { value: 'swing-momentum', label: 'Swing / momentum' },
  { value: 'short-seller', label: 'Short seller' },
  { value: 'income', label: 'Income / dividend' },
  { value: 'macro', label: 'Macro / thematic' },
] as const;

const LENS_FRAMING: Record<string, string> = {
  'none': 'Give a balanced read for a generalist investor.',
  'long-value': 'Weigh the read toward durable fundamentals and multi-quarter implications; discount short-term noise.',
  'swing-momentum': 'Weigh the read toward near-term price catalysts and momentum over the next few days.',
  'short-seller': 'Weigh the read toward downside risk and what could go wrong; flag short-squeeze risk where relevant.',
  'income': 'Weigh the read toward dividend safety, cash flow, and capital-return implications.',
  'macro': 'Weigh the read toward macro/sector transmission and how it propagates to this name.',
};

export const DEFAULT_ANALYSIS_PROMPT = `You are a sober financial analyst writing a short, INFORMATIONAL read on each news item for an investor who already follows the name.

Ground every statement ONLY in the provided article text — never invent numbers or facts. Do NOT give buy/sell/hold advice. Your job is to characterise the likely market reaction and the mechanism, and to be honest about uncertainty (including whether the move is probably already priced in).`;

export const FinanceAnalysisParamsSchema = z.object({
  maxItems: z.number().int().min(1).max(25).catch(8),
  investorLens: z.enum(INVESTOR_LENSES.map((l) => l.value) as [string, ...string[]]).catch('none'),
  notifyOnAnalysis: z.boolean().catch(false),
});
export type FinanceAnalysisParams = z.infer<typeof FinanceAnalysisParamsSchema>;
export const DEFAULT_FINANCE_ANALYSIS_PARAMS: FinanceAnalysisParams = FinanceAnalysisParamsSchema.parse({});

const Direction = z.enum(['up', 'down', 'mixed', 'unclear']);
const Magnitude = z.enum(['low', 'moderate', 'high']);
const Horizon = z.enum(['intraday', 'days', 'weeks', 'months', 'unclear']);
const Confidence = z.enum(['low', 'medium', 'high']);
const PricedIn = z.enum(['likely', 'partly', 'unlikely', 'unclear']);

const AnalysisDecisionSchema = z.object({
  url: z.string().url(),
  direction: Direction,
  magnitude: Magnitude,
  horizon: Horizon,
  confidence: Confidence,
  pricedIn: PricedIn,
  mechanism: z.string().min(1).max(400),
  note: z.string().max(280).optional(),
});
const AnalysisArraySchema = z.array(AnalysisDecisionSchema);
export type AnalysisDecision = z.infer<typeof AnalysisDecisionSchema>;

function extractJsonArray(text: string): unknown {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) throw new Error('No JSON array found in LLM output');
  return JSON.parse(text.slice(start, end + 1));
}

/** Parse the model output into a url→read map. Exposed for tests. */
export function parseAnalysisDecisions(text: string): Map<string, AnalysisDecision> {
  const parsed = AnalysisArraySchema.parse(extractJsonArray(text));
  const map = new Map<string, AnalysisDecision>();
  for (const d of parsed) map.set(d.url, d);
  return map;
}

interface StoredAdminSettings {
  jobs?: Record<string, { prompt?: string }>;
}

async function loadAnalysisPrompt(): Promise<string> {
  const stored = await loadKvJson<StoredAdminSettings>(ADMIN_SETTINGS_STORE_KEY);
  const prompt = stored?.jobs?.[JOB_ID]?.prompt;
  return typeof prompt === 'string' && prompt.trim() ? prompt : DEFAULT_ANALYSIS_PROMPT;
}

interface FinanceNewsPayload {
  tickers?: unknown;
  category?: unknown;
  articleText?: unknown;
  snippet?: unknown;
  relevanceReason?: unknown;
}

function payloadOf(item: QueueItem): FinanceNewsPayload {
  return item.payload ?? {};
}

function tickersOf(item: QueueItem): string[] {
  const t = payloadOf(item).tickers;
  return Array.isArray(t) ? t.filter((x): x is string => typeof x === 'string') : [];
}

function articleTextOf(item: QueueItem): string {
  const p = payloadOf(item);
  const text = typeof p.articleText === 'string' ? p.articleText : '';
  const snippet = typeof p.snippet === 'string' ? p.snippet : '';
  return (text || snippet).slice(0, LLM_EXCERPT_CHARS);
}

async function analyze(
  modelOption: ModelOption,
  items: QueueItem[],
  lensFraming: string,
  promptTemplate: string,
): Promise<Map<string, AnalysisDecision>> {
  const payload = items.map((it) => ({
    url: it.url,
    tickers: tickersOf(it),
    title: it.title,
    text: articleTextOf(it),
  }));
  const system = 'You output only a valid JSON array. Never invent URLs; use only URLs present verbatim in the input. Never give buy/sell advice.';
  const prompt =
    '/no_think\n' +
    `${promptTemplate}\n\nInvestor focus: ${lensFraming}\n\n` +
    'Return a JSON array, one object per item:\n' +
    '{"url": string, "direction": "up"|"down"|"mixed"|"unclear", "magnitude": "low"|"moderate"|"high", ' +
    '"horizon": "intraday"|"days"|"weeks"|"months"|"unclear", "confidence": "low"|"medium"|"high", ' +
    '"pricedIn": "likely"|"partly"|"unlikely"|"unclear", "mechanism": string (<=300 chars, why it could move the name), ' +
    '"note": string (optional, <=200 chars)}.\n\n' +
    `Items:\n${JSON.stringify(payload, null, 2)}`;

  const { text } = await generateText({
    model: getChatModel(modelOption),
    system,
    prompt,
    timeout: config.jobLlmTimeoutMs,
  });

  try {
    return parseAnalysisDecisions(text);
  } catch (err) {
    const preview = text.length > 3000 ? text.slice(0, 3000) + `\n… (truncated, total ${text.length} chars)` : text;
    console.log(
      '[FinanceAnalyst] LLM parse error — raw output follows:\n--- LLM OUTPUT BEGIN ---\n' + preview + '\n--- LLM OUTPUT END ---',
    );
    throw new Error(`LLM analysis output not valid: ${err instanceof Error ? err.message : err}`);
  }
}

const ARROW: Record<string, string> = { up: '↑', down: '↓', mixed: '↔', unclear: '?' };

export async function runFinanceAnalysis(
  modelId: string,
  params: FinanceAnalysisParams = DEFAULT_FINANCE_ANALYSIS_PARAMS,
): Promise<{ summary: string; itemCount: number }> {
  const nowMs = Date.now();

  // Read-and-annotate consumer: pick unhandled finance.news items, attach a read
  // into our own metadata namespace, and persist. We do not change item state.
  return withQueueLock(async () => {
    const queue = pruneQueue(await loadQueue(), nowMs);
    const pending = filterItemsForConsumer(queue, CONSUMER_ID, {
      itemType: SUBSCRIBES_TO,
      excludeAlreadyHandled: true,
    });

    if (pending.length === 0) {
      await saveQueue(queue);
      return { summary: 'Finance analyst: no new finance.news items to analyse.', itemCount: 0 };
    }

    const batch = pending
      .slice()
      .sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt))
      .slice(0, params.maxItems);

    const modelOption = findModel(modelId);
    if (!modelOption) throw new Error(`Unknown model: ${modelId}`);

    const lensFraming = LENS_FRAMING[params.investorLens] ?? LENS_FRAMING['none'];
    const promptTemplate = await loadAnalysisPrompt();
    const reads = await analyze(modelOption, batch, lensFraming, promptTemplate);

    const analyzedAt = new Date().toISOString();
    const analyzed: { item: QueueItem; read: AnalysisDecision }[] = [];
    for (const item of batch) {
      const read = reads.get(item.url);
      if (!read) continue;
      setConsumerMetadata(item, CONSUMER_ID, {
        analyzedAt,
        direction: read.direction,
        magnitude: read.magnitude,
        horizon: read.horizon,
        confidence: read.confidence,
        pricedIn: read.pricedIn,
        mechanism: read.mechanism,
        note: read.note ?? null,
      });
      analyzed.push({ item, read });
    }

    await saveQueue(queue);

    if (params.notifyOnAnalysis && analyzed.length > 0) {
      await notifyAnalyses(analyzed);
    }

    await recordEventSafe({
      category: 'worker',
      action: 'finance_analysis',
      summary: `Finance analyst: analysed ${analyzed.length} of ${batch.length} item(s).`,
      metadata: { workerId: CONSUMER_ID, analyzed: analyzed.length, batch: batch.length },
    });

    return {
      summary: `Finance analyst: attached a read to ${analyzed.length} item(s).`,
      itemCount: analyzed.length,
    };
  });
}

async function notifyAnalyses(analyzed: { item: QueueItem; read: AnalysisDecision }[]): Promise<void> {
  const lines = analyzed.slice(0, 6).map(({ item, read }) => {
    const who = tickersOf(item).slice(0, 3).join(', ') || item.title.slice(0, 40);
    const arrow = ARROW[read.direction] ?? '?';
    return `• ${who} ${arrow} ${read.magnitude}/${read.horizon} (${read.confidence} conf, priced-in: ${read.pricedIn})\n  ${read.mechanism}`;
  });
  const more = analyzed.length > 6 ? `\n…and ${analyzed.length - 6} more.` : '';
  const text = `🧭 Finance reads — ${analyzed.length} update(s). Informational only, not advice:\n${lines.join('\n')}${more}`;
  try {
    // Lazy-required to break a CJS cycle: registry → builtin/index → this worker → registry.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { notifyOperatorChannels } = require('../../registry') as typeof import('../../registry');
    await notifyOperatorChannels(text);
  } catch (err) {
    console.warn('[FinanceAnalyst] Failed to notify operator channels:', err);
  }
}
