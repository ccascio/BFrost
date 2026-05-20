import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import { generateText } from 'ai';
import { getChatModel } from '../../../llm';
import { searchGoogle, type SearchResult } from '../search-google/module';
import { fetchArticle, type ArticleExtraction } from '../article-fetch/module';
import {
  assessSourceQuality,
  loadSourceQualityRules,
  summarizeSourceAssessment,
  type SourceAssessment,
} from './source-quality';
import {
  canonicalizeUrl,
  findNearDuplicateMatch,
  type DuplicateReference,
} from './near-duplicates';
import { config, findModel } from '../../../config';
import { createQueueItem, loadQueue, saveQueue, pruneQueue, withQueueLock, QueueItem } from '../../../jobs/queue';

function newsProducerHeader(): Partial<QueueItem> {
  return {
    producerWorkerId: 'core.news',
    itemType: 'news.article',
    tags: ['news'],
  };
}
import { newsRunFileForRanAt, saveNewsRun, type NewsRunRecord } from './runs';
import { loadKvJson, saveKvJson } from '../../../sqlite';

export const DEFAULT_NEWS_INTERESTS = ['World news', 'Technology news', 'Business news'];

export const NewsDigestParamsSchema = z.object({
  queries: z.array(z.string().min(1)).min(1).catch(DEFAULT_NEWS_INTERESTS),
  maxResultsPerQuery: z.number().int().min(1).max(20).catch(10),
  maxLlmCandidates: z.number().int().min(1).max(30).catch(5),
  maxTelegramItems: z.number().int().min(1).max(20).catch(5),
  seenTtlHours: z.number().int().min(1).max(168).catch(48),
  dateRestrict: z.string().min(1).catch('d1'),
});
export type NewsDigestParams = z.infer<typeof NewsDigestParamsSchema>;
export const DEFAULT_NEWS_DIGEST_PARAMS: NewsDigestParams = NewsDigestParamsSchema.parse({});
export function resolveNewsDigestParams(raw: unknown): NewsDigestParams {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_NEWS_DIGEST_PARAMS;
  return NewsDigestParamsSchema.parse(raw);
}

const FILTER_TIMEOUT_MS = config.jobLlmTimeoutMs;
const ARTICLE_FETCH_CONCURRENCY = 4;
const NEWS_STATE_STORE_KEY = 'news.state';

const FilterActionSchema = z.enum(['queue', 'reject']);
const FilterDecisionSchema = z.object({
  url: z.string().url(),
  action: FilterActionSchema,
  reason: z.string().min(1).max(240),
  title: z.string().min(1).max(200).optional(),
  shortDesc: z.string().min(1).max(400).optional(),
});
const FilterDecisionArraySchema = z.array(FilterDecisionSchema);
type FilterDecision = z.infer<typeof FilterDecisionSchema>;

interface EnrichedSearchResult extends SearchResult {
  article: ArticleExtraction;
}

interface ScoredSearchResult extends EnrichedSearchResult {
  sourceAssessment: SourceAssessment;
}

interface State {
  lastRunAt: string | null;
  seenUrls: Record<string, string>;
}

async function loadState(statePath: string): Promise<State> {
  const stored = await loadKvJson<Partial<State>>(NEWS_STATE_STORE_KEY);
  if (stored !== null) {
    return {
      lastRunAt: typeof stored.lastRunAt === 'string' ? stored.lastRunAt : null,
      seenUrls: stored.seenUrls && typeof stored.seenUrls === 'object' ? stored.seenUrls : {},
    };
  }

  try {
    const raw = await fs.readFile(statePath, 'utf8');
    const parsed = JSON.parse(raw);
    const state = {
      lastRunAt: typeof parsed.lastRunAt === 'string' ? parsed.lastRunAt : null,
      seenUrls: parsed.seenUrls && typeof parsed.seenUrls === 'object' ? parsed.seenUrls : {},
    };
    await saveState(state);
    return state;
  } catch {
    return { lastRunAt: null, seenUrls: {} };
  }
}

