/**
 * 01.1 — model-usage metering at the shared dispatch chokepoint.
 *
 * Every model call in BFrost resolves its handle through `llm.ts`'s `getChatModel`. That is the
 * one place all of them pass, so it is the one place metering can be complete rather than
 * best-effort — a per-worker counter would measure whichever workers remembered to add one.
 *
 * **Core, and worker-agnostic.** `workerId` and `jobName` are opaque strings here. This module
 * names no worker, no item type and no model provider; adding or removing a worker changes what
 * appears in the table, never this file.
 *
 * ## Why the model handle is wrapped
 *
 * `getChatModel` returns a handle; the tokens are only known once the *call* resolves, inside
 * whichever worker invoked `generateText`. Metering therefore wraps the returned model and
 * records usage as calls complete. The alternative — asking every worker to report its own usage
 * — is the best-effort version this slice exists to avoid.
 *
 * ## Why costs are versioned
 *
 * A cost is a price multiplied by a token count, and prices change. A stored cost that does not
 * say which price table produced it cannot be recomputed or audited, and quietly becomes a number
 * nobody can defend. `PRICE_TABLE_VERSION` is stored on every row.
 *
 * Attribution rides ambiently through `AsyncLocalStorage`, the same mechanism and for the same
 * reason as `llm.ts`'s reasoning level: the call sites are inside worker jobs and must not need a
 * signature change to be measured.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { getAppDbSync } from './sqlite';

export interface UsageAttribution {
  jobName: string;
  runId: string;
  workerId: string;
  /** The thing being worked on, when the caller knows it — a ticker, a document id. Opaque. */
  subject?: string | null;
}

const attributionContext = new AsyncLocalStorage<UsageAttribution>();

/** Run `fn` with usage attributed to this job run. Nested calls inherit the innermost. */
export function runWithUsageAttribution<T>(attribution: UsageAttribution, fn: () => Promise<T>): Promise<T> {
  return attributionContext.run(attribution, fn);
}

/** Narrow the ambient attribution to a subject without disturbing the rest. A no-op when no run
 *  is in scope, so worker code can call it unconditionally. */
export function runWithUsageSubject<T>(subject: string, fn: () => Promise<T>): Promise<T> {
  const current = attributionContext.getStore();
  if (!current) return fn();
  return attributionContext.run({ ...current, subject }, fn);
}

export function currentUsageAttribution(): UsageAttribution | null {
  return attributionContext.getStore() ?? null;
}

/**
 * Prices per million tokens, in USD.
 *
 * Deliberately a table rather than a lookup against a provider API: a bill is reconciled against
 * what was charged, and an estimate that silently re-prices historical rows when a vendor changes
 * its list is worse than one that is openly stale. `PRICE_TABLE_VERSION` moves whenever a number
 * here does, and rows keep the version they were computed under.
 *
 * A model absent from the table is metered with `costUsd: null` rather than zero. Zero is a
 * measurement; null is an admission, and conflating them makes an unpriced model look free.
 */
export const PRICE_TABLE_VERSION = '2026-08-17';

export interface ModelPrice {
  inputPerMillion: number;
  outputPerMillion: number;
  /** Cached input is usually billed cheaper; absent means "billed as ordinary input". */
  cachedInputPerMillion?: number;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  'gpt-5.5': { inputPerMillion: 1.25, outputPerMillion: 10, cachedInputPerMillion: 0.125 },
  'gpt-5.4': { inputPerMillion: 1.1, outputPerMillion: 8, cachedInputPerMillion: 0.11 },
  'gpt-5.4-mini': { inputPerMillion: 0.25, outputPerMillion: 2, cachedInputPerMillion: 0.025 },
  'gpt-5.4-nano': { inputPerMillion: 0.05, outputPerMillion: 0.4, cachedInputPerMillion: 0.005 },
  'gpt-4o': { inputPerMillion: 2.5, outputPerMillion: 10, cachedInputPerMillion: 1.25 },
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.6, cachedInputPerMillion: 0.075 },
  'o3': { inputPerMillion: 2, outputPerMillion: 8 },
  'o3-mini': { inputPerMillion: 1.1, outputPerMillion: 4.4 },
  'o4-mini': { inputPerMillion: 1.1, outputPerMillion: 4.4 },
};

/** Normalised token counts, flattened from whichever provider spec reported them. */
export interface NormalizedUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  reasoningTokens: number | null;
}

/**
 * Flatten a provider usage object.
 *
 * Handles both the v3 nested shape (`inputTokens: { total, cacheRead, ... }`) and the v2 flat one
 * (`inputTokens: number`), because a locally-installed provider worker may still ship either and
 * core must not require them all to move together. An unrecognised shape yields nulls rather than
 * zeros — see the note on unpriced models.
 */
