import type { WorkerDashboardViewDefinition, WorkerQueueItem } from '../../types';
import { newsItemSourceHost, newsItemSourceLabel } from '../news/payload';

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

interface PublisherXMetadata {
  tweetId?: string;
  tone?: string;
  postedAt?: string;
  tweetUrl?: string;
}

const publisherXQueueItemDetail = (item: WorkerQueueItem): React.ReactNode => {
  const meta = item.metadata?.['core.publisher.x'] as PublisherXMetadata | undefined;
  if (!meta || !meta.tweetId) return null;
  return (
    <div className="detail-section">
      <p className="panel-kicker">X publication</p>
      <div className="detail-grid">
        <div className="detail-row"><span>Tweet ID</span><strong>{meta.tweetId}</strong></div>
        {meta.tone ? <div className="detail-row"><span>Tone</span><strong>{meta.tone}</strong></div> : null}
        {meta.postedAt ? <div className="detail-row"><span>Posted</span><strong>{new Date(meta.postedAt).toLocaleString()}</strong></div> : null}
      </div>
      {meta.tweetUrl ? (
        <a className="detail-title" href={meta.tweetUrl} target="_blank" rel="noreferrer">
          Open on X
        </a>
      ) : null}
    </div>
  );
};

export const dashboardView: WorkerDashboardViewDefinition = {
  workerId: 'core.publisher.x',
  kind: 'custom',
  surfaceIds: ['x-credentials', 'queue-publishing'],
  menu: {
    icon: 'megaphone',
    group: 'Workers',
    order: 20,
    label: 'X Publisher',
  },
  count: ({ dashboard }) => dashboard.queue.approved + dashboard.queue.failed,
  queueItemDetail: publisherXQueueItemDetail,
  render: (ctx) => {
    const {
      activeWorkerTab,
      dashboard,
      busyKey,
      triggerRun,
      formatDate,
      queueItemTone,
      StatusPill,
      HealthRow,
    } = ctx;
    const job = dashboard.cron.jobs.find((item: any) => item.name === 'tweet-post');
    const queueItems = dashboard.queue.recentItems.filter((item: any) =>
      item.state === 'approved' || item.state === 'failed',
    );
    const events = dashboard.events.filter((event: any) =>
      event.metadata?.workerId === 'core.publisher.x' || event.metadata?.job === 'tweet-post',
    );

    return (
      <section className="grid worker-three-column-grid tab-page">
        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">{activeWorkerTab.worker.name}</p>
              <h2>Publishing queue</h2>
            </div>
            <StatusPill tone={dashboard.integrations.xConfigured.ok ? 'good' : 'warning'}>
              {dashboard.integrations.xConfigured.ok ? 'ready' : 'credentials'}
            </StatusPill>
          </div>

          <div className="stack-list compact">
            <HealthRow label="X API credentials" status={dashboard.integrations.xConfigured} />
          </div>

          <div className="panel-actions wrap">
            <button
              className="primary"
              disabled={busyKey === 'run-tweet-post' || job?.running || !job?.workerEnabled}
              onClick={() =>
                void triggerRun(
                  'run-tweet-post',
                  '/api/cron-jobs/tweet-post/run',
                  'Tweet Post started.',
                )
              }
            >
              {job?.running ? 'Running...' : 'Run publisher now'}
            </button>
          </div>
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">Candidates</p>
              <h2>Approved items</h2>
            </div>
            <StatusPill tone="muted">{queueItems.length} items</StatusPill>
          </div>
          <div className="stack-list">
            {queueItems.map((item: any) => (
              <div className="summary-row" key={item.id}>
                <div>
                  <strong>{item.title}</strong>
                  <span>{newsItemSourceHost(item) ?? hostFromUrl(item.url)} · {newsItemSourceLabel(item)}</span>
                  <span>{formatDate(item.stateChangedAt)}</span>
                </div>
                <StatusPill tone={queueItemTone(item.state)}>{item.state}</StatusPill>
              </div>
            ))}
            {queueItems.length === 0 ? (
              <p className="empty-state">No approved or retryable items are waiting for X publishing.</p>
            ) : null}
          </div>
        </article>

        <article className="panel worker-events">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">Activity</p>
              <h2>Publisher events</h2>
            </div>
          </div>
          <div className="stack-list">
            {events.map((event: any) => (
              <div className="event-row" key={event.id}>
                <div>
                  <strong>{event.summary}</strong>
                  <span>{event.action} · {formatDate(event.createdAt)}</span>
                </div>
                <StatusPill tone={ctx.eventSeverityTone(event.severity)}>{event.severity}</StatusPill>
              </div>
            ))}
            {events.length === 0 ? (
              <p className="empty-state">No X Publisher events yet.</p>
            ) : null}
          </div>
        </article>
      </section>
    );
  },
};
