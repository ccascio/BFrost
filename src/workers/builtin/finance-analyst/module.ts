import type { BackendWorkerModule } from '../../module';
import { loadQueue, type QueueItem } from '../../../jobs/queue';
import { financeAnalystWorker } from './manifest';
import { migrateLegacyAnalysisPrompt } from './job';

const CONSUMER_ID = 'core.finance-analyst';
const SUBSCRIBES_TO = 'finance.news';
const ANALYSIS_VERSION = 3;

function isFinanceNewsItem(item: QueueItem): boolean {
  return item.itemType === SUBSCRIBES_TO;
}

function analysisOf(item: QueueItem): Record<string, unknown> | null {
  const metadata = item.metadata?.[CONSUMER_ID];
  return metadata && typeof metadata === 'object' ? metadata : null;
}

function hasCurrentAnalysis(item: QueueItem): boolean {
  return analysisOf(item)?.analysisVersion === ANALYSIS_VERSION;
}

function tickersOf(item: QueueItem): string[] {
  const payload = item.payload && typeof item.payload === 'object' ? item.payload : {};
  return Array.isArray(payload.tickers) ? payload.tickers.filter((ticker): ticker is string => typeof ticker === 'string') : [];
}

function recommendationsOf(read: Record<string, unknown> | null): Record<string, unknown>[] {
  return Array.isArray(read?.recommendations)
    ? read.recommendations.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
    : [];
}

function compactAnalysis(item: QueueItem) {
  const read = analysisOf(item);
  const recommendations = recommendationsOf(read).map((advice) => ({
    target: typeof advice.target === 'string' ? advice.target : '',
    recommendation: typeof advice.recommendation === 'string' ? advice.recommendation : 'hold',
    attention: typeof advice.attention === 'string' ? advice.attention : 'insufficient_evidence',
    catalyst: typeof advice.catalyst === 'string' ? advice.catalyst : '',
    evidence: typeof advice.evidence === 'string' ? advice.evidence : '',
    direction: typeof advice.direction === 'string' ? advice.direction : 'unclear',
    magnitude: typeof advice.magnitude === 'string' ? advice.magnitude : 'low',
    horizon: typeof advice.horizon === 'string' ? advice.horizon : 'unclear',
    confidence: typeof advice.confidence === 'string' ? advice.confidence : 'low',
    pricedIn: typeof advice.pricedIn === 'string' ? advice.pricedIn : 'unclear',
    mechanism: typeof advice.mechanism === 'string' ? advice.mechanism : '',
    risks: typeof advice.risks === 'string' ? advice.risks : '',
    nextCheck: typeof advice.nextCheck === 'string' ? advice.nextCheck : '',
    note: typeof advice.note === 'string' ? advice.note : null,
  }));
  return {
    id: item.id,
    title: item.title,
    shortDesc: item.shortDesc,
    url: item.url,
    addedAt: item.addedAt,
    tickers: tickersOf(item),
    analyzedAt: typeof read?.analyzedAt === 'string' ? read.analyzedAt : null,
    recommendations,
    recommendation: typeof read?.recommendation === 'string' ? read.recommendation : null,
    attention: typeof read?.attention === 'string' ? read.attention : null,
    catalyst: typeof read?.catalyst === 'string' ? read.catalyst : '',
    evidence: typeof read?.evidence === 'string' ? read.evidence : '',
    direction: typeof read?.direction === 'string' ? read.direction : 'unclear',
    magnitude: typeof read?.magnitude === 'string' ? read.magnitude : 'low',
    horizon: typeof read?.horizon === 'string' ? read.horizon : 'unclear',
    confidence: typeof read?.confidence === 'string' ? read.confidence : 'low',
    pricedIn: typeof read?.pricedIn === 'string' ? read.pricedIn : 'unclear',
    mechanism: typeof read?.mechanism === 'string' ? read.mechanism : '',
    risks: typeof read?.risks === 'string' ? read.risks : '',
    nextCheck: typeof read?.nextCheck === 'string' ? read.nextCheck : '',
    note: typeof read?.note === 'string' ? read.note : null,
  };
}

export const financeAnalystModule: BackendWorkerModule = {
  manifest: financeAnalystWorker,
  async loadDashboardData() {
    await migrateLegacyAnalysisPrompt();
    const queue = await loadQueue();
    const financeItems = queue
      .filter(isFinanceNewsItem)
      .sort((a, b) => Date.parse(b.addedAt) - Date.parse(a.addedAt));
    const analysedItems = financeItems.filter((item) => Boolean(analysisOf(item))).slice(0, 30).map(compactAnalysis);
    return {
      pendingCount: financeItems.filter((item) => !hasCurrentAnalysis(item)).length,
      analysedItems,
    };
  },
};
