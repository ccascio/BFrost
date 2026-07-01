import { promises as fs } from 'fs';
import path from 'path';
import { generateText } from 'ai';
import { z } from 'zod';
import { getChatModel } from '../../../llm';
import { config, findModel } from '../../../config';
import {
  loadQueue,
  markQueueItemDuplicateRejected,
  markQueueItemPostFailed,
  markQueueItemPosted,
  saveQueue,
  pruneQueue,
  withQueueLock,
  QueueItem,
} from '../../../jobs/queue';
import { setConsumerMetadata } from '../../../jobs/item-bus';
import { postTweet, validateXConfig, TweetPostError } from './x-client';
import { recordEventSafe } from '../../../event-log';
import { loadKvJson } from '../../../sqlite';
import { canonicalizeUrl } from '../news/near-duplicates';

export const TweetPostParamsSchema = z.object({
  signature: z.string().catch(''),
  maxContentLength: z.number().int().min(1).max(280).catch(250),
  eligibilityWindowHours: z.number().int().min(1).max(168).catch(72),
  maxAttempts: z.number().int().min(1).max(10).catch(3),
  maxLlmCandidates: z.number().int().min(1).max(20).catch(5),
});
export type TweetPostParams = z.infer<typeof TweetPostParamsSchema>;
export const DEFAULT_TWEET_POST_PARAMS: TweetPostParams = TweetPostParamsSchema.parse({});
export function resolveTweetPostParams(raw: unknown): TweetPostParams {
  if (typeof raw !== 'object' || raw === null) return DEFAULT_TWEET_POST_PARAMS;
  return TweetPostParamsSchema.parse(raw);
}

const SELECTOR_TIMEOUT_MS = config.jobLlmTimeoutMs;
const ADMIN_SETTINGS_STORE_KEY = 'admin.settings';
const X_MAX_CHARS = 280;
const TWEET_POST_EVENT_METADATA = {
  workerId: 'core.publisher.x',
  workerName: 'X Publisher',
  job: 'tweet-post',
} as const;
export const DEFAULT_TWEET_POST_PROMPT = `Pick ONE item from the list below — the one most likely to resonate on X — and write a tweet for it.

Constraints for the tweet text:
- Max {maxContentLength} characters. The system will append "{signature}" automatically; do NOT include it yourself.
- Do NOT include URLs, links, or @mentions.
- Avoid hashtags unless they genuinely add reach.
- Choose exactly one tone:
  - "factual": neutral, informative
  - "witty": light, punchy, dry humor
  - "provocative": sharp take that invites debate (use ONLY when the news genuinely warrants it)
- Never attack individuals, invoke protected-class references, or write content that risks account suspension.

EXCLUDE items on these topics (never write about them):
- US/EU elections, partisan politics, culture-war topics
- Religion or religious conflicts
- Active geopolitical conflicts (e.g. Israel–Palestine, Russia–Ukraine)
- Celebrity gossip unrelated to tech

Output ONLY one of these JSON objects, nothing else:
- To post: {"itemNumber": <number copied from the selected item>, "url": "<copied verbatim from the selected item>", "tone": "factual|witty|provocative", "text": "<tweet body>"}
- To skip (if EVERY item is on an excluded topic, or none are worth posting): {"skip": "<brief reason>"}

Items:

{items}`;

const ToneEnum = z.enum(['factual', 'witty', 'provocative']);
const RawWrittenTweetSchema = z.object({
  itemNumber: z.number().int().positive().optional(),
  url: z.string().url().optional(),
  tone: ToneEnum,
  text: z.string().min(1),
}).refine((value) => value.itemNumber !== undefined || value.url !== undefined, {
  message: 'Either itemNumber or url is required.',
});
const SkipSchema = z.object({
  skip: z.string().min(1),
});
const ResponseSchema = z.union([RawWrittenTweetSchema, SkipSchema]);
type RawWrittenTweet = z.infer<typeof RawWrittenTweetSchema>;
interface WrittenTweet {
  url: string;
  tone: z.infer<typeof ToneEnum>;
  text: string;
}
type TweetSelection = WrittenTweet | z.infer<typeof SkipSchema>;