export function normalizeUsage(usage: unknown): NormalizedUsage {
  const empty: NormalizedUsage = { inputTokens: null, outputTokens: null, cachedInputTokens: null, reasoningTokens: null };
  if (!usage || typeof usage !== 'object') return empty;

  const record = usage as Record<string, unknown>;
  const input = record.inputTokens;
  const output = record.outputTokens;

  const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

  if (input && typeof input === 'object') {
    const inputRecord = input as Record<string, unknown>;
    const outputRecord = (output && typeof output === 'object' ? output : {}) as Record<string, unknown>;
    return {
      inputTokens: num(inputRecord.total),
      outputTokens: num(outputRecord.total),
      cachedInputTokens: num(inputRecord.cacheRead),
      reasoningTokens: num(outputRecord.reasoning),
    };
  }
  return {
    inputTokens: num(input),
    outputTokens: num(output),
    cachedInputTokens: num(record.cachedInputTokens),
    reasoningTokens: num(record.reasoningTokens),
  };
}

/**
 * Cost in USD, or `null` when the model is not in the price table.
 *
 * Cached input is billed at its own rate and **subtracted from** the ordinary input count, not
 * added to it: providers report `cacheRead` as a subset of the input total, so charging both
 * would double-count exactly the tokens caching was meant to make cheaper.
 */
export function estimateCostUsd(modelId: string, usage: NormalizedUsage): number | null {
  const price = MODEL_PRICES[modelId];
  if (!price) return null;

  // A completed call cannot have consumed zero input tokens. All-zero usage means the provider
  // did not report: a flat-rate subscription path has no per-token figure to give, and returns a
  // zeroed usage object rather than omitting it. Pricing that as `$0.000000` would state a
  // measured zero cost for a call whose cost is simply unknown, and a cost table full of
  // confident zeros is worse than one with visible gaps.
  if (!usage.inputTokens && !usage.outputTokens) return null;

  const input = usage.inputTokens ?? 0;
  const cached = Math.min(usage.cachedInputTokens ?? 0, input);
  const uncached = input - cached;
  const cachedRate = price.cachedInputPerMillion ?? price.inputPerMillion;

  return (uncached * price.inputPerMillion
    + cached * cachedRate
    + (usage.outputTokens ?? 0) * price.outputPerMillion) / 1_000_000;
}

export interface RunCostRow {
  id: string;
  createdAt: string;
  jobName: string | null;
  runId: string | null;
  workerId: string | null;
  subject: string | null;
  provider: string;
  modelId: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  reasoningTokens: number | null;
  wallMs: number;
  outcome: 'ok' | 'error';
  costUsd: number | null;
  priceTableVersion: string;
}

/**
 * Record one completed model call.
 *
 * Never throws. Metering that can fail a job is worse than metering that misses a row — the
 * measurement exists to inform decisions, not to become a new way for work to break.
 */
