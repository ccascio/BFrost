import { z } from 'zod';
import { generateText } from 'ai';
import { config, findModel, type ModelOption } from '../../../config';
import { getChatModel } from '../../../llm';
import { loadQueue, saveQueue, withQueueLock, pruneQueue, type QueueItem } from '../../../jobs/queue';
import { filterItemsForConsumer, setConsumerMetadata } from '../../../jobs/item-bus';
import { loadKvJson, saveKvJson } from '../../../sqlite';
import { recordEventSafe } from '../../../event-log';

/**
 * Finance-analyst consumer. Subscribes to `finance.news` items produced by the
 * finance-news worker and attaches structured investment advice to each target:
 * buy/hold/sell, likely direction, magnitude, horizon, confidence, the mechanism,
 * risks, the next check, and whether it is plausibly already priced in.
 *
 * Inspired by structured-reasoning-per-news (cf. the StockAgent research idea).
 * The model grounds every recommendation in the supplied article and queue context.
 */

const CONSUMER_ID = 'core.finance-analyst';
const SUBSCRIBES_TO = 'finance.news';
const JOB_ID = 'finance-analysis';
const ADMIN_SETTINGS_STORE_KEY = 'admin.settings';
const ANALYSIS_VERSION = 3;

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

export const RISK_TOLERANCES = [
  { value: 'conservative', label: 'Conservative' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'aggressive', label: 'Aggressive' },
] as const;

const LEGACY_DEFAULT_ANALYSIS_PROMPT = `You are a sober financial analyst writing a short, INFORMATIONAL read on each news item for an investor who already follows the name.

Ground every statement ONLY in the provided article text — never invent numbers or facts. Do NOT give buy/sell/hold advice. Your job is to characterise the likely market reaction and the mechanism, and to be honest about uncertainty (including whether the move is probably already priced in).`;

const LEGACY_MECHANISM_PROMPT = `You are a financial analyst. For each item, explain the causal mechanism first: what specifically changed, which line item or driver it affects, and how that transmits to the share price.

Ground every claim in the provided article text only. Be explicit about second-order effects and what is uncertain. Do NOT give buy/sell/hold advice — characterise the likely reaction and the mechanism only.`;

const PHASE_ONE_ANALYSIS_PROMPT = `You are an investment analyst whose job is to give a clear BUY, HOLD, or SELL recommendation for every target materially discussed in each news item.

Ground every factual claim in the supplied input. Distinguish reported facts from your inference and never invent figures, prices, consensus estimates, or portfolio details. Choose the strongest recommendation supported by the evidence. Use HOLD only when the evidence genuinely does not justify changing exposure; never choose HOLD merely to avoid commitment. Express uncertainty through confidence, risks, and the next fact to verify.`;

export const DEFAULT_ANALYSIS_PROMPT = `You are an investment analyst whose job is to give a clear BUY, HOLD, or SELL recommendation for every target materially discussed in each news item, plus a practical research priority.

Ground every factual claim in the supplied input. Distinguish reported facts from your inference and never invent figures, prices, consensus estimates, or portfolio details. Choose the strongest recommendation supported by the evidence. Use HOLD only when the evidence genuinely does not justify changing exposure; never choose HOLD merely to avoid commitment. Express uncertainty through confidence, risks, evidence, and the next fact to verify.

Separately choose attention: act_on_research for a material catalyst requiring prompt investigation, watch for a plausible development needing confirmation, no_action for information unlikely to warrant more work, and insufficient_evidence when the article cannot support a reliable research priority. Attention tells the operator what to do next; it is not a trade instruction.`;

