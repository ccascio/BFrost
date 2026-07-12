import type { WorkerDashboardViewDefinition, WorkerQueueItem } from '../../types';
import { companyLabels } from '../finance/company-label';

const WORKER_ID = 'core.finance-news';
const JOB_ID = 'finance-news-scan';
const SURFACE_ID = 'finance-news-dashboard';

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function isFinanceNewsItem(item: WorkerQueueItem): boolean {
  return item.producerWorkerId === WORKER_ID || item.itemType === 'finance.news';
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function itemFromQueue(item: WorkerQueueItem) {
  const payload = item.payload ?? {};
  const source = payload.source && typeof payload.source === 'object' ? payload.source as Record<string, unknown> : {};
  return {
    id: item.id,
    title: item.title,
    shortDesc: item.shortDesc,
    url: item.url,
    state: item.state,
    addedAt: item.addedAt,
    tickers: arrayOfStrings(payload.tickers),
    category: text(payload.category, 'general'),
    relevanceReason: text(payload.relevanceReason, item.selectionReason ?? item.shortDesc),
    sourceHost: text(source.host, hostFromUrl(item.url)),
  };
}

function FinanceNewsDashboard(ctx: Record<string, any>) {
  const dashboard = ctx.dashboard ?? {};
  const busyKey = ctx.busyKey;
  const triggerRun = typeof ctx.triggerRun === 'function' ? ctx.triggerRun : async () => undefined;
  const formatDate = typeof ctx.formatDate === 'function' ? ctx.formatDate : (value: unknown) => String(value || 'n/a');
  const StatusPill = typeof ctx.StatusPill === 'function'
    ? ctx.StatusPill
    : ({ children }: Record<string, any>) => <span>{children}</span>;
  const Detail = typeof ctx.Detail === 'function'
    ? ctx.Detail
    : ({ label, value }: Record<string, any>) => <p><strong>{label}:</strong> {value}</p>;
  const workerName = ctx.activeWorkerTab?.worker?.name ?? 'Finance News';
  const slice = (dashboard.workerData?.[WORKER_ID] as any) ?? {};
  const job = (dashboard.cron?.jobs ?? []).find((entry: any) => entry.name === JOB_ID || entry.workerId === WORKER_ID);
  const runs = (dashboard.cron?.runs ?? []).filter((run: any) => run.job === JOB_ID);
  const latestRun = runs[0] ?? null;
  const workerItems = Array.isArray(slice.recentItems)
    ? slice.recentItems
    : (dashboard.queue?.recentItems ?? []).filter(isFinanceNewsItem).map(itemFromQueue);
  const recentItems = workerItems.slice(0, 12);
  const queuedCount = recentItems.filter((item: any) => item.state === 'queued' || item.state === 'approved').length;

  return (
    <section className="grid worker-dashboard-grid tab-page">
      <article className="panel">
        <div className="panel-head">
          <div>
            <p className="panel-kicker">{workerName}</p>
            <h2>Scan output</h2>
          </div>
          <StatusPill tone={job?.enabled ? 'info' : 'muted'}>{job?.enabled ? 'Scheduled' : 'Paused'}</StatusPill>
        </div>
        <div className="detail-grid">
          <Detail label="Latest run" value={latestRun ? `${latestRun.status} - ${formatDate(latestRun.startedAt)}` : 'No run yet'} />
          <Detail label="Items in latest run" value={latestRun?.itemCount == null ? 'n/a' : String(latestRun.itemCount)} />
          <Detail label="Recent output" value={`${recentItems.length} items`} />
          <Detail label="Needs review" value={`${queuedCount} items`} />
        </div>
        {latestRun?.error ? <p className="error-text">{latestRun.error}</p> : null}
        <div className="panel-actions wrap">
          <button
            className="primary"
            disabled={busyKey === `run-${JOB_ID}` || job?.running}
            onClick={() => void triggerRun(`run-${JOB_ID}`, `/api/cron-jobs/${JOB_ID}/run`, 'Finance news scan started.')}
          >
            {job?.running ? 'Running...' : 'Run now'}
          </button>
          <span className="empty-state">Schedule, prompt, model, and watchlist live in Jobs.</span>
        </div>
      </article>

      <article className="panel">
        <div className="panel-head">
          <div>
            <p className="panel-kicker">Recent articles</p>
            <h2>What the cronjob found</h2>
          </div>
          <StatusPill tone={recentItems.length ? 'info' : 'muted'}>{recentItems.length} shown</StatusPill>
        </div>
        <div className="stack-list">
          {recentItems.map((item: any) => (
            <div className="queue-item" key={item.id}>
              <div className="queue-copy">
                <a href={item.url} target="_blank" rel="noreferrer">
                  <strong>{item.title}</strong>
                </a>
                <span className="queue-meta">
                  {companyLabels(arrayOfStrings(item.tickers)) || item.category || 'finance'} - {item.sourceHost || hostFromUrl(item.url)} - {formatDate(item.addedAt)}
                </span>
                <p>{item.relevanceReason || item.shortDesc}</p>
              </div>
              <StatusPill tone={item.state === 'failed' ? 'warning' : item.state === 'queued' ? 'info' : 'muted'}>
                {item.state}
              </StatusPill>
            </div>
          ))}
          {recentItems.length === 0 ? <p className="empty-state">No finance.news items have been queued yet.</p> : null}
        </div>
      </article>

      <details className="panel tab-page worker-help-footer" open={recentItems.length === 0}>
        <summary><strong>Guide: using Finance News</strong></summary>
        <div className="detail-body">
          <p>This worker searches for watchlist developments, verifies materially discussed targets, and publishes <code>finance.news</code> items for Finance Analyst.</p>
          <p>Configure the watchlist, categories, schedule, model, and relevance prompt in <strong>Jobs → Finance News Scan</strong>.</p>
          <p><strong>Example watchlist:</strong> <code>AAPL, NVDA, MSFT</code>. Keep broad themes such as <code>S&amp;P 500</code> only when you want index-level advice downstream.</p>
          <p><strong>Why was a result dropped?</strong> Incidental ticker mentions, index quotes, navigation labels, generic market recaps, and items with no verified target do not pass Phase 1 relevance.</p>
        </div>
      </details>
    </section>
  );
}

export const dashboardView: WorkerDashboardViewDefinition = {
  workerId: WORKER_ID,
  kind: 'finance-news',
  surfaceIds: [SURFACE_ID],
  menu: {
    icon: 'article',
    group: 'Workers',
    order: 24,
    label: 'Finance News',
  },
  count: ({ dashboard }) => {
    const slice = (dashboard?.workerData?.[WORKER_ID] as any) ?? {};
    if (Array.isArray(slice.recentItems)) return slice.recentItems.length;
    return (dashboard?.queue?.recentItems ?? []).filter(isFinanceNewsItem).length;
  },
  render: (ctx) => <FinanceNewsDashboard {...ctx} />,
};