export function recordModelUsage(entry: {
  provider: string;
  modelId: string;
  usage: unknown;
  wallMs: number;
  outcome: 'ok' | 'error';
}): void {
  try {
    const attribution = currentUsageAttribution();
    const usage = normalizeUsage(entry.usage);
    getAppDbSync().prepare(`
      INSERT INTO run_costs (
        id, created_at, job_name, run_id, worker_id, subject, provider, model_id,
        input_tokens, output_tokens, cached_input_tokens, reasoning_tokens,
        wall_ms, outcome, cost_usd, price_table_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      new Date().toISOString(),
      attribution?.jobName ?? null,
      attribution?.runId ?? null,
      attribution?.workerId ?? null,
      attribution?.subject ?? null,
      entry.provider,
      entry.modelId,
      usage.inputTokens,
      usage.outputTokens,
      usage.cachedInputTokens,
      usage.reasoningTokens,
      Math.round(entry.wallMs),
      entry.outcome,
      estimateCostUsd(entry.modelId, usage),
      PRICE_TABLE_VERSION,
    );
  } catch {
    // Deliberately silent: see the doc comment.
  }
}

/**
 * `01.1`'s read counters.
 *
 * Counted per `(artifactId, surface, freshness)` rather than stored on the artifact, because
 * `01.1` requires reads from each surface to stay distinguishable *without duplicating the
 * artifact*. A counter on the artifact would answer "how many reads" but not "from where", and
 * adding a per-surface field to the artifact is the duplication the slice forbids.
 *
 * The surfaces are named generically here (`public` / `subscriber` / `api`) rather than by the
 * product tiers the roadmap calls them, because this is core: it must stay readable after a
 * product is renamed, and the worker-first contract test rejects the product vocabulary outright.
 */
export type ReadSurface = 'public' | 'subscriber' | 'api';

export function recordArtifactRead(entry: {
  artifactId: string;
  surface: ReadSurface;
  /** Freshness of what was served, so a stale read is distinguishable from a fresh one. */
  freshness: string;
}): void {
  try {
    getAppDbSync().prepare(`
      INSERT INTO artifact_reads (artifact_id, surface, freshness, day, reads)
      VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(artifact_id, surface, freshness, day)
      DO UPDATE SET reads = reads + 1
    `).run(
      entry.artifactId,
      entry.surface,
      entry.freshness,
      new Date().toISOString().slice(0, 10),
    );
  } catch {
    // Same posture as `recordModelUsage`: a read is served whether or not it is counted.
  }
}

// ---------------------------------------------------------------------------
// Reporting — the questions 01.1's acceptance says an operator must be able to answer
// ---------------------------------------------------------------------------

export interface JobCostSummary {
  jobName: string | null;
  runs: number;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costUsd: number | null;
  /** Calls whose model was absent from the price table. A cost total with unpriced calls behind
   *  it is a floor, not a total, and the operator has to be told which they are looking at. */
  unpricedCalls: number;
}

/** "What does one run of this job cost?" — per job, over a window. */
export function costByJob(sinceIso: string): JobCostSummary[] {
  return getAppDbSync().prepare(`
    SELECT job_name AS jobName,
           COUNT(DISTINCT run_id) AS runs,
           COUNT(*) AS calls,
           COALESCE(SUM(input_tokens), 0) AS inputTokens,
           COALESCE(SUM(output_tokens), 0) AS outputTokens,
           COALESCE(SUM(cached_input_tokens), 0) AS cachedInputTokens,
           SUM(cost_usd) AS costUsd,
           SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS unpricedCalls
    FROM run_costs
    WHERE created_at >= ?
    GROUP BY job_name
    ORDER BY costUsd DESC NULLS LAST
  `).all(sinceIso) as JobCostSummary[];
}

export interface SubjectCostSummary {
  subject: string | null;
  calls: number;
  costUsd: number | null;
  unpricedCalls: number;
}

/** "What does one artifact cost to produce?" — per subject, over a window. */
export function costBySubject(sinceIso: string): SubjectCostSummary[] {
  return getAppDbSync().prepare(`
    SELECT subject,
           COUNT(*) AS calls,
           SUM(cost_usd) AS costUsd,
           SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS unpricedCalls
    FROM run_costs
    WHERE created_at >= ? AND subject IS NOT NULL
    GROUP BY subject
    ORDER BY costUsd DESC NULLS LAST
  `).all(sinceIso) as SubjectCostSummary[];
}

export interface ArtifactReadSummary {
  artifactId: string;
  surface: ReadSurface;
  reads: number;
}

/** "Which public artifacts are being read?" — per artifact and surface, over a window. */
export function readsByArtifact(sinceDay: string): ArtifactReadSummary[] {
  return getAppDbSync().prepare(`
    SELECT artifact_id AS artifactId, surface, SUM(reads) AS reads
    FROM artifact_reads
    WHERE day >= ?
    GROUP BY artifact_id, surface
    ORDER BY reads DESC
  `).all(sinceDay) as ArtifactReadSummary[];
}

/**
 * Wrap a provider's model handle so completed calls are metered.
 *
 * A `Proxy` rather than a rewritten object: a provider handle carries properties core does not
 * know about (`specificationVersion`, `supportedUrls`, vendor extras), and copying the ones we
 * happen to know would silently drop the rest the first time a provider adds one. The proxy
 * intercepts exactly the two call methods and forwards everything else untouched.
 *
 * A string handle is returned as-is: `LanguageModel` may be a bare model id, which has no methods
 * to wrap and no usage to report.
 */
export function meterLanguageModel<T>(model: T, provider: string, modelId: string): T {
  if (!model || typeof model !== 'object') return model;

  return new Proxy(model as object, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if ((property !== 'doGenerate' && property !== 'doStream') || typeof value !== 'function') {
        return value;
      }
      return async function metered(this: unknown, ...args: unknown[]) {
        const startedAt = Date.now();
        try {
          const result = await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
          // `doStream` resolves before the stream is consumed, so its usage is not final here.
          // Recording what is available keeps the call counted — an uncounted call is invisible,
          // while a call with null tokens is visibly incomplete.
          recordModelUsage({
            provider,
            modelId,
            usage: (result as { usage?: unknown } | null)?.usage,
            wallMs: Date.now() - startedAt,
            outcome: 'ok',
          });
          return result;
        } catch (error) {
          // A failed call still consumed wall time and often input tokens, and a cost report that
          // omitted failures would understate exactly the runs worth investigating.
          recordModelUsage({ provider, modelId, usage: undefined, wallMs: Date.now() - startedAt, outcome: 'error' });
          throw error;
        }
      };
    },
  }) as T;
}