export const FinanceAnalysisParamsSchema = z.object({
  maxItems: z.number().int().min(1).max(25).catch(8),
  investorLens: z.enum(INVESTOR_LENSES.map((l) => l.value) as [string, ...string[]]).catch('none'),
  riskTolerance: z.enum(RISK_TOLERANCES.map((entry) => entry.value) as [string, ...string[]]).catch('balanced'),
  portfolioContext: z.string().max(4_000).catch(''),
  notifyOnAnalysis: z.boolean().catch(false),
});
export type FinanceAnalysisParams = z.infer<typeof FinanceAnalysisParamsSchema>;
export const DEFAULT_FINANCE_ANALYSIS_PARAMS: FinanceAnalysisParams = FinanceAnalysisParamsSchema.parse({});

const Direction = z.enum(['up', 'down', 'mixed', 'unclear']);
const Magnitude = z.enum(['low', 'moderate', 'high']);
const Horizon = z.enum(['intraday', 'days', 'weeks', 'months', 'unclear']);
const Confidence = z.enum(['low', 'medium', 'high']);
const PricedIn = z.enum(['likely', 'partly', 'unlikely', 'unclear']);
const Recommendation = z.enum(['buy', 'hold', 'sell']);
const Attention = z.enum(['act_on_research', 'watch', 'no_action', 'insufficient_evidence']);

const TargetRecommendationSchema = z.object({
  target: z.string().min(1).max(100),
  recommendation: Recommendation,
  attention: Attention,
  catalyst: z.string().min(1).max(300),
  evidence: z.string().min(1).max(500),
  direction: Direction,
  magnitude: Magnitude,
  horizon: Horizon,
  confidence: Confidence,
  pricedIn: PricedIn,
  mechanism: z.string().min(1).max(400),
  risks: z.string().min(1).max(400),
  nextCheck: z.string().min(1).max(300),
  note: z.string().max(280).optional(),
});
export type TargetRecommendation = z.infer<typeof TargetRecommendationSchema>;

