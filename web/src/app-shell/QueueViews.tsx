import type { DashboardState, DashboardTab, QueueFilter, QueueItem } from '../app-types';
import {
  Detail,
  DetailBlock,
  Metric,
  formatDate,
  safeHost,
} from '../app-helpers';
import { workerQueueItemDetails } from '../workers/registry';

export function QueueDetail({
  item,
  busyKey,
  onUpdateQueueItem,
}: {
  item: QueueItem;
  busyKey: string | null;
  onUpdateQueueItem: (id: string, action: 'approve' | 'reject') => void;
}) {
  const workerDetails = workerQueueItemDetails(item as any);
  return (
    <div className="detail-body">
      <a className="detail-title" href={item.url} target="_blank" rel="noreferrer">
        {item.title}
      </a>
      <p>{item.shortDesc}</p>

      <div className="detail-grid">
        <Detail label="Host" value={safeHost(item.url)} />
        <Detail label="Producer" value={item.producerWorkerId ?? 'n/a'} />
        <Detail label="Item type" value={item.itemType ?? 'n/a'} />
        <Detail label="Added" value={formatDate(item.addedAt)} />
        <Detail label="State changed" value={formatDate(item.stateChangedAt)} />
        <Detail label="Attempts" value={String(item.attemptCount ?? 0)} />
        <Detail label="Last attempt" value={formatDate(item.lastAttemptAt ?? null)} />
        <Detail label="Posted" value={formatDate(item.postedAt ?? null)} />
      </div>

      <DetailBlock label="State reason" value={item.stateReason} />
      <DetailBlock label="Selection reason" value={item.selectionReason} />
      <DetailBlock label="Rejection reason" value={item.rejectionReason} />
      <DetailBlock label="Last error" value={item.lastError} tone="error" />

      {workerDetails.map((entry) => (
        <div key={entry.workerId}>{entry.node}</div>
      ))}

      <div className="panel-actions wrap">
        {item.state === 'queued' || item.state === 'failed' || item.state === 'rejected' ? (
          <button
            className="primary"
            disabled={busyKey === `approve-${item.id}`}
            onClick={() => onUpdateQueueItem(item.id, 'approve')}
          >
            Approve
          </button>
        ) : null}
        {item.state !== 'posted' && item.state !== 'rejected' ? (
          <button disabled={busyKey === `reject-${item.id}`} onClick={() => onUpdateQueueItem(item.id, 'reject')}>
            Reject
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function QueueMetrics({
  dashboard,
  queueFilter,
  setQueueFilter,
  interactive,
}: {
  dashboard: DashboardState;
  queueFilter: QueueFilter;
  setQueueFilter: (filter: QueueFilter) => void;
  interactive: boolean;
}) {
  const onClick = (filter: QueueFilter) => (interactive ? () => setQueueFilter(filter) : undefined);
  return (
    <div className="metric-row">
      <Metric label="Total" value={String(dashboard.queue.total)} active={queueFilter === 'all'} onClick={onClick('all')} />
      <Metric label="Queued" value={String(dashboard.queue.queued)} active={queueFilter === 'queued'} onClick={onClick('queued')} />
      <Metric label="Approved" value={String(dashboard.queue.approved)} active={queueFilter === 'approved'} onClick={onClick('approved')} />
      <Metric label="Posted" value={String(dashboard.queue.posted)} active={queueFilter === 'posted'} onClick={onClick('posted')} />
      <Metric label="Rejected" value={String(dashboard.queue.rejected)} active={queueFilter === 'rejected'} onClick={onClick('rejected')} />
      <Metric label="Failed" value={String(dashboard.queue.failed)} active={queueFilter === 'failed'} onClick={onClick('failed')} />
      <Metric label="Seen" value={String(dashboard.queue.seen)} active={queueFilter === 'seen'} onClick={onClick('seen')} />
      <Metric label="Retrying" value={String(dashboard.queue.retrying)} active={queueFilter === 'retrying'} onClick={onClick('retrying')} />
    </div>
  );
}

export function StuckDetectorBanner({
  dashboard,
  setSelectedJobName,
  setActiveTab,
}: {
  dashboard: DashboardState;
  setSelectedJobName: (name: string) => void;
  setActiveTab: (tab: DashboardTab) => void;
}) {
  const stuckJobs = dashboard.cron.jobs.filter(
    (job) => job.enabled && job.workerEnabled && (job.consecutiveErrors ?? 0) >= 3,
  );
  if (stuckJobs.length === 0) return null;

  return (
    <div className="stuck-detector-banner" role="alert">
      <strong>
        {stuckJobs.length === 1
          ? `"${stuckJobs[0].label}" has failed ${stuckJobs[0].consecutiveErrors} times in a row.`
          : `${stuckJobs.length} jobs are failing repeatedly.`}
      </strong>{' '}
      <span>Check credentials and model settings, then re-enable.</span>
      <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
        {stuckJobs.map((job) => (
          <button
            key={job.name}
            type="button"
            onClick={() => {
              setSelectedJobName(job.name);
              setActiveTab('jobs');
            }}
          >
            Fix "{job.label}"
          </button>
        ))}
      </div>
    </div>
  );
}