interface TweetPostSettings {
  approvalRequired: boolean;
  prompt: string;
}

interface StoredAdminSettings {
  jobs?: {
    'tweet-post'?: {
      approvalRequired?: boolean;
      prompt?: string;
    };
  };
}

const FILTER_SYSTEM =
  'You are a social media writer. ' +
  'You pick the single most viral news item from a list and write ONE tweet for it. ' +
  'You output only valid JSON.';

async function loadTweetPostSettings(): Promise<TweetPostSettings> {
  const stored = await loadKvJson<StoredAdminSettings>(ADMIN_SETTINGS_STORE_KEY);
  const storedJob = stored?.jobs?.['tweet-post'];
  if (storedJob) {
    return {
      approvalRequired: storedJob.approvalRequired ?? true,
      prompt:
        typeof storedJob.prompt === 'string' && storedJob.prompt.trim()
          ? storedJob.prompt
          : DEFAULT_TWEET_POST_PROMPT,
    };
  }

  const settingsPath = path.join(config.adminStoreDir, 'settings.json');
  try {
    const raw = await fs.readFile(settingsPath, 'utf8');
    const parsed = JSON.parse(raw) as {
      jobs?: {
        'tweet-post'?: {
          approvalRequired?: boolean;
          prompt?: string;
        };
      };
    };
    const job = parsed.jobs?.['tweet-post'];
    return {
      approvalRequired: job?.approvalRequired ?? true,
      prompt: typeof job?.prompt === 'string' && job.prompt.trim() ? job.prompt : DEFAULT_TWEET_POST_PROMPT,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[TweetPost] Failed to read tweet-post settings; using safe defaults:', err);
    }
    return { approvalRequired: true, prompt: DEFAULT_TWEET_POST_PROMPT };
  }
}

function buildSelectorPrompt(items: QueueItem[], template: string, params: TweetPostParams): string {
  const list = items
    .map((it, i) => `[${i + 1}] itemNumber: ${i + 1}\n    url: ${it.url}\n    title: ${it.title}\n    shortDesc: ${it.shortDesc}`)
    .join('\n\n');
  const prompt = template
    .split('{items}').join(list)
    .split('{maxContentLength}').join(String(params.maxContentLength))
    .split('{signature}').join(params.signature);
  const withItems = prompt.includes(list) ? prompt : `${prompt.trim()}\n\nItems:\n\n${list}`;
  return `${withItems.trim()}\n\nSelection safety rule: choose by itemNumber when possible. If you include a URL, copy it exactly from the selected item.`;
}

function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in LLM output');
  }
  return JSON.parse(text.slice(start, end + 1));
}

function isEligible(item: QueueItem, nowMs: number, approvalRequired: boolean, params: TweetPostParams): boolean {
  const publishableState = approvalRequired ? item.state === 'approved' || item.state === 'failed' : item.state === 'queued' || item.state === 'approved' || item.state === 'failed';
  if (!publishableState) return false;
  if ((item.attemptCount ?? 0) >= params.maxAttempts) return false;
  const added = Date.parse(item.addedAt);
  if (Number.isNaN(added)) return false;
  return nowMs - added < params.eligibilityWindowHours * 60 * 60 * 1000;
}

export async function hasTweetPostWork(params: TweetPostParams = DEFAULT_TWEET_POST_PARAMS): Promise<boolean> {
  const nowMs = Date.now();
  const settings = await loadTweetPostSettings();
  const queue = pruneQueue(await loadQueue(), nowMs);
  return queue.some((item) => isEligible(item, nowMs, settings.approvalRequired, params));
}

function codePointLength(text: string): number {
  return [...text].length;
}

export function buildTweetSignature(defaultSignature: string): string {
  return defaultSignature;
}