async function saveState(state: State): Promise<void> {
  await saveKvJson(NEWS_STATE_STORE_KEY, state);
}

function pruneSeenUrls(seen: Record<string, string>, nowMs: number, seenTtlMs: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [url, ts] of Object.entries(seen)) {
    const tsMs = Date.parse(ts);
    if (!Number.isNaN(tsMs) && nowMs - tsMs < seenTtlMs) {
      out[url] = ts;
    }
  }
  return out;
}

async function fetchNews(params: NewsDigestParams): Promise<SearchResult[]> {
  const all = new Map<string, SearchResult>();
  for (const q of params.queries) {
    console.log(`[NewsDigest] Google CSE query: "${q}"`);
    const results = await searchGoogle(q, {
      num: params.maxResultsPerQuery,
      dateRestrict: params.dateRestrict,
      sort: 'date',
    });
    for (const r of results) {
      if (!all.has(r.link)) all.set(r.link, r);
    }
  }
  return [...all.values()];
}

function extractJsonArray(text: string): unknown {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON array found in LLM output');
  }
  return JSON.parse(text.slice(start, end + 1));
}

const FILTER_SYSTEM =
  'You are a strict news filter. You output only valid JSON arrays. ' +
  'You never invent URLs; you only use URLs present verbatim in the provided input.';

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function safeTitle(title: string): string {
  return title.trim().slice(0, 200) || 'Untitled search result';
}

function safeShortDesc(text: string): string {
  return text.trim().slice(0, 400) || 'No snippet available from the search result.';
}

function buildFilterPrompt(results: ScoredSearchResult[], interests: string[]): string {
  const list = results
    .map((r, i) => {
      const article = getArticleContext(r);
      const source = r.sourceAssessment;
      return (
        `[${i + 1}] source: ${article.sourceHost || 'unknown'}\n` +
        `    sourceScore: ${source.score}\n` +
        `    sourceLabel: ${source.label}\n` +
        `    sourceReasons: ${source.reasons.join(' ') || '(none)' }\n` +
        `    url: ${r.link}\n` +
        `    searchTitle: ${r.title}\n` +
        `    searchSnippet: ${r.snippet}\n` +
        `    pageFetched: ${article.fetched ? 'yes' : 'no'}\n` +
        `    pageTitle: ${article.title || '(none)'}\n` +
        `    pageDescription: ${article.description || '(none)'}\n` +
        `    pageContentExcerpt: ${article.content ? article.content.slice(0, 1000) : '(none)'}\n` +
        `    pageFetchError: ${article.error || '(none)'}`
      );
    })
    .join('\n\n');
  const interestList = interests
    .map((interest) => interest.trim())
    .filter(Boolean)
    .map((interest) => `- ${interest}`)
    .join('\n');

  return `Review EVERY search result for a personal news digest.

Selected interests:
${interestList || '- Current events'}

Queue ONLY items that are genuinely newsworthy:
- Timely, factual stories that match at least one selected interest
- Clear updates, announcements, original reporting, research, analysis, launches, market moves, or public decisions
- NOT opinion pieces, listicles, vendor marketing, generic career advice, old recaps, or items unrelated to the selected interests

Reject items that are low-quality, off-topic, unsafe to summarize, repetitive, or weak as digest material.

Output one JSON object for every input URL, using this schema:
- Queue: {"url":"<copied verbatim>","action":"queue","reason":"<why this deserves the digest>","title":"<concise title <= 100 chars>","shortDesc":"<1-2 factual sentences <= 200 chars>"}
- Reject: {"url":"<copied verbatim>","action":"reject","reason":"<short rejection reason>"}

Rules:
- Return exactly ${results.length} objects.
- Never invent URLs.
- Keep reasons brief and concrete.
- For rejected items, do not include title or shortDesc.
- Prefer the fetched page title, description, and content excerpt over the search snippet when they are available.
- If page fetching failed, you may still queue the item only when the search result itself is clearly strong enough.
- Treat higher source scores as more trustworthy. Be much more skeptical of borderline items from medium or low-scoring sources.

Respond with ONLY a JSON array, nothing else.

Input results:

${list}`;
}

