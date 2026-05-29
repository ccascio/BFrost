import type { BackendWorkerModule } from '../../module';
import { loadQueue, type QueueItem } from '../../../jobs/queue';
import { financeAnalystWorker } from './manifest';

const CONSUMER_ID = 'core.finance-analyst';
const SUBSCRIBES_TO = 'finance.news';

function isFinanceNewsItem(item: QueueItem): boolean {
  return item.itemType === SUBSCRIBES_TO;
}

function analysisOf(item: QueueItem): Record<string, unknown> | null {
  const metadata = item.metadata?.[CONSUMER_ID];
  return metadata && typeof metadata === 'object' ? metadata : null;
}

function tickersOf(item: QueueItem): string[] {
  const payload = item.payload && typeof item.payload === 'object' ? item.payload : {};
  return Array.isArray(payload.tickers) ? payload.tickers.filter((ticker): ticker is string => typeof ticker === 'string') : [];
}

function compactAnalysis(item: QueueItem) {
  const read = analysisOf(item);
  return {
    id: item.id,
    title: item.title,
    shortDesc: item.shortDesc,
    url: item.url,
    addedAt: item.addedAt,
    tickers: tickersOf(item),
    analyzedAt: typeof read?.analyzedAt === 'string' ? read.analyzedAt : null,
    direction: typeof read?.direction === 'string' ? read.direction : 'unclear',
    magnitude: typeof read?.magnitude === 'string' ? read.magnitude : 'low',
    horizon: typeof read?.horizon === 'string' ? read.horizon : 'unclear',
    confidence: typeof read?.confidence === 'string' ? read.confidence : 'low',
    pricedIn: typeof read?.pricedIn === 'string' ? read.pricedIn : 'unclear',
    mechanism: typeof read?.mechanism === 'string' ? read.mechanism : '',
    note: typeof read?.note === 'string' ? read.note : null,
  };
}

export const financeAnalystModule: BackendWorkerModule = {
  manifest: financeAnalystWorker,
  async loadDashboardData() {
    const queue = await loadQueue();
    const financeItems = queue
      .filter(isFinanceNewsItem)
      .sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt));
    const analysedItems = financeItems.filter((item) => Boolean(analysisOf(item))).slice(0, 30).map(compactAnalysis);
    return {
      pendingCount: financeItems.filter((item) => !analysisOf(item)).length,
      analysedItems,
    };
  },
};
