/**
 * Public reader for the news producer's queue-item payload. Consumer workers
 * (publisher-x, future Mastodon/BlueSky/WordPress publishers) import this to
 * surface news-side fields in their own dashboard views. The producer's payload is
 * intentionally public — only its *metadata* namespace is private to news.
 */
import type { WorkerQueueItem } from '../../types';

export interface NewsItemSource {
  host?: string;
  score?: number;
  label?: string;
  reasons?: string[];
}

export interface NewsItemArticle {
  fetched?: boolean;
  title?: string;
  description?: string;
  excerpt?: string;
  finalUrl?: string;
}

export interface NewsItemPayload {
  digestRunId?: string;
  source?: NewsItemSource;
  article?: NewsItemArticle;
}

export function newsItemPayload(item: WorkerQueueItem): NewsItemPayload {
  return (item.payload ?? {}) as NewsItemPayload;
}

export function newsItemSourceLabel(item: WorkerQueueItem): string {
  const source = newsItemPayload(item).source;
  if (typeof source?.score !== 'number') return 'n/a';
  return source.label ? `${source.score} (${source.label})` : String(source.score);
}

export function newsItemSourceHost(item: WorkerQueueItem): string | undefined {
  return newsItemPayload(item).source?.host;
}

export function newsItemDigestRunId(item: WorkerQueueItem): string | undefined {
  return newsItemPayload(item).digestRunId;
}

export function newsItemArticleTitle(item: WorkerQueueItem): string | undefined {
  return newsItemPayload(item).article?.title;
}