interface FilterResult {
  queued: Array<{
    result: SearchResult;
    title: string;
    shortDesc: string;
    reason: string;
  }>;
  rejected: Array<{
    result: SearchResult;
    reason: string;
  }>;
  droppedHallucinated: number;
  undecidedCount: number;
}

async function filterWithLLM(
  modelId: string,
  candidates: ScoredSearchResult[],
  interests: string[],
): Promise<FilterResult> {
  const modelOption = findModel(modelId);
  if (!modelOption) {
    throw new Error(`Unknown model: ${modelId}`);
  }

  const { text } = await generateText({
    model: getChatModel(modelOption),
    system: FILTER_SYSTEM,
    // /no_think disables Qwen3's extended thinking mode so it outputs JSON directly
    // instead of reasoning through the task in a <think> block and leaving text empty.
    // Other models ignore this prefix.
    prompt: '/no_think\n' + buildFilterPrompt(candidates, interests),
    timeout: FILTER_TIMEOUT_MS,
  });

  let raw: unknown;
  try {
    raw = extractJsonArray(text);
  } catch (err) {
    const preview = text.length > 3000 ? text.slice(0, 3000) + `\n… (truncated, total ${text.length} chars)` : text;
    console.log('[NewsDigest] LLM parse error — raw output follows:\n--- LLM OUTPUT BEGIN ---\n' + preview + '\n--- LLM OUTPUT END ---');
    throw new Error(`LLM output is not a JSON array: ${err instanceof Error ? err.message : err}`);
  }

  const parsed = FilterDecisionArraySchema.parse(raw);
  const allowed = new Set(candidates.map((c) => c.link));
  const decisions = parsed.filter((item) => allowed.has(item.url));
  const droppedHallucinated = parsed.length - decisions.length;
  if (droppedHallucinated > 0) {
    console.warn(`[NewsDigest] Dropped ${droppedHallucinated} items with URLs not in input (hallucinated).`);
  }

  const decisionsByUrl = new Map<string, FilterDecision>();
  for (const decision of decisions) {
    decisionsByUrl.set(decision.url, decision);
  }

  const queued: FilterResult['queued'] = [];
  const rejected: FilterResult['rejected'] = [];
  let undecidedCount = 0;

  for (const candidate of candidates) {
    const decision = decisionsByUrl.get(candidate.link);
    if (!decision) {
      rejected.push({
        result: candidate,
        reason: 'Filter model returned no decision for this item.',
      });
      undecidedCount += 1;
      continue;
    }

    if (decision.action === 'queue') {
      if (!decision.title || !decision.shortDesc) {
        rejected.push({
          result: candidate,
          reason: 'Filter model selected the item without complete digest fields.',
        });
        undecidedCount += 1;
        continue;
      }

      queued.push({
        result: candidate,
        title: decision.title,
        shortDesc: decision.shortDesc,
        reason: decision.reason,
      });
      continue;
    }

    rejected.push({
      result: candidate,
      reason: decision.reason,
    });
  }

  return { queued, rejected, droppedHallucinated, undecidedCount };
}

