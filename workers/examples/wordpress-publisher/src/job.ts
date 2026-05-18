/**
 * WordPress publisher job — consumes news.article items and posts them.
 *
 * Flow:
 *   1. Pick the oldest queued/approved item this consumer has not handled.
 *   2. Generate the article body with the configured model + prompt.
 *   3. POST to WordPress via the REST API.
 *   4. Record the WP post id and link under metadata['local.publisher.wordpress'].
 */

import { generateText } from 'ai';
import {
  applyConsumerFailure,
  applyConsumerSuccess,
  findModel,
  getChatModel,
  listItemsForConsumer,
  loadQueue,
  openWorkerKv,
  recordEventSafe,
  saveQueue,
  withQueueLock,
  type QueueItem,
} from 'bfrost';
import { createPost, fetchCategories, fetchTags } from './wp-client.js';
import { CONSUMER_ID, loadWpSettings } from './settings.js';

const POST_STATUSES = ['publish', 'draft', 'pending', 'private', 'future'] as const;
type PostStatus = (typeof POST_STATUSES)[number];

function isPostStatus(value: string): value is PostStatus {
  return (POST_STATUSES as readonly string[]).includes(value);
}

interface NewsPayload {
  source?: { host?: string; label?: string };
  article?: { title?: string; description?: string; excerpt?: string; finalUrl?: string };
}

function newsPayload(item: QueueItem): NewsPayload {
  return (item.payload ?? {}) as NewsPayload;
}

function defaultPrompt(): string {
  return [
    'You are a careful content writer. Given a news source title, description, and excerpt,',
    'write a publication-ready article in clean HTML (use <p>, <h2>, <ul>, <strong> only).',
    '',
    'Style:',
    '- Direct, calm, factual. No hype. No SEO filler.',
    '- 400–700 words. Open with a one-sentence hook.',
    '- Stay grounded in the source material; do not invent vendor claims or statistics.',
    '- Close with a one-paragraph takeaway.',
    '',
    'Return ONLY the HTML body. No <html>, no <head>, no <body>, no markdown fences.',
  ].join('\n');
}

async function generateArticleBody(modelAlias: string, prompt: string, item: QueueItem): Promise<string> {
  const model = findModel(modelAlias);
  if (!model) {
    throw new Error(`WordPress publisher: model alias "${modelAlias}" not found.`);
  }
  const payload = newsPayload(item);
  const userBlock = [
    `Title: ${payload.article?.title ?? item.title}`,
    `Description: ${payload.article?.description ?? item.shortDesc}`,
    `Source URL: ${payload.article?.finalUrl ?? item.url}`,
    `Source host: ${payload.source?.host ?? ''}`,
    '',
    'Excerpt:',
    payload.article?.excerpt ?? '',
  ].join('\n');

  const result = await generateText({
    model: getChatModel(model) as Parameters<typeof generateText>[0]['model'],
    system: prompt,
    prompt: userBlock,
    temperature: 0.4,
  });
  const text = result.text?.trim();
  if (!text) throw new Error('WordPress publisher: model returned empty body.');
  return text;
}

interface CachedTerm {
  id: number;
  name: string;
  slug: string;
}

async function pickCategoryIds(kv: ReturnType<typeof openWorkerKv>, slugs: string[]): Promise<number[]> {
  if (slugs.length === 0) return [];
  const cached = (await kv.get<CachedTerm[]>('categories')) ?? [];
  const out: number[] = [];
  for (const slug of slugs) {
    const term = cached.find((t) => t.slug === slug);
    if (term) out.push(term.id);
  }
  return out;
}

async function pickTagIds(kv: ReturnType<typeof openWorkerKv>, slugs: string[]): Promise<number[]> {
  if (slugs.length === 0) return [];
  const cached = (await kv.get<CachedTerm[]>('tags')) ?? [];
  const out: number[] = [];
  for (const slug of slugs) {
    const term = cached.find((t) => t.slug === slug);
    if (term) out.push(term.id);
  }
  return out;
}

export async function refreshTaxonomies(): Promise<{ categories: number; tags: number }> {
  const settings = await loadWpSettings();
  if (!settings.baseUrl || !settings.username || !settings.applicationPassword) {
    throw new Error('WordPress publisher: settings incomplete — set base URL, username, and application password first.');
  }
  const kv = openWorkerKv(CONSUMER_ID);
  const auth = { baseUrl: settings.baseUrl, username: settings.username, applicationPassword: settings.applicationPassword };
  const [cats, tags] = await Promise.all([fetchCategories(auth), fetchTags(auth)]);
  await kv.set('categories', cats);
  await kv.set('tags', tags);
  await kv.set('taxonomies-refreshed-at', new Date().toISOString());
  return { categories: cats.length, tags: tags.length };
}

export async function runWordPressPublisher(): Promise<{ summary: string; status: 'ok' | 'noop' | 'failed' }> {
  const settings = await loadWpSettings();
  if (!settings.baseUrl || !settings.username || !settings.applicationPassword) {
    return { status: 'noop', summary: 'WordPress credentials missing — open Config and fill in base URL, username, and application password.' };
  }
  const status = isPostStatus(settings.defaultStatus) ? settings.defaultStatus : 'draft';
  const prompt = settings.prompt?.trim() ? settings.prompt : defaultPrompt();
  const kv = openWorkerKv(CONSUMER_ID);

  return await withQueueLock(async () => {
    const candidates = await listItemsForConsumer(CONSUMER_ID, {
      itemType: 'news.article',
      states: ['queued', 'approved'],
      excludeAlreadyHandled: true,
    });
    const target = candidates[0];
    if (!target) {
      return { status: 'noop', summary: 'No eligible news.article items to publish.' };
    }

    try {
      const body = await generateArticleBody(settings.modelAlias || 'default', prompt, target);
      const auth = { baseUrl: settings.baseUrl, username: settings.username, applicationPassword: settings.applicationPassword };
      const categories = await pickCategoryIds(kv, settings.categorySlugs);
      const tags = await pickTagIds(kv, settings.tagSlugs);
      const payload = newsPayload(target);
      const result = await createPost(auth, {
        title: payload.article?.title ?? target.title,
        content: body,
        excerpt: payload.article?.description ?? target.shortDesc,
        status,
        categories,
        tags,
      });

      const queue = await loadQueue();
      const live = queue.find((it) => it.id === target.id);
      if (live) {
        applyConsumerSuccess(live, CONSUMER_ID, {
          transition: status === 'publish' ? 'posted' : undefined,
          metadata: {
            postId: result.id,
            postUrl: result.link,
            postStatus: result.status,
            postSlug: result.slug,
            postedAt: new Date().toISOString(),
          },
        });
        await saveQueue(queue);
      }

      await recordEventSafe({
        type: 'wordpress.posted',
        message: `WordPress ${result.status}: ${result.link}`,
        metadata: { workerId: CONSUMER_ID, postId: result.id, status: result.status },
      });
      return { status: 'ok', summary: `Posted as ${result.status} → ${result.link}` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const queue = await loadQueue();
      const live = queue.find((it) => it.id === target.id);
      if (live) {
        applyConsumerFailure(live, CONSUMER_ID, { errorMessage: message, maxAttempts: 3 });
        await saveQueue(queue);
      }
      await recordEventSafe({
        type: 'wordpress.failed',
        message: `WordPress publish failed: ${message}`,
        metadata: { workerId: CONSUMER_ID },
      });
      return { status: 'failed', summary: message };
    }
  });
}