const AnalysisDecisionSchema = z.object({
  url: z.string().url(),
  recommendations: z.array(TargetRecommendationSchema).min(1),
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
  jobs?: Record<string, { prompt?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

async function loadAnalysisPrompt(): Promise<string> {
  const stored = await loadKvJson<StoredAdminSettings>(ADMIN_SETTINGS_STORE_KEY);
  const current = stored?.jobs?.[JOB_ID]?.prompt;
  const resolved = resolveAnalysisPrompt(current);
  if (stored && typeof current === 'string' && resolved !== current) {
    await saveResolvedAnalysisPrompt(stored, resolved);
  }
  return resolved;
}

/** Preserve custom prompts, but upgrade a persisted copy of the former built-in default. */
export function resolveAnalysisPrompt(prompt: unknown): string {
  if (typeof prompt !== 'string' || !prompt.trim()) return DEFAULT_ANALYSIS_PROMPT;
  const trimmed = prompt.trim();
  return trimmed === LEGACY_DEFAULT_ANALYSIS_PROMPT || trimmed === LEGACY_MECHANISM_PROMPT || trimmed === PHASE_ONE_ANALYSIS_PROMPT
    ? DEFAULT_ANALYSIS_PROMPT
    : prompt;
}

/** Upgrade only known built-in legacy prompts in the worker-owned job settings. */
export async function migrateLegacyAnalysisPrompt(): Promise<boolean> {
  const stored = await loadKvJson<StoredAdminSettings>(ADMIN_SETTINGS_STORE_KEY);
  const current = stored?.jobs?.[JOB_ID]?.prompt;
  if (!stored || typeof current !== 'string') return false;
  const resolved = resolveAnalysisPrompt(current);
  if (resolved === current) return false;
  await saveResolvedAnalysisPrompt(stored, resolved);
  return true;
}

async function saveResolvedAnalysisPrompt(stored: StoredAdminSettings, prompt: string): Promise<void> {
  await saveKvJson(ADMIN_SETTINGS_STORE_KEY, {
    ...stored,
    jobs: {
      ...stored.jobs,
      [JOB_ID]: {
        ...stored.jobs?.[JOB_ID],
        prompt,
      },
    },
  });
}

interface FinanceNewsPayload {
  tickers?: unknown;
  category?: unknown;
  articleText?: unknown;
  snippet?: unknown;
  relevanceReason?: unknown;
  source?: unknown;
  producedFor?: unknown;
  fetchedAt?: unknown;
  contentQuality?: unknown;
  articleChars?: unknown;
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
  return text || snippet;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function stringArray(value: unknown): string[] {
  if (typeof value === 'string' && value) return [value];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

/** Full, enriched per-item context supplied to the analyst model. */
export function buildAnalysisPayload(items: QueueItem[]) {
  return items.map((item) => {
    const payload = payloadOf(item);
    const source = payload.source && typeof payload.source === 'object'
      ? payload.source as Record<string, unknown>
      : {};
    return {
      url: item.url,
      title: item.title,
      shortDescription: item.shortDesc,
      targets: tickersOf(item),
      category: stringValue(payload.category),
      tags: item.tags ?? [],
      addedAt: item.addedAt,
      source: {
        host: stringValue(source.host),
        title: stringValue(source.title),
      },
      searchTargets: stringArray(payload.producedFor),
      relevanceReason: stringValue(payload.relevanceReason) || item.selectionReason || '',
      fetchedAt: stringValue(payload.fetchedAt),
      contentQuality: stringValue(payload.contentQuality) || 'unknown',
      articleChars: typeof payload.articleChars === 'number' ? payload.articleChars : articleTextOf(item).length,
      snippet: stringValue(payload.snippet),
      articleText: articleTextOf(item),
    };
  });
}

export async function hasFinanceAnalysisWork(): Promise<boolean> {
  const queue = pruneQueue(await loadQueue(), Date.now());
  return filterItemsForConsumer(queue, CONSUMER_ID, {
    itemType: SUBSCRIBES_TO,
  }).some((item) => item.metadata?.[CONSUMER_ID]?.analysisVersion !== ANALYSIS_VERSION);
}

async function analyze(
  modelOption: ModelOption,
  items: QueueItem[],
  lensFraming: string,
  riskTolerance: string,
  portfolioContext: string,
  promptTemplate: string,
): Promise<Map<string, AnalysisDecision>> {
  const payload = buildAnalysisPayload(items);
  const system = 'You are an investment-advice engine. Output only a valid JSON array. Never invent URLs or target names; copy them verbatim from the input.';
  const prompt =
    '/no_think\n' +
    `${promptTemplate}\n\nInvestor focus: ${lensFraming}\nRisk tolerance: ${riskTolerance}.\n` +
    `Portfolio context: ${portfolioContext.trim() || 'Not provided; make a general recommendation for an investor evaluating exposure.'}\n\n` +
    'Give one recommendation for EVERY target listed on each item. BUY means the evidence supports increasing or initiating exposure; SELL means reducing or avoiding exposure; HOLD means maintaining current exposure. ' +
    'Also give an attention state: act_on_research = promptly investigate a material catalyst; watch = confirm a plausible development; no_action = no further work warranted now; insufficient_evidence = article does not support a reliable research priority. ' +
    'Attention is a practical research instruction, not a trade instruction. If evidence is incomplete, still choose the most defensible recommendation and lower confidence. Set pricedIn to unclear unless the input contains evidence about expectations or an observed market reaction.\n\n' +
    'Return a JSON array, one object per item:\n' +
    '{"url": string, "recommendations": [{"target": string, "recommendation": "buy"|"hold"|"sell", "attention": "act_on_research"|"watch"|"no_action"|"insufficient_evidence", ' +
    '"catalyst": string (<=220 chars, the specific development), "evidence": string (<=350 chars, facts from the supplied input), ' +
    '"direction": "up"|"down"|"mixed"|"unclear", "magnitude": "low"|"moderate"|"high", ' +
    '"horizon": "intraday"|"days"|"weeks"|"months"|"unclear", "confidence": "low"|"medium"|"high", ' +
    '"pricedIn": "likely"|"partly"|"unlikely"|"unclear", "mechanism": string (<=300 chars), ' +
    '"risks": string (<=300 chars), "nextCheck": string (<=220 chars), "note": string (optional, <=200 chars)}]}.\n\n' +
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

  // Read-and-annotate consumer: pick finance.news items without current advice, attach recommendations
  // into our own metadata namespace, and persist. We do not change item state.
  return withQueueLock(async () => {
    const queue = pruneQueue(await loadQueue(), nowMs);
    const pending = filterItemsForConsumer(queue, CONSUMER_ID, {
      itemType: SUBSCRIBES_TO,
    }).filter((item) => item.metadata?.[CONSUMER_ID]?.analysisVersion !== ANALYSIS_VERSION);

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
    const reads = await analyze(
      modelOption,
      batch,
      lensFraming,
      params.riskTolerance,
      params.portfolioContext,
      promptTemplate,
    );

    const analyzedAt = new Date().toISOString();
    const analyzed: { item: QueueItem; read: AnalysisDecision }[] = [];
    for (const item of batch) {
      const rawRead = reads.get(item.url);
      if (!rawRead) continue;
      const read = normalizeDecisionTargets(rawRead, tickersOf(item));
      if (read.recommendations.length === 0) continue;
      const primary = read.recommendations[0];
      setConsumerMetadata(item, CONSUMER_ID, {
        analysisVersion: ANALYSIS_VERSION,
        analyzedAt,
        recommendations: read.recommendations,
        recommendation: primary.recommendation,
        attention: primary.attention,
        catalyst: primary.catalyst,
        evidence: primary.evidence,
        direction: primary.direction,
        magnitude: primary.magnitude,
        horizon: primary.horizon,
        confidence: primary.confidence,
        pricedIn: primary.pricedIn,
        mechanism: primary.mechanism,
        risks: primary.risks,
        nextCheck: primary.nextCheck,
        note: primary.note ?? null,
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
      summary: `Finance analyst: attached investment advice to ${analyzed.length} item(s).`,
      itemCount: analyzed.length,
    };
  });
}

async function notifyAnalyses(analyzed: { item: QueueItem; read: AnalysisDecision }[]): Promise<void> {
  const recommendations = analyzed.flatMap(({ read }) => read.recommendations).slice(0, 8);
  const lines = recommendations.map((advice) => {
    const arrow = ARROW[advice.direction] ?? '?';
    return `• ${advice.target}: ${advice.attention.replace(/_/g, ' ').toUpperCase()} · ${advice.recommendation.toUpperCase()} ${arrow} ${advice.magnitude}/${advice.horizon} (${advice.confidence} confidence)\n  Catalyst: ${advice.catalyst}\n  Next: ${advice.nextCheck}`;
  });
  const total = analyzed.reduce((count, entry) => count + entry.read.recommendations.length, 0);
  const more = total > recommendations.length ? `\n…and ${total - recommendations.length} more.` : '';
  const text = `🧭 Finance advice — ${total} recommendation(s):\n${lines.join('\n')}${more}`;
  try {
    // Lazy-required to break a CJS cycle: registry → builtin/index → this worker → registry.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { notifyOperatorChannels } = require('../../registry') as typeof import('../../registry');
    await notifyOperatorChannels(text);
  } catch (err) {
    console.warn('[FinanceAnalyst] Failed to notify operator channels:', err);
  }
}

function normalizeDecisionTargets(read: AnalysisDecision, targets: string[]): AnalysisDecision {
  const canonical = new Map(targets.map((target) => [target.toLowerCase(), target]));
  return {
    ...read,
    recommendations: read.recommendations
      .filter((advice) => canonical.has(advice.target.toLowerCase()))
      .map((advice) => ({ ...advice, target: canonical.get(advice.target.toLowerCase())! })),
  };
}