export function fitTweetText(body: string, signature: string, maxLength = X_MAX_CHARS): string {
  const fullText = body + signature;
  if (codePointLength(fullText) <= maxLength) return fullText;

  const available = maxLength - codePointLength(signature);
  if (available <= 1) {
    return signature.slice(0, maxLength);
  }

  const chars = [...body.trim()];
  if (chars.length <= available) return body.trim() + signature;
  const clipped = chars.slice(0, Math.max(0, available - 1)).join('').replace(/\s+\S*$/, '').trimEnd();
  return `${clipped || chars.slice(0, available - 1).join('').trimEnd()}…${signature}`;
}

export function resolveSelectedCandidate(
  selection: Pick<RawWrittenTweet, 'itemNumber' | 'url'>,
  candidates: QueueItem[],
): QueueItem | null {
  if (selection.itemNumber !== undefined) {
    const byNumber = candidates[selection.itemNumber - 1];
    if (byNumber) {
      return byNumber;
    }
  }

  if (!selection.url) {
    return null;
  }

  const exact = candidates.find((candidate) => candidate.url === selection.url);
  if (exact) {
    return exact;
  }

  const selectedCanonical = canonicalizeUrl(selection.url);
  if (!selectedCanonical) {
    return null;
  }

  return candidates.find((candidate) => canonicalizeUrl(candidate.url) === selectedCanonical) ?? null;
}

async function chooseAndWrite(
  modelId: string,
  candidates: QueueItem[],
  promptTemplate: string,
  params: TweetPostParams,
): Promise<TweetSelection> {
  const modelOption = findModel(modelId);
  if (!modelOption) {
    throw new Error(`Unknown model: ${modelId}`);
  }

  const { text } = await generateText({
    model: getChatModel(modelOption),
    system: FILTER_SYSTEM,
    // /no_think disables Qwen3's extended thinking mode. Other models ignore this prefix.
    prompt: '/no_think\n' + buildSelectorPrompt(candidates, promptTemplate, params),
    timeout: SELECTOR_TIMEOUT_MS,
  });

  let raw: unknown;
  try {
    raw = extractJsonObject(text);
  } catch (err) {
    const preview = text.length > 3000 ? text.slice(0, 3000) + `\n… (truncated, total ${text.length} chars)` : text;
    console.log('[TweetPost] LLM parse error — raw output follows:\n--- LLM OUTPUT BEGIN ---\n' + preview + '\n--- LLM OUTPUT END ---');
    throw new Error(`LLM output not a JSON object: ${err instanceof Error ? err.message : err}`);
  }

  const parsed = ResponseSchema.parse(raw);

  if ('skip' in parsed) {
    return parsed;
  }

  const selected = resolveSelectedCandidate(parsed, candidates);
  if (!selected) {
    const selectedRef = parsed.url ?? `itemNumber ${parsed.itemNumber}`;
    console.warn(`[TweetPost] LLM selected an item outside the candidate list: ${selectedRef}`);
    return { skip: `Selected item was not in the candidate list: ${selectedRef}` };
  }

  if (codePointLength(parsed.text) > params.maxContentLength) {
    throw new Error(
      `LLM tweet text is ${codePointLength(parsed.text)} chars, exceeds ${params.maxContentLength}.`,
    );
  }

  return {
    url: selected.url,
    tone: parsed.tone,
    text: parsed.text,
  };
}

function tweetUrl(id: string): string {
  const handle = config.xUsername || 'i';
  return `https://x.com/${handle}/status/${id}`;
}

