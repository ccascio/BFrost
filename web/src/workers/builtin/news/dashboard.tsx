import type { WorkerDashboardViewDefinition, WorkerQueueItem } from '../../types';
import {
  newsItemPayload,
  newsItemSourceHost,
  newsItemSourceLabel,
  newsItemDigestRunId,
} from './payload';

function newsPayload(item: WorkerQueueItem) {
  return newsItemPayload(item);
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function isNewsQueueItem(item: any): boolean {
  return item?.producerWorkerId === 'core.news' || item?.itemType === 'news.article' || Boolean(newsItemDigestRunId(item));
}

function filterQueueItems(items: any[], filter: string): any[] {
  if (filter === 'all') return items;
  if (filter === 'retrying') return items.filter((item) => item.state === 'failed' && (item.attemptCount ?? 0) > 0);
  return items.filter((item) => item.state === filter);
}

function countByState(items: any[]) {
  return items.reduce(
    (counts, item) => {
      counts.total += 1;
      if (item.state in counts) counts[item.state as keyof typeof counts] += 1;
      if (item.state === 'failed' && (item.attemptCount ?? 0) > 0) counts.retrying += 1;
      return counts;
    },
    {
      total: 0,
      queued: 0,
      approved: 0,
      posted: 0,
      rejected: 0,
      failed: 0,
      seen: 0,
      retrying: 0,
    },
  );
}

const newsQueueItemDetail = (item: WorkerQueueItem): React.ReactNode => {
  if (item.producerWorkerId !== 'core.news' && item.itemType !== 'news.article') {
    return null;
  }
  const { source, article } = newsPayload(item);
  if (!source && !article) return null;
  return (
    <div className="detail-section">
      <p className="panel-kicker">News provenance</p>
      <div className="detail-grid">
        {source?.host ? <div className="detail"><span>Source host</span><strong>{source.host}</strong></div> : null}
        {typeof source?.score === 'number' ? <div className="detail"><span>Source score</span><strong>{source.score}</strong></div> : null}
        {source?.label ? <div className="detail"><span>Source label</span><strong>{source.label}</strong></div> : null}
        {typeof article?.fetched === 'boolean' ? <div className="detail"><span>Article fetched</span><strong>{article.fetched ? 'yes' : 'no'}</strong></div> : null}
      </div>
      {source?.reasons?.length ? (
        <div className="detail-block">
          <span className="panel-kicker">Source reasons</span>
          <p>{source.reasons.join('\n')}</p>
        </div>
      ) : null}
      {article?.title ? (
        <div className="detail-block">
          <span className="panel-kicker">Article title</span>
          <p>{article.title}</p>
        </div>
      ) : null}
      {article?.description ? (
        <div className="detail-block">
          <span className="panel-kicker">Article description</span>
          <p>{article.description}</p>
        </div>
      ) : null}
      {article?.excerpt ? (
        <div className="detail-block">
          <span className="panel-kicker">Article excerpt</span>
          <p>{article.excerpt}</p>
        </div>
      ) : null}
      {article?.finalUrl ? (
        <a className="detail-title" href={article.finalUrl} target="_blank" rel="noreferrer">
          Final article URL
        </a>
      ) : null}
    </div>
  );
};

export const dashboardView: WorkerDashboardViewDefinition = {
  workerId: 'core.news',
  kind: 'queue',
  surfaceIds: ['news-runs', 'source-quality-rules'],
  menu: {
    icon: 'newspaper',
    group: 'Workers',
    order: 10,
    label: 'News',
  },
  count: ({ dashboard }) => {
    const counts = countByState((dashboard.queue.recentItems ?? []).filter(isNewsQueueItem));
    return counts.queued + counts.approved + counts.failed;
  },
  queueItemDetail: newsQueueItemDetail,
  render: (ctx) => {
    const {
      activeWorkerTab,
      dashboard,
      selectedQueueItem,
      selectedRunId,
      queueFilter,
      busyKey,
      queueItemReason,
      queueItemTone,
      formatDate,
      setSelectedQueueItemId,
      setQueueFilter,
      updateQueueItem,
      renderQueueDetail,
      StatusPill,
      Detail,
    } = ctx;
    // News owns its run dedup model. The producer encodes `digestRunId` on each item's
    // payload, so consumers (and the news dashboard itself) read it through the shared
    // payload helper rather than a top-level column on the queue item.
    const recentRuns = (dashboard.workerData?.['core.news'] as any)?.recentRuns ?? [];
    const recentNewsItems = (dashboard.queue.recentItems ?? []).filter(isNewsQueueItem);
    const filteredNewsItems = filterQueueItems(recentNewsItems, queueFilter);
    const selectedNewsItem = selectedQueueItem && isNewsQueueItem(selectedQueueItem)
      ? selectedQueueItem
      : filteredNewsItems[0] ?? recentNewsItems[0] ?? null;
    const counts = countByState(recentNewsItems);
    const selectedRun = recentRuns.find((run: any) => run.file === selectedRunId) ?? recentRuns[0] ?? null;
    const selectedRunItems = selectedRun
      ? recentNewsItems.filter((item: any) => newsItemDigestRunId(item) === selectedRun.file)
      : [];
    const latestRun = recentRuns[0] ?? null;
    const filters = [
      ['all', 'Total', counts.total],
      ['queued', 'Queued', counts.queued],
      ['approved', 'Approved', counts.approved],
      ['posted', 'Posted', counts.posted],
      ['failed', 'Failed', counts.failed],
      ['retrying', 'Retrying', counts.retrying],
      ['rejected', 'Rejected', counts.rejected],
      ['seen', 'Seen', counts.seen],
    ];

    return (
      <>
        <section className="grid top-grid tab-page">
          <article className="panel">
            <div className="panel-head">
              <div>
                <p className="panel-kicker">{activeWorkerTab.worker.name}</p>
                <h2>News command center</h2>
              </div>
              <StatusPill tone={counts.failed > 0 ? 'warning' : counts.queued + counts.approved > 0 ? 'info' : 'muted'}>
                {counts.queued + counts.approved} actionable
              </StatusPill>
            </div>

            <div className="metric-row">
              {filters.map(([filter, label, value]) => (
                <button
                  className={`metric metric-button${queueFilter === filter ? ' active' : ''}`}
                  type="button"
                  aria-pressed={queueFilter === filter}
                  key={filter}
                  onClick={() => setQueueFilter(filter as string)}
                >
                  <span>{label}</span>
                  <strong>{String(value)}</strong>
                </button>
              ))}
            </div>
            <div className="filter-summary">
              <span>{queueFilter === 'all' ? 'Showing all recent news items.' : `Showing ${queueFilter} news items.`}</span>
            </div>
          </article>

          <article className="panel">
            <div className="panel-head">
              <div>
                <p className="panel-kicker">Latest digest</p>
                <h2>{latestRun ? formatDate(latestRun.ranAt) : 'No run yet'}</h2>
              </div>
              <StatusPill tone={latestRun ? 'info' : 'muted'}>
                {recentRuns.length} runs
              </StatusPill>
            </div>
            {latestRun ? (
              <div className="detail-body">
                <div className="detail-grid">
                  <Detail label="Fetched" value={String(latestRun.fetchedCount)} />
                  <Detail label="Queued" value={String(latestRun.queuedCount)} />
                  <Detail label="Rejected" value={String(latestRun.rejectedCount)} />
                  <Detail label="Near duplicates" value={String(latestRun.nearDuplicateCount)} />
                </div>
              </div>
            ) : (
              <p className="empty-state">No digest run has been recorded yet.</p>
            )}
          </article>
        </section>

        <section className="panel tab-page">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">Queue triage</p>
              <h2>Review news items</h2>
            </div>
            <StatusPill tone="muted">{filteredNewsItems.length} shown</StatusPill>
          </div>

          <div className="queue-workspace news-queue-workspace section-break">
            <div className="stack-list queue-list">
              {filteredNewsItems.map((item: any) => (
                <div className={`queue-item${selectedNewsItem?.id === item.id ? ' selected' : ''}`} key={item.id}>
                  <div className="queue-copy">
                    <a href={item.url} target="_blank" rel="noreferrer">
                      <strong>{item.title}</strong>
                    </a>
                    <span className="queue-meta">{newsItemSourceHost(item) ?? hostFromUrl(item.url)} · {newsItemSourceLabel(item) ?? item.itemType ?? 'news item'}</span>
                    <p>{item.shortDesc}</p>
                    {queueItemReason(item) ? <span className="queue-reason">{queueItemReason(item)}</span> : null}
                    <div className="queue-actions">
                      <button
                        type="button"
                        aria-pressed={selectedNewsItem?.id === item.id}
                        onClick={() => setSelectedQueueItemId(item.id)}
                      >
                        Details
                      </button>
                      {item.state === 'queued' || item.state === 'failed' || item.state === 'rejected' ? (
                        <button
                          className="primary"
                          disabled={busyKey === `approve-${item.id}`}
                          onClick={() => void updateQueueItem(item.id, 'approve')}
                        >
                          Approve
                        </button>
                      ) : null}
                      {item.state === 'queued' || item.state === 'failed' ? (
                        <button
                          disabled={busyKey === `reject-${item.id}`}
                          onClick={() => void updateQueueItem(item.id, 'reject')}
                        >
                          Reject
                        </button>
                      ) : null}
                      {item.state === 'approved' ? (
                        <button
                          disabled={busyKey === `reject-${item.id}`}
                          onClick={() => void updateQueueItem(item.id, 'reject')}
                        >
                          Reject
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className="queue-side">
                    <StatusPill tone={queueItemTone(item.state)}>{item.state}</StatusPill>
                    <span className="queue-meta">{formatDate(item.stateChangedAt)}</span>
                  </div>
                </div>
              ))}
              {filteredNewsItems.length === 0 ? (
                <p className="empty-state">No recent news items match this filter.</p>
              ) : null}
            </div>

            <aside className="queue-detail-column news-item-detail-column">
              <section className="detail-panel news-item-detail-panel">
                <div className="panel-head">
                  <div>
                    <p className="panel-kicker">Item detail</p>
                    <h2>Decision trail</h2>
                  </div>
                  {selectedNewsItem ? (
                    <StatusPill tone={queueItemTone(selectedNewsItem.state)}>{selectedNewsItem.state}</StatusPill>
                  ) : null}
                </div>
                {selectedNewsItem ? renderQueueDetail(selectedNewsItem) : (
                  <p className="empty-state">Select a news item to inspect its full state.</p>
                )}
              </section>
            </aside>
          </div>
        </section>

        <section className="panel tab-page">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">{activeWorkerTab.worker.name}</p>
              <h2>Digest run history</h2>
            </div>
            <StatusPill tone="muted">{recentRuns.length} stored</StatusPill>
          </div>

          <div className="runs-workspace">
            <div className="stack-list">
              {recentRuns.map((run: any) => (
                <button
                  className={`run-item run-button${selectedRun?.file === run.file ? ' selected' : ''}`}
                  key={run.file}
                  type="button"
                  aria-pressed={selectedRun?.file === run.file}
                  onClick={() => ctx.setSelectedRunId(run.file)}
                >
                  <strong>{formatDate(run.ranAt)}</strong>
                  <span>{run.fetchedCount} fetched</span>
                  <span>{run.queuedCount} queued · {run.rejectedCount} rejected · {run.seenCount} seen</span>
                  <span>{run.sourceQualifiedCount} passed source policy</span>
                </button>
              ))}
              {recentRuns.length === 0 ? (
                <p className="subtle">No digest runs have been recorded yet.</p>
              ) : null}
            </div>

            <aside className="queue-detail-column">
              <section className="detail-panel">
                <div className="panel-head">
                  <div>
                    <p className="panel-kicker">Run metrics</p>
                    <h2>{selectedRun ? formatDate(selectedRun.ranAt) : 'No run'}</h2>
                  </div>
                  {selectedRun ? <StatusPill tone="info">{selectedRunItems.length} items</StatusPill> : null}
                </div>

                {selectedRun ? (
                  <div className="detail-body">
                    <div className="detail-grid">
                      <Detail label="Fetched" value={String(selectedRun.fetchedCount)} />
                      <Detail label="Pages extracted" value={String(selectedRun.articleFetchSuccessCount)} />
                      <Detail label="Page fetch failed" value={String(selectedRun.articleFetchFailureCount)} />
                      <Detail label="Source-qualified" value={String(selectedRun.sourceQualifiedCount)} />
                      <Detail label="Allowlisted" value={String(selectedRun.allowlistedCount)} />
                      <Detail label="Blocked source" value={String(selectedRun.blockedSourceCount)} />
                      <Detail label="Low-score rejected" value={String(selectedRun.lowScoreRejectedCount)} />
                      <Detail label="Near duplicates" value={String(selectedRun.nearDuplicateCount)} />
                      <Detail label="Queued" value={String(selectedRun.queuedCount)} />
                      <Detail label="Rejected" value={String(selectedRun.rejectedCount)} />
                      <Detail label="Seen" value={String(selectedRun.seenCount)} />
                      <Detail label="Run ID" value={selectedRun.file} />
                    </div>
                  </div>
                ) : (
                  <p className="empty-state">Select a run to inspect its metrics.</p>
                )}
              </section>

              <section className="detail-panel">
                <div className="panel-head">
                  <div>
                    <p className="panel-kicker">Related queue</p>
                    <h2>Items from run</h2>
                  </div>
                </div>
                <div className="stack-list compact">
                  {selectedRunItems.map((item: any) => (
                    <div className="summary-row" key={item.id}>
                      <div>
                        <strong>{item.title}</strong>
                        <span>{newsItemSourceHost(item) ?? hostFromUrl(item.url)} · {newsItemSourceLabel(item)}</span>
                      </div>
                      <div className="run-item-actions">
                        <StatusPill tone={queueItemTone(item.state)}>{item.state}</StatusPill>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedQueueItemId(item.id);
                            setQueueFilter('all');
                          }}
                        >
                          Open
                        </button>
                      </div>
                    </div>
                  ))}
                  {selectedRun && selectedRunItems.length === 0 ? (
                    <p className="empty-state">No recent queue items reference this run yet.</p>
                  ) : null}
                </div>
              </section>
            </aside>
          </div>
        </section>

        <details className="panel tab-page worker-help-footer">
          <summary>
            <span className="panel-kicker">Extending BFrost</span>
            <strong>Build a worker that consumes news items</strong>
          </summary>
          <div className="detail-body">
            <p>
              Every item on this dashboard is published to the shared Item Bus with{' '}
              <code>itemType: 'news.article'</code> and <code>producerWorkerId: 'core.news'</code>. A consumer
              worker (e.g. a Mastodon publisher, a Slack relay, a custom archiver) subscribes by type and writes
              only under its own metadata namespace, so two consumers of the same item never collide.
            </p>
            <pre><code>{`import {
  listItemsForConsumer,
  applyConsumerSuccess,
  applyConsumerFailure,
  withQueueLock,
  loadQueue,
  saveQueue,
} from 'bfrost/jobs/item-bus';

await withQueueLock(async () => {
  const candidates = await listItemsForConsumer('my.mastodon', {
    itemType: 'news.article',
    states: ['queued', 'approved'],
    excludeAlreadyHandled: true,
  });
  const target = candidates[0];
  if (!target) return;

  try {
    const result = await postToMastodon(target);
    const queue = await loadQueue();
    const live = queue.find((it) => it.id === target.id)!;
    applyConsumerSuccess(live, 'my.mastodon', {
      postedId: result.id,
      metadata: { tootId: result.id, tootUrl: result.url },
    });
    await saveQueue(queue);
  } catch (err) {
    const queue = await loadQueue();
    const live = queue.find((it) => it.id === target.id)!;
    applyConsumerFailure(live, 'my.mastodon', {
      errorMessage: err instanceof Error ? err.message : String(err),
      maxAttempts: 3,
    });
    await saveQueue(queue);
  }
});`}</code></pre>
            <p className="footnote">
              Full guide: <code>workers/README.md</code> → "Item Bus" / "Consuming Items". Example manifests live
              in <code>workers/examples/</code>.
            </p>
          </div>
        </details>
      </>
    );
  },
};
