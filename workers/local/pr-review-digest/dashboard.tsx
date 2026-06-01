function formatDate(value?: string | null): string {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function toneForPriority(priority: string): string {
  if (priority === 'urgent') return 'bad';
  if (priority === 'high') return 'warning';
  if (priority === 'medium') return 'info';
  return 'muted';
}

function toneForStatus(status?: string): string {
  if (status === 'ok') return 'good';
  if (status === 'setup-needed') return 'warning';
  if (status === 'error') return 'bad';
  if (status === 'partial') return 'warning';
  return 'muted';
}

function toneForReview(status: string): string {
  if (status === 'approved') return 'good';
  if (status === 'changes_requested') return 'bad';
  return 'muted';
}

function toneForCI(status: string): string {
  if (status === 'passing') return 'good';
  if (status === 'failing') return 'bad';
  if (status === 'pending') return 'warning';
  return 'muted';
}

function toneForMerge(status: string): string {
  if (status === 'clean') return 'good';
  if (status === 'dirty') return 'bad';
  if (status === 'blocked' || status === 'behind') return 'warning';
  return 'muted';
}

function labelForReview(status: string): string {
  return status.replace(/_/g, ' ');
}

function WorkerDashboard(ctx: any) {
  const StatusPill = ctx.StatusPill ?? ((props: any) => <span>{props.children}</span>);
  const Detail = ctx.Detail ?? ((props: any) => <div className="detail"><span>{props.label}</span><strong>{props.value}</strong></div>);
  const slice = ctx.dashboard?.workerData?.['pr-review-digest'] ?? {};
  const settings = slice.settings ?? {};
  const repoCount = Number(slice.repoCount ?? 0);
  const tokenConfigured = Boolean(slice.tokenConfigured);
  const lastRun = slice.lastRun ?? null;
  const history = Array.isArray(slice.history) ? slice.history : [];
  const prs: any[] = Array.isArray(lastRun?.prs) ? lastRun.prs : [];
  const items: any[] = Array.isArray(lastRun?.items) ? lastRun.items : [];
  const errors: any[] = Array.isArray(lastRun?.errors) ? lastRun.errors : [];
  const job = ctx.dashboard?.cron?.jobs?.find(
    (entry: any) => entry.name === 'pr-review-digest' || entry.id === 'pr-review-digest',
  );
  const isReady = repoCount > 0;
  const stalePRs = Number(lastRun?.stalePRs ?? 0);
  const failingCIPRs = Number(lastRun?.failingCIPRs ?? 0);

  return (
    <>
      <section className="grid top-grid tab-page">
        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">PR Review Digest</p>
              <h2>{isReady ? `${repoCount} repo${repoCount === 1 ? '' : 's'} configured` : 'Configure repositories'}</h2>
            </div>
            <StatusPill tone={isReady ? 'good' : 'warning'}>
              {isReady ? (tokenConfigured ? 'token set' : 'no token') : 'setup needed'}
            </StatusPill>
          </div>
          <div className="detail-body">
            <div className="detail-grid">
              <Detail label="Job" value={job?.enabled ? 'enabled' : 'disabled'} />
              <Detail label="Cron" value={job?.cron ?? '0 20 * * 1-5'} />
              <Detail label="Token" value={tokenConfigured ? 'configured' : 'not detected'} />
              <Detail label="Publishes" value="dev.pr-review-digest" />
              <Detail label="Last status" value={lastRun?.status ?? 'n/a'} />
              <Detail label="Urgent" value={String(lastRun?.urgentCount ?? 0)} />
            </div>
          </div>
          <div className="panel-actions">
            <button
              type="button"
              disabled={ctx.busyKey === 'run-pr-review-digest' || job?.running}
              onClick={() => ctx.triggerRun?.('run-pr-review-digest', '/api/cron-jobs/pr-review-digest/run', 'PR review digest started.')}
            >
              {job?.running ? 'Running...' : 'Run now'}
            </button>
          </div>
        </article>

        <article className="panel">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">Last run</p>
              <h2>{lastRun ? formatDate(lastRun.ranAt) : 'No run yet'}</h2>
            </div>
            <StatusPill tone={toneForStatus(lastRun?.status)}>{lastRun?.status ?? 'idle'}</StatusPill>
          </div>
          {lastRun ? (
            <div className="detail-body">
              <p>{lastRun.summary}</p>
              <div className="detail-grid">
                <Detail label="Open PRs" value={String(lastRun.totalPRs ?? 0)} />
                <Detail label="Stale" value={String(stalePRs)} />
                <Detail label="Failing CI" value={String(failingCIPRs)} />
                <Detail label="AI" value={lastRun.llmUsed ? 'used' : 'fallback'} />
              </div>
              {errors.length > 0 && (
                <div className="timeline" style={{ marginTop: '0.75rem' }}>
                  {errors.map((error: any) => (
                    <div className="timeline-event warning" key={String(error.repo) + String(error.message)}>
                      <div><strong>{error.repo}</strong><span>{error.message}</span></div>
                      <StatusPill tone="warning">error</StatusPill>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="empty-state">Run the job once or wait for the next schedule.</p>
          )}
        </article>
      </section>

      <section className="panel tab-page">
        <div className="panel-head">
          <div><p className="panel-kicker">Open pull requests</p><h2>PR list</h2></div>
          <StatusPill tone={prs.length === 0 ? 'muted' : 'info'}>{prs.length} open</StatusPill>
        </div>
        {prs.length === 0 ? (
          <p className="empty-state">
            {isReady ? 'No open pull requests found, or the job has not run yet.' : 'Configure repositories in the Config tab, then run the job.'}
          </p>
        ) : (
          <div className="stack-list compact">
            {prs.map((pr: any) => (
              <div
                className="summary-row"
                key={`${pr.repo}#${pr.number}`}
                style={pr.needsAttention ? { borderLeft: '3px solid var(--color-bad, #e53e3e)', paddingLeft: '0.5rem' } : undefined}
              >
                <div style={{ flex: 1 }}>
                  <strong>
                    <a href={pr.url} target="_blank" rel="noopener noreferrer">
                      {pr.repo}#{pr.number} — {pr.title}
                    </a>
                  </strong>
                  <span style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                    <span>👤 {pr.author}</span>
                    <span>🕐 {pr.ageDays}d open</span>
                    <span>
                      <StatusPill tone={toneForReview(pr.reviewStatus)}>
                        {labelForReview(pr.reviewStatus)}
                      </StatusPill>
                    </span>
                    <span>
                      <StatusPill tone={toneForCI(pr.ciStatus)}>CI: {pr.ciStatus}</StatusPill>
                    </span>
                    <span>
                      <StatusPill tone={toneForMerge(pr.mergeStatus)}>merge: {pr.mergeStatus}</StatusPill>
                    </span>
                    {pr.draft && <StatusPill tone="muted">draft</StatusPill>}
                  </span>
                  {pr.failingChecks?.length > 0 && (
                    <span style={{ color: 'var(--color-bad, #e53e3e)', fontSize: '0.8rem' }}>
                      Failing: {pr.failingChecks.join(', ')}
                    </span>
                  )}
                  {pr.reviewers?.length > 0 && (
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted, #666)' }}>
                      Reviewers: {pr.reviewers.map((r: any) => `${r.user} (${r.state.toLowerCase()})`).join(', ')}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel tab-page">
        <div className="panel-head">
          <div><p className="panel-kicker">Digest</p><h2>LLM analysis</h2></div>
          <StatusPill tone="muted">{items.length} items</StatusPill>
        </div>
        <div className="stack-list compact">
          {items.map((item: any, index: number) => (
            <div className="summary-row" key={String(item.title) + index}>
              <div>
                <strong>{item.title}</strong>
                <span>{item.summary}</span>
                <span>{item.action}</span>
              </div>
              <StatusPill tone={toneForPriority(item.priority)}>{item.priority}</StatusPill>
            </div>
          ))}
          {items.length === 0 && (
            <p className="empty-state">No digest items yet. Run the job to generate the AI analysis.</p>
          )}
        </div>
      </section>

      <section className="panel tab-page">
        <div className="panel-head">
          <div><p className="panel-kicker">History</p><h2>Recent runs</h2></div>
          <StatusPill tone="muted">{history.length} runs</StatusPill>
        </div>
        <div className="timeline">
          {history.map((run: any) => (
            <div
              className={run.status === 'ok' ? 'timeline-event' : 'timeline-event warning'}
              key={run.ranAt}
            >
              <div>
                <strong>{formatDate(run.ranAt)}</strong>
                <span>{run.summary}</span>
                {(run.totalPRs != null) && (
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted, #666)' }}>
                    {run.totalPRs} PRs · {run.stalePRs ?? 0} stale · {run.failingCIPRs ?? 0} failing CI
                  </span>
                )}
              </div>
              <StatusPill tone={toneForStatus(run.status)}>{run.status}</StatusPill>
            </div>
          ))}
          {history.length === 0 && <p className="empty-state">No run history yet.</p>}
        </div>
      </section>

      <details className="panel tab-page worker-help-footer">
        <summary>About PR Review Digest</summary>
        <div className="detail-body">
          <p><strong>What it does</strong></p>
          <p>Fetches all open PRs from configured GitHub repositories. For each PR it calls the GitHub API for reviews and CI check-runs, then passes structured data to an LLM to produce the digest.</p>
          <p><strong>What each PR report covers</strong></p>
          <ul>
            <li><strong>Title + author</strong> — from the PR metadata</li>
            <li><strong>Age</strong> — computed from <code>created_at</code></li>
            <li><strong>Review status</strong> — approved / changes requested / awaiting review (latest review per reviewer)</li>
            <li><strong>CI status</strong> — passing / failing / pending / unknown (from check-runs + combined status)</li>
            <li><strong>Merge conflicts</strong> — clean / dirty / blocked / behind (from <code>mergeable_state</code>)</li>
          </ul>
          <p><strong>Setup</strong></p>
          <ul>
            <li>Add <code>GITHUB_TOKEN=github_pat_...</code> to your <code>.env</code> file and restart BFrost.</li>
            <li>Enter repository slugs (<code>owner/repo</code>) in the Config tab, one per line.</li>
            <li>For GitHub Enterprise, change the API base URL to your instance.</li>
          </ul>
        </div>
      </details>
    </>
  );
}

window.bfrost.registerDashboardView({
  workerId: 'pr-review-digest',
  kind: 'worker-dashboard',
  surfaceIds: ['pr-review-digest-dashboard'],
  menu: { icon: 'git-pull-request', group: 'Workers', order: 60, label: 'PRs' },
  count: (ctx: any) => {
    const prs = ctx.dashboard?.workerData?.['pr-review-digest']?.lastRun?.prs ?? [];
    return Array.isArray(prs) ? prs.filter((pr: any) => pr.needsAttention).length : undefined;
  },
  render: (ctx: any) => <WorkerDashboard {...ctx} />,
  queueItemDetail: (item: any) => {
    if (item?.producerWorkerId !== 'pr-review-digest' && item?.itemType !== 'dev.pr-review-digest') return null;
    const payload = item.payload ?? {};
    const prs: any[] = Array.isArray(payload.prs) ? payload.prs : [];
    const urgent = prs.filter((pr: any) => pr.needsAttention);
    return (
      <div className="detail-section">
        <p className="panel-kicker">PR Review Digest</p>
        <p>{payload.summary ?? item.shortDesc}</p>
        <div className="detail-grid">
          <div className="detail"><span>Open PRs</span><strong>{payload.totalPRs ?? prs.length}</strong></div>
          <div className="detail"><span>Stale</span><strong>{payload.stalePRs ?? 0}</strong></div>
          <div className="detail"><span>Failing CI</span><strong>{payload.failingCIPRs ?? 0}</strong></div>
          <div className="detail"><span>Needs attention</span><strong>{urgent.length}</strong></div>
        </div>
      </div>
    );
  },
});

declare global { interface Window { bfrost: { registerDashboardView: (view: any) => void; [key: string]: any } } }
