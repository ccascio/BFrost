import type { WorkerDashboardViewDefinition } from '../../types';

interface DemoArticle {
  title: string;
  shortDesc: string;
  url: string;
  source: string;
}

interface DemoRunSnapshot {
  ranAt: string;
  articles: DemoArticle[];
  researchNote: string;
}

export const dashboardView: WorkerDashboardViewDefinition = {
  workerId: 'core.demo',
  kind: 'queue',
  surfaceIds: ['demo-run-output'],
  menu: {
    icon: 'sparkles',
    group: 'Workers',
    order: 5,
    label: 'Demo',
  },
  render: (ctx) => {
    const { dashboard } = ctx;
    const snapshot = (dashboard.workerData?.['core.demo'] as { lastRun?: DemoRunSnapshot } | undefined)?.lastRun ?? null;

    if (!snapshot) {
      return (
        <div className="empty-state">
          <p>The demo hasn't run yet.</p>
          <p className="footnote">
            Trigger the <strong>Demo pipeline</strong> job (or the "Try the live demo" button on
            the overview) to publish a few sample articles and a synthesized research note — no
            API key or model required.
          </p>
        </div>
      );
    }

    return (
      <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div className="panel-head">
          <div>
            <p className="panel-kicker">Demo output</p>
            <h2>Sample pipeline result</h2>
          </div>
          <span className="footnote">Last run: {new Date(snapshot.ranAt).toLocaleString()}</span>
        </div>

        <div>
          <p className="panel-kicker">Published to the Item Bus ({snapshot.articles.length} articles)</p>
          <div className="stack-list compact">
            {snapshot.articles.map((article) => (
              <div className="summary-row" key={article.url}>
                <div>
                  <strong>{article.title}</strong>
                  <span>{article.shortDesc}</span>
                  <span className="footnote">{article.source} · news.article</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="panel-kicker">Synthesized research note</p>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              fontFamily: 'inherit',
              background: 'var(--surface-2, rgba(127,127,127,0.08))',
              padding: '0.75rem',
              borderRadius: '0.5rem',
              margin: 0,
            }}
          >
            {snapshot.researchNote}
          </pre>
        </div>

        <p className="footnote">
          This was produced with no credentials. Connect a model provider and enable the news and
          research workers to generate notes like this from real, live sources.
        </p>
      </section>
    );
  },
};
