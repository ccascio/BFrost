import type { StoreWorkerListing } from '../app-types';

export type StoreVisualWorker = Pick<StoreWorkerListing, 'id' | 'category' | 'tags'>;

export const STORE_VISUAL_RULES: Array<{ icon: string; keywords: string[] }> = [
  { icon: '📡', keywords: ['rss', 'feed', 'feeds', 'atom', 'reader'] },
  { icon: '🐘', keywords: ['fediverse', 'mastodon', 'activitypub', 'social'] },
  { icon: '📝', keywords: ['wordpress', 'publishing', 'publish', 'blog', 'cms', 'writer', 'write', 'post'] },
  { icon: '🤖', keywords: ['ai', 'llm', 'agent', 'assistant', 'model', 'automation'] },
  { icon: '🔔', keywords: ['notify', 'notification', 'alert', 'webhook', 'mail', 'message'] },
  { icon: '🔍', keywords: ['search', 'lookup', 'crawl', 'discover', 'index', 'knowledge'] },
];

export const STORE_PALETTE_COUNT = 8;

export function StoreWorkerLogo({
  worker,
  size = 'default',
  installed = false,
}: {
  worker: StoreVisualWorker;
  size?: 'default' | 'large';
  installed?: boolean;
}) {
  return (
    <span className={`store-worker-logo store-palette-${storePaletteIndex(worker.category)} ${size === 'large' ? 'large' : ''}`}>
      <span aria-hidden="true">{storeWorkerIcon(worker)}</span>
      {installed ? <span className="store-installed-badge" aria-label="Installed">✓</span> : null}
    </span>
  );
}

export function StoreTrustBadge({ trust }: { trust: string }) {
  const label = trust.trim() || 'Community';
  return <span className={`store-trust-badge ${storeTrustTone(label)}`}>{label}</span>;
}

export function storeWorkerIcon(worker: StoreVisualWorker): string {
  const signal = [worker.category, worker.id, ...worker.tags].join(' ').toLowerCase();
  return STORE_VISUAL_RULES.find((rule) => rule.keywords.some((keyword) => signal.includes(keyword)))?.icon ?? '📦';
}

export function storePaletteIndex(category: string): number {
  const label = storeCategoryLabel(category).toLowerCase();
  let hash = 0;
  for (const char of label) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % STORE_PALETTE_COUNT;
}

export function storeCategoryKey(category: string): string {
  return storeCategoryLabel(category).toLowerCase();
}

export function storeCategoryLabel(category: string): string {
  const label = category.trim();
  return label || 'General';
}

export function storeTrustTone(trust: string): 'review' | 'community' | 'verified' | 'trusted' | 'core' {
  const normalized = trust.trim().toLowerCase();
  if (normalized === 'review') return 'review';
  if (normalized === 'verified') return 'verified';
  if (normalized === 'trusted') return 'trusted';
  if (normalized === 'core') return 'core';
  return 'community';
}

export function storeAuthorHandle(author: string): string {
  const trimmed = author.trim();
  if (!trimmed) return 'Unknown author';
  if (trimmed.startsWith('@') || trimmed.includes(' ')) return trimmed;
  return `@${trimmed}`;
}