export async function runTweetPost(modelId: string, params: TweetPostParams = DEFAULT_TWEET_POST_PARAMS): Promise<{ summary: string; itemCount: number }> {
  await validateXConfig();

  return withQueueLock(async () => {
    const nowIso = new Date().toISOString();
    const nowMs = Date.parse(nowIso);
    const settings = await loadTweetPostSettings();

    const queue = pruneQueue(await loadQueue(), nowMs);
    const eligible = queue.filter((it) => isEligible(it, nowMs, settings.approvalRequired, params));
    const pending = queue.filter((item) => item.state === 'queued').length;
    const approved = queue.filter((item) => item.state === 'approved').length;

    console.log(
      `[TweetPost] Queue: ${queue.length} total, ${eligible.length} eligible to post. Approval required: ${settings.approvalRequired ? 'yes' : 'no'}.`,
    );

    if (eligible.length === 0) {
      await saveQueue(queue);
      const reason = settings.approvalRequired
        ? `${pending} in coda, ${approved} approvati`
        : `${pending} in coda, nessuno nella finestra 72h`;
      return {
        summary: `Tweet job: nessun articolo pubblicabile (${reason}).`,
        itemCount: 0,
      };
    }

    const candidates = eligible
      .slice()
      .sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt))
      .slice(0, params.maxLlmCandidates);

    const written = await chooseAndWrite(modelId, candidates, settings.prompt, params);

    if ('skip' in written) {
      console.log(`[TweetPost] LLM skipped: ${written.skip}`);
      await saveQueue(queue);
      return {
        summary: `Tweet job: LLM ha scartato tutti gli articoli (${written.skip}). ${pending} in coda.`,
        itemCount: 0,
      };
    }

    const target = queue.find((it) => it.url === written.url);
    if (!target) {
      throw new Error('Selected URL disappeared from queue during processing.');
    }

    const signature = buildTweetSignature(params.signature);
    const tweetText = fitTweetText(written.text, signature);
    console.log(`[TweetPost] Tone: ${written.tone} | Length: ${codePointLength(tweetText)}`);
    console.log(`[TweetPost] Text: ${tweetText}`);

    let summary: string;
    try {
      const posted = await postTweet(tweetText);
      markQueueItemPosted(target, `Published to X in ${written.tone} tone.`);
      setConsumerMetadata(target, 'core.publisher.x', {
        tweetId: posted.id,
        tone: written.tone,
        postedAt: target.postedAt,
        tweetUrl: tweetUrl(posted.id),
      });
      await saveQueue(queue);
      await recordEventSafe({
        category: 'x',
        action: 'posted',
        summary: `Published tweet for queue item: ${target.title}`,
        metadata: {
          ...TWEET_POST_EVENT_METADATA,
          queueItemId: target.id,
          tweetId: posted.id,
          tone: written.tone,
          url: target.url,
        },
      });
      summary =
        `Tweet pubblicato (${written.tone}):\n` +
        `${tweetText}\n\n` +
        `Link: ${tweetUrl(posted.id)}`;
      return { summary, itemCount: 1 };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failedAt = new Date().toISOString();

      if (err instanceof TweetPostError && err.isDuplicate()) {
        markQueueItemDuplicateRejected(target, message, params.maxAttempts, failedAt);
        console.warn('[TweetPost] X rejected as duplicate content; marking item permanently skipped.');
        await saveQueue(queue);
        await recordEventSafe({
          category: 'x',
          action: 'duplicate_rejected',
          severity: 'warning',
          summary: `X rejected generated post as duplicate: ${target.title}`,
          metadata: { ...TWEET_POST_EVENT_METADATA, queueItemId: target.id, url: target.url },
        });
        return {
          summary: `Tweet job: X ha rifiutato il post come duplicato. Articolo marcato come non pubblicabile.\n${target.title}`,
          itemCount: 0,
        };
      }

      markQueueItemPostFailed(target, message, params.maxAttempts, failedAt);
      await saveQueue(queue);
      await recordEventSafe({
        category: 'x',
        action: 'post_failed',
        severity: 'error',
        summary: `Tweet posting failed for queue item: ${target.title}`,
        metadata: {
          ...TWEET_POST_EVENT_METADATA,
          queueItemId: target.id,
          url: target.url,
          error: message,
          attemptCount: target.attemptCount,
        },
      });
      throw err;
    }
  });
}
