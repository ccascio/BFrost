import { useEffect, useState } from 'react';
import type { WorkerDashboardViewDefinition } from '../../types';

function ResearchDashboard(ctx: Record<string, any>) {
  const {
    activeWorkerTab,
    dashboard,
    busyKey,
    refreshDashboard,
    triggerRun,
    formatDate,
    eventSeverityTone,
    StatusPill,
  } = ctx;
  const [topicsDraft, setTopicsDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The research worker's slice lives in the generic workerData bag; the platform no
  // longer hoists it to a top-level `dashboard.research` field.
  const researchSlice = (dashboard.workerData?.['core.research'] as any) ?? {
    settings: { topics: [] },
    notes: [],
    events: [],
  };
  const topics: string[] = researchSlice.settings.topics ?? [];

  useEffect(() => {
    setTopicsDraft(topics.join('\n'));
  }, [topics]);

  async function saveTopics() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/research/settings', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topics: topicsDraft
            .split('\n')
            .map((topic) => topic.trim())
            .filter(Boolean),
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok || payload.error) {
        throw new Error(payload.error ?? 'Failed to save topics');
      }
      await refreshDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="grid worker-dashboard-grid tab-page">
      <article className="panel">
        <div className="panel-head">
          <div>
            <p className="panel-kicker">{activeWorkerTab.worker.name}</p>
            <h2>Topics</h2>
          </div>
          <StatusPill tone={topics.length > 0 ? 'info' : 'warning'}>
            {topics.length} topics
          </StatusPill>
        </div>

        <label className="field prompt-field">
          <span>Research topics</span>
          <textarea
            value={topicsDraft}
            onChange={(event) => setTopicsDraft(event.target.value)}
            rows={8}
          />
          <small>One topic per line. The job uses up to five topics per run.</small>
        </label>
        {error ? <p className="error-text">{error}</p> : null}

        <div className="panel-actions wrap">
          <button
            className="primary"
            disabled={saving}
            onClick={() => void saveTopics()}
          >
            {saving ? 'Saving...' : 'Save topics'}
          </button>
          <button
            disabled={busyKey === 'run-personal-research'}
            onClick={() =>
              void triggerRun(
                'run-personal-research',
                '/api/cron-jobs/personal-research/run',
                'Personal Research started.',
              )
            }
          >
            Run research now
          </button>
        </div>
      </article>

      <article className="panel">
        <div className="panel-head">
          <div>
            <p className="panel-kicker">Notes</p>
            <h2>Recent research</h2>
          </div>
        </div>
        <div className="stack-list">
          {researchSlice.notes.map((note: any) => (
            <div className="worker-note" key={note.id}>
              <strong>{note.title}</strong>
              <span>{note.sourceCount} sources · {formatDate(note.createdAt)}</span>
              <span>{note.filePath}</span>
            </div>
          ))}
          {researchSlice.notes.length === 0 ? (
            <p className="empty-state">No research notes yet.</p>
          ) : null}
        </div>
      </article>

      <article className="panel worker-events">
        <div className="panel-head">
          <div>
            <p className="panel-kicker">Progress</p>
            <h2>Research events</h2>
          </div>
        </div>
        <div className="stack-list">
          {researchSlice.events.map((event: any) => (
            <div className="event-row" key={event.id}>
              <div>
                <strong>{event.summary}</strong>
                <span>{event.action} · {formatDate(event.createdAt)}</span>
              </div>
              <StatusPill tone={eventSeverityTone(event.severity)}>{event.severity}</StatusPill>
            </div>
          ))}
          {researchSlice.events.length === 0 ? (
            <p className="empty-state">No research events yet.</p>
          ) : null}
        </div>
      </article>
    </section>
  );
}

export const dashboardView: WorkerDashboardViewDefinition = {
  workerId: 'core.research',
  kind: 'research',
  surfaceIds: ['research-notes', 'research-topics'],
  menu: {
    icon: 'search',
    group: 'Workers',
    order: 40,
    label: 'Research',
  },
  count: ({ dashboard }) => {
    const slice = (dashboard.workerData?.['core.research'] as any) ?? { notes: [] };
    return slice.notes.length;
  },
  render: (ctx) => <ResearchDashboard {...ctx} />,
};