export async function runNewsDigest(modelId: string, params: NewsDigestParams = DEFAULT_NEWS_DIGEST_PARAMS): Promise<{ summary: string; itemCount: number }> {
  // The slow phases (fetchNews, enrichCandidates, filterWithLLM) run *without* the
  // queue lock so they don't block dashboard approvals, publisher jobs, or other
  // Item Bus writers for the entire run. We snapshot the queue once for dedup
  // decisions, then re-acquire the lock briefly at the end to merge and save —
  // re-checking against the *current* queue inside the lock so concurrent writers
  // can't get clobbered.
  const storeDir = config.newsStoreDir;
  const statePath = path.join(storeDir, 'state.json');
    const nowIso = new Date().toISOString();
    const nowMs = Date.parse(nowIso);
    const digestRunId = newsRunFileForRanAt(nowIso);

    const state = await loadState(statePath);
    const sourceRules = await loadSourceQualityRules();
    const seenTtlMs = params.seenTtlHours * 60 * 60 * 1000;
    const prunedSeen = pruneSeenUrls(state.seenUrls, nowMs, seenTtlMs);

    const existingQueue = pruneQueue(await loadQueue(), nowMs);
    const knownUrls = new Set(
      [...Object.keys(prunedSeen), ...existingQueue.map((item) => item.url)]
        .map((url) => canonicalizeUrl(url))
        .filter(Boolean),
    );
    const knownTitles = new Set(
      existingQueue
        .map((item) => normalizeTitle(item.title))
        .filter((title) => title.length > 0),
    );
    const existingReferences: DuplicateReference[] = existingQueue.map((item) => ({
      title: item.title,
      url: item.url,
      origin: 'existing',
    }));

    const fetched = await fetchNews(params);
    console.log(`[NewsDigest] Fetched ${fetched.length} unique results.`);

    const candidates: SearchResult[] = [];
    const seenItems: QueueItem[] = [];
    let duplicateUrlCount = 0;
    let duplicateTitleCount = 0;

    for (const result of fetched) {
      const canonicalUrl = canonicalizeUrl(result.link);
      if (canonicalUrl && knownUrls.has(canonicalUrl)) {
        duplicateUrlCount += 1;
        continue;
      }

      const normalizedTitle = normalizeTitle(result.title);
      if (normalizedTitle && knownTitles.has(normalizedTitle)) {
        duplicateTitleCount += 1;
        seenItems.push(createQueueItem({
          title: safeTitle(result.title),
          shortDesc: safeShortDesc(result.snippet),
          url: result.link,
          addedAt: nowIso,
          state: 'seen',
          stateChangedAt: nowIso,
          stateReason: 'Skipped because a similar title is already in the local item ledger.',
          rejectionReason: 'Duplicate normalized title matched an existing item.',
          ...newsProducerHeader(),
          payload: { digestRunId, source: { host: safeHost(result.link) } },
        }));
        if (canonicalUrl) {
          knownUrls.add(canonicalUrl);
        }
        continue;
      }

      candidates.push(result);
      if (normalizedTitle) {
        knownTitles.add(normalizedTitle);
      }
      if (canonicalUrl) {
        knownUrls.add(canonicalUrl);
      }
    }
    console.log(`[NewsDigest] ${candidates.length} candidates after seen-URL and queue dedup.`);

    const candidatesWithArticles = await enrichCandidates(candidates);
    const articleFetchSuccessCount = candidatesWithArticles.filter((item) => item.article.fetched).length;
    const articleFetchFailureCount = candidatesWithArticles.length - articleFetchSuccessCount;
    console.log(
      `[NewsDigest] Article fetch: ${articleFetchSuccessCount} ok, ${articleFetchFailureCount} failed.`,
    );

    const scoredCandidates: ScoredSearchResult[] = [];
    const sourceRejected: QueueItem[] = [];
    let sourceQualifiedCount = 0;
    let allowlistedCount = 0;
    let blockedSourceCount = 0;
    let lowScoreRejectedCount = 0;

    for (const candidate of candidatesWithArticles) {
      const sourceAssessment = assessSourceQuality(
        {
          url: candidate.link,
          title: candidate.title,
          snippet: candidate.snippet,
          article: candidate.article,
        },
        sourceRules,
      );

      if (sourceAssessment.allowlisted) {
        allowlistedCount += 1;
      }

      if (sourceAssessment.blocked) {
        blockedSourceCount += 1;
        sourceRejected.push(createQueueItem({
          title: safeTitle(candidate.title),
          shortDesc: safeShortDesc(candidate.snippet),
          url: candidate.link,
          addedAt: nowIso,
          state: 'rejected',
          stateChangedAt: nowIso,
          stateReason: `Blocked by source policy: ${summarizeSourceAssessment(sourceAssessment)}`,
          rejectionReason: `Blocked by source policy: ${summarizeSourceAssessment(sourceAssessment)}`,
          ...queueProvenance({ ...candidate, sourceAssessment }, digestRunId),
        }));
        continue;
      }

      if (!sourceAssessment.allowlisted && sourceAssessment.score < sourceRules.minScore) {
        lowScoreRejectedCount += 1;
        sourceRejected.push(createQueueItem({
          title: safeTitle(candidate.title),
          shortDesc: safeShortDesc(candidate.snippet),
          url: candidate.link,
          addedAt: nowIso,
          state: 'rejected',
          stateChangedAt: nowIso,
          stateReason: `Rejected for low source quality: ${summarizeSourceAssessment(sourceAssessment)}`,
          rejectionReason: `Rejected for low source quality: ${summarizeSourceAssessment(sourceAssessment)}`,
          ...queueProvenance({ ...candidate, sourceAssessment }, digestRunId),
        }));
        continue;
      }

      sourceQualifiedCount += 1;
      scoredCandidates.push({
        ...candidate,
        sourceAssessment,
      });
    }
    console.log(
      `[NewsDigest] Source quality: ${sourceQualifiedCount} passed, ${blockedSourceCount} blocked, ${lowScoreRejectedCount} low-score rejected.`,
    );

    const dedupedCandidates: ScoredSearchResult[] = [];
    const nearDuplicateSeen: QueueItem[] = [];
    let nearDuplicateCount = 0;
    const dedupReferences: DuplicateReference[] = [...existingReferences];

    for (const candidate of scoredCandidates
      .slice()
      .sort((left, right) => candidateDedupRank(right) - candidateDedupRank(left))) {
      const match = findNearDuplicateMatch(
        {
          title: candidate.article.title || candidate.title,
          url: candidate.article.finalUrl || candidate.link,
          origin: 'candidate',
        },
        dedupReferences,
      );

      if (match) {
        nearDuplicateCount += 1;
        nearDuplicateSeen.push(createQueueItem({
          title: safeTitle(candidate.article.title || candidate.title),
          shortDesc: safeShortDesc(candidate.article.description || candidate.snippet),
          url: candidate.link,
          addedAt: nowIso,
          state: 'seen',
          stateChangedAt: nowIso,
          stateReason: limitReason(
            `Skipped as near-duplicate: ${match.detail} Stronger version already kept.`,
          ),
          rejectionReason: limitReason(`Near-duplicate story: ${match.detail}`),
          ...queueProvenance(candidate, digestRunId),
        }));
        continue;
      }

      dedupedCandidates.push(candidate);
      dedupReferences.push({
        title: candidate.article.title || candidate.title,
        url: candidate.article.finalUrl || candidate.link,
        origin: 'candidate',
      });
    }
    console.log(
      `[NewsDigest] Near-duplicates: ${nearDuplicateCount} skipped, ${dedupedCandidates.length} unique candidates remain.`,
    );

    const llmCandidates = dedupedCandidates.slice(0, params.maxLlmCandidates);
    if (llmCandidates.length < dedupedCandidates.length) {
      console.log(
        `[NewsDigest] Capped candidates from ${dedupedCandidates.length} to ${llmCandidates.length} for LLM filter.`,
      );
    }

    let queuedItems: FilterResult['queued'] = [];
    let rejectedItems: FilterResult['rejected'] = [];
    let droppedHallucinated = 0;
    let undecidedCount = 0;
    if (llmCandidates.length > 0) {
      const result = await filterWithLLM(modelId, llmCandidates, params.queries);
      queuedItems = result.queued;
      rejectedItems = result.rejected;
      droppedHallucinated = result.droppedHallucinated;
      undecidedCount = result.undecidedCount;
    }

    const llmCandidateByLink = new Map(llmCandidates.map((item) => [item.link, item]));
    const added: QueueItem[] = queuedItems.map((decision) => {
      const candidate = requireScoredCandidate(llmCandidateByLink, decision.result.link);
      return createQueueItem({
        title: decision.title,
        shortDesc: decision.shortDesc,
        url: decision.result.link,
        addedAt: nowIso,
        state: 'queued',
        stateChangedAt: nowIso,
        stateReason: `${decision.reason} ${summarizeSourceAssessment(candidate.sourceAssessment)}`,
        selectionReason: decision.reason,
        ...queueProvenance(candidate, digestRunId),
      });
    });
    const rejected: QueueItem[] = rejectedItems.map((decision) => {
      const candidate = requireScoredCandidate(llmCandidateByLink, decision.result.link);
      return createQueueItem({
        title: safeTitle(decision.result.title),
        shortDesc: safeShortDesc(decision.result.snippet),
        url: decision.result.link,
        addedAt: nowIso,
        state: 'rejected',
        stateChangedAt: nowIso,
        stateReason: `${decision.reason} ${summarizeSourceAssessment(candidate.sourceAssessment)}`,
        rejectionReason: decision.reason,
        ...queueProvenance(candidate, digestRunId),
      });
    });
    const computedNewItems = [
      ...seenItems,
      ...nearDuplicateSeen,
      ...sourceRejected,
      ...rejected,
      ...added,
    ];

    const runFile: Omit<NewsRunRecord, 'file'> = {
      ranAt: nowIso,
      fetchedCount: fetched.length,
      candidateCount: candidates.length,
      articleFetchSuccessCount,
      articleFetchFailureCount,
      sourceQualifiedCount,
      allowlistedCount,
      blockedSourceCount,
      lowScoreRejectedCount,
      queuedCount: added.length,
      rejectedCount: sourceRejected.length + rejected.length,
      seenCount: seenItems.length + nearDuplicateSeen.length,
      duplicateUrlCount,
      duplicateTitleCount,
      nearDuplicateCount,
      droppedHallucinated,
      undecidedCount,
    };

    // Write phase. Re-read the queue inside the lock so any items another writer
    // (publisher, dashboard approval, consumer worker) added during our slow work
    // survive the merge. We dedupe by canonical URL — anything we computed that's
    // already in the queue now is dropped.
    const { mergedAdded, mergedSummary } = await withQueueLock(async () => {
      const currentQueue = pruneQueue(await loadQueue(), Date.now());
      const currentUrls = new Set(
        currentQueue.map((item) => canonicalizeUrl(item.url)).filter(Boolean),
      );
      const currentTitles = new Set(
        currentQueue.map((item) => normalizeTitle(item.title)).filter((t) => t.length > 0),
      );

      const isAlreadyInQueue = (item: QueueItem) => {
        const canonical = canonicalizeUrl(item.url);
        if (canonical && currentUrls.has(canonical)) return true;
        const normalized = normalizeTitle(item.title);
        if (normalized && currentTitles.has(normalized)) return true;
        return false;
      };

      const filteredNewItems = computedNewItems.filter((item) => !isAlreadyInQueue(item));
      const newAdded = added.filter((item) => !isAlreadyInQueue(item));

      const newQueue = [...currentQueue, ...filteredNewItems];

      const currentState = await loadState(statePath);
      const mergedSeenUrls: Record<string, string> = {
        ...pruneSeenUrls(currentState.seenUrls, Date.now(), seenTtlMs),
      };
      for (const item of filteredNewItems) {
        mergedSeenUrls[item.url] = item.stateChangedAt;
      }
      const newState: State = { lastRunAt: nowIso, seenUrls: mergedSeenUrls };

      await saveNewsRun(runFile);
      await saveQueue(newQueue);
      await saveState(newState);

      const pending = newQueue.filter((item) => item.state === 'queued').length;
      const summary =
        newAdded.length === 0
          ? `News digest: nessuna novità aggiunta (${candidates.length} articoli valutati, ${sourceRejected.length + rejected.length} scartati, ${seenItems.length + nearDuplicateSeen.length} già visti, ${pending} in coda).`
          : `News digest: +${newAdded.length} in coda (${sourceRejected.length + rejected.length} scartati, ${seenItems.length + nearDuplicateSeen.length} già visti, ${pending} in attesa di pubblicazione)\n\n` +
            newAdded
              .slice(0, params.maxTelegramItems)
              .map((it) => `• ${it.title}\n  ${it.shortDesc}\n  motivo: ${it.selectionReason}\n  ${it.url}`)
            .join('\n\n') +
            (newAdded.length > params.maxTelegramItems ? `\n\n…e altri ${newAdded.length - params.maxTelegramItems}.` : '');

      return { mergedAdded: newAdded, mergedSummary: summary };
    });

    return { summary: mergedSummary, itemCount: mergedAdded.length };
}

