import type { BackendWorkerModule } from '../../module';
import { loadQueue, type QueueItem } from '../../../jobs/queue';
import { loadKvJson } from '../../../sqlite';
import { financeNewsWorker } from './manifest';
import { FINANCE_NEWS_ITEM_TYPE } from './job';

interface FinanceNewsState {
  lastRunAt?: string | null;
}

function isFinanceNewsItem(item: QueueItem): boolean {
  return item.producerWorkerId === financeNewsWorker.id || item.itemType === FINANCE_NEWS_ITEM_TYPE;
}

function compactItem(item: QueueItem) {
  const payload = item.payload && typeof item.payload === 'object' ? item.payload : {};
  return {
    id: item.id,
    title: item.title,
    shortDesc: item.shortDesc,
    url: item.url,
    state: item.state,
    addedAt: item.addedAt,
    tags: item.tags ?? [],
    category: typeof payload.category === 'string' ? payload.category : null,
    tickers: Array.isArray(payload.tickers) ? payload.tickers.filter((ticker): ticker is string => typeof ticker === 'string') : [],
    relevanceReason: typeof payload.relevanceReason === 'string' ? payload.relevanceReason : item.selectionReason ?? null,
    sourceHost:
      payload.source && typeof payload.source === 'object' && typeof (payload.source as Record<string, unknown>).host === 'string'
        ? ((payload.source as Record<string, unknown>).host as string)
        : null,
  };
}

export const financeNewsModule: BackendWorkerModule = {
  manifest: financeNewsWorker,
  async loadDashboardData() {
    const [queue, state] = await Promise.all([
      loadQueue(),
      loadKvJson<FinanceNewsState>('finance-news.state'),
    ]);
    const recentItems = queue
      .filter(isFinanceNewsItem)
      .sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt))
      .slice(0, 30)
      .map(compactItem);
    return {
      lastRunAt: typeof state?.lastRunAt === 'string' ? state.lastRunAt : null,
      recentItems,
    };
  },
};
