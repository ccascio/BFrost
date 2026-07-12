import type { WorkerDashboardViewDefinition } from '../../types';
import { companyLabels } from '../finance/company-label';

const WORKER_ID = 'core.finance-analyst';
const JOB_ID = 'finance-analysis';
const SURFACE_ID = 'finance-analyst-dashboard';

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function attentionLabel(value: unknown): string {
  return String(value || 'insufficient_evidence').replace(/_/g, ' ');
}

function attentionTone(value: unknown): 'info' | 'warning' | 'muted' {
  return value === 'act_on_research' ? 'warning' : value === 'watch' ? 'info' : 'muted';
}

function attentionOf(item: any): string {
  return item?.recommendations?.[0]?.attention || item?.attention || 'insufficient_evidence';
}

const ATTENTION_ORDER: Record<string, number> = {
  act_on_research: 0,
  watch: 1,
  no_action: 2,
  insufficient_evidence: 3,
};

function FinanceAnalystDashboard(ctx: Record<string, any>) {
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
  const workerName = ctx.activeWorkerTab?.worker?.name ?? 'Finance Analyst';
  const slice = (dashboard.workerData?.[WORKER_ID] as any) ?? {};
  const job = (dashboard.cron?.jobs ?? []).find((entry: any) => entry.name === JOB_ID || entry.workerId === WORKER_ID);
  const runs = (dashboard.cron?.runs ?? []).filter((run: any) => run.job === JOB_ID);
  const latestRun = runs[0] ?? null;
  const analysedItems = Array.isArray(slice.analysedItems)
    ? slice.analysedItems
      .slice()
      .sort((a: any, b: any) => (ATTENTION_ORDER[attentionOf(a)] ?? 9) - (ATTENTION_ORDER[attentionOf(b)] ?? 9))
      .slice(0, 12)
    : [];
  const pendingCount = typeof slice.pendingCount === 'number' ? slice.pendingCount : 0;
  const attentionCounts = analysedItems.reduce((counts: Record<string, number>, item: any) => {
    const key = attentionOf(item);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});

  return (
    <section className="grid worker-dashboard-grid tab-page">
      <article className="panel">
        <div className="panel-head">
          <div>
            <p className="panel-kicker">{workerName}</p>
            <h2>Research priorities</h2>
          </div>
          <StatusPill tone={job?.enabled ? 'info' : 'muted'}>{job?.enabled ? 'Scheduled' : 'Paused'}</StatusPill>
        </div>
        <div className="detail-grid">
          <Detail label="Latest run" value={latestRun ? `${latestRun.status} - ${formatDate(latestRun.startedAt)}` : 'No run yet'} />
          <Detail label="Analysed in latest run" value={latestRun?.itemCount == null ? 'n/a' : String(latestRun.itemCount)} />
          <Detail label="Recent advice" value={`${analysedItems.length} items`} />
          <Detail label="Pending finance.news" value={`${pendingCount} items`} />
          <Detail label="Investor lens" value={job?.params?.investorLens || 'none'} />
          <Detail label="Risk tolerance" value={job?.params?.riskTolerance || 'balanced'} />
          <Detail label="Act on research" value={String(attentionCounts.act_on_research ?? 0)} />
          <Detail label="Watch" value={String(attentionCounts.watch ?? 0)} />
        </div>
        {latestRun?.error ? <p className="error-text">{latestRun.error}</p> : null}
        <div className="panel-actions wrap">
          <button
            className="primary"
            disabled={busyKey === `run-${JOB_ID}` || job?.running}
            onClick={() => void triggerRun(`run-${JOB_ID}`, `/api/cron-jobs/${JOB_ID}/run`, 'Finance analysis started.')}
          >
            {job?.running ? 'Running...' : 'Run now'}
          </button>
          <span className="empty-state">Schedule, prompt, model, investor lens, risk tolerance, and portfolio context live in Jobs.</span>
        </div>
      </article>

      <article className="panel">
        <div className="panel-head">
          <div>
            <p className="panel-kicker">Recent advice</p>
            <h2>What to do next</h2>
          </div>
          <StatusPill tone={analysedItems.length ? 'info' : 'muted'}>{analysedItems.length} shown</StatusPill>
        </div>
        <div className="stack-list">
          {analysedItems.map((item: any) => {
            const recommendations = Array.isArray(item.recommendations) ? item.recommendations : [];
            return (
              <div className="queue-item" key={item.id}>
                <div className="queue-copy">
                  <a href={item.url} target="_blank" rel="noreferrer">
                    <strong>{item.title}</strong>
                  </a>
                  <span className="queue-meta">
                    {companyLabels(arrayOfStrings(item.tickers)) || 'finance'} - {formatDate(item.analyzedAt || item.addedAt)}
                  </span>
                  {recommendations.length ? recommendations.map((advice: any) => (
                    <div className="detail-block" key={`${item.id}-${advice.target}`}>
                      <div className="panel-head">
                        <strong>{advice.target}</strong>
                        <StatusPill tone={attentionTone(advice.attention)}>
                          {attentionLabel(advice.attention)}
                        </StatusPill>
                      </div>
                      <span className="queue-reason">Recommendation: {String(advice.recommendation || 'hold').toUpperCase()}</span>
                      <p><strong>Catalyst:</strong> {advice.catalyst}</p>
                      <p><strong>Evidence:</strong> {advice.evidence}</p>
                      <p>{advice.mechanism}</p>
                      <span className="queue-reason">
                        {advice.direction}/{advice.magnitude}; {advice.horizon}; confidence: {advice.confidence}; priced in: {advice.pricedIn}
                      </span>
                      {advice.risks ? <p><strong>Risks:</strong> {advice.risks}</p> : null}
                      {advice.nextCheck ? <p><strong>Next check:</strong> {advice.nextCheck}</p> : null}
                    </div>
                  )) : (
                    <>
                      <p>{item.mechanism || item.note || item.shortDesc}</p>
                      <span className="queue-reason">Legacy read: {item.direction}/{item.magnitude}; confidence: {item.confidence}; horizon: {item.horizon}</span>
                    </>
                  )}
                </div>
                <StatusPill tone={attentionTone(item.attention)}>
                  {item.attention ? attentionLabel(item.attention) : 'LEGACY'}
                </StatusPill>
              </div>
            );
          })}
          {analysedItems.length === 0 ? <p className="empty-state">No finance.news items have been analysed yet.</p> : null}
        </div>
      </article>

      <details className="panel tab-page worker-help-footer" open={analysedItems.length === 0}>
        <summary><strong>Guide: using Finance Analyst</strong></summary>
        <div className="detail-body">
          <p>This worker consumes verified <code>finance.news</code> items and writes a recommendation plus a non-trading research priority into its own Item Bus metadata.</p>
          <p>Configure its schedule, model, prompt, investor lens, risk tolerance, and portfolio context in <strong>Jobs → Finance Analysis</strong>.</p>
          <p><strong>Example portfolio context:</strong> “I hold AAPL and NVDA, have a 12–24 month horizon, and accept moderate volatility. Flag thesis-breaking news aggressively.”</p>
          <p><strong>Attention states:</strong> Act on research = investigate promptly; Watch = await confirmation; No action = no more research now; Insufficient evidence = the article cannot support a reliable priority.</p>
        </div>
      </details>
    </section>
  );
}

export const dashboardView: WorkerDashboardViewDefinition = {
  workerId: WORKER_ID,
  kind: 'finance-analyst',
  surfaceIds: [SURFACE_ID],
  menu: {
    icon: 'line-chart',
    group: 'Workers',
    order: 25,
    label: 'Finance Analyst',
  },
  count: ({ dashboard }) => {
    const slice = (dashboard?.workerData?.[WORKER_ID] as any) ?? {};
    return Array.isArray(slice.analysedItems) ? slice.analysedItems.length : undefined;
  },
  render: (ctx) => <FinanceAnalystDashboard {...ctx} />,
};