function candidateDedupRank(candidate: ScoredSearchResult): number {
  const article = candidate.article;
  return (
    candidate.sourceAssessment.score * 1000 +
    (candidate.sourceAssessment.allowlisted ? 400 : 0) +
    (article.fetched ? 120 : 0) +
    Math.min(article.content.length, 2000) / 10 +
    Math.min((article.title || candidate.title).length, 120)
  );
}

function requireScoredCandidate(
  candidates: Map<string, ScoredSearchResult>,
  link: string,
): ScoredSearchResult {
  const candidate = candidates.get(link);
  if (!candidate) {
    throw new Error(`Could not find scored candidate for ${link}`);
  }
  return candidate;
}

function queueProvenance(candidate: ScoredSearchResult, digestRunId: string): Partial<QueueItem> {
  const article = getArticleContext(candidate);
  const source = candidate.sourceAssessment;

  const sourceHost = source.host || article.sourceHost || safeHost(candidate.link);
  const sourceReasons = source.reasons.slice(0, 8).map((reason) => reason.slice(0, 300));
  const articleTitle = optionalText(article.title, 300);
  const articleDescription = optionalText(article.description, 500);
  const articleExcerpt = optionalText(article.content, 10000);
  const articleFinalUrl = safeUrl(article.finalUrl);

  return {
    ...newsProducerHeader(),
    payload: {
      digestRunId,
      source: {
        host: sourceHost,
        score: source.score,
        label: source.label,
        reasons: sourceReasons,
      },
      article: {
        fetched: article.fetched,
        title: articleTitle,
        description: articleDescription,
        excerpt: articleExcerpt,
        finalUrl: articleFinalUrl,
      },
    },
  };
}

async function enrichCandidates(candidates: SearchResult[]): Promise<EnrichedSearchResult[]> {
  const results: EnrichedSearchResult[] = [];

  for (let start = 0; start < candidates.length; start += ARTICLE_FETCH_CONCURRENCY) {
    const batch = candidates.slice(start, start + ARTICLE_FETCH_CONCURRENCY);
    const enrichedBatch = await Promise.all(
      batch.map(async (candidate) => ({
        ...candidate,
        article: await fetchArticle(candidate.link),
      })),
    );
    results.push(...enrichedBatch);
  }

  return results;
}

function getArticleContext(result: EnrichedSearchResult): ArticleExtraction {
  return (
    result.article ?? {
      sourceUrl: result.link,
      finalUrl: result.link,
      sourceHost: safeHost(result.link),
      fetched: false,
      title: '',
      description: '',
      content: '',
      error: 'Article page was not fetched.',
    }
  );
}

function safeHost(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function safeUrl(value: string): string | undefined {
  try {
    return new URL(value).toString();
  } catch {
    return undefined;
  }
}

function optionalText(value: string, maxLength: number): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 3)}...` : trimmed;
}

function limitReason(value: string): string {
  return value.length > 380 ? `${value.slice(0, 377)}...` : value;
}
