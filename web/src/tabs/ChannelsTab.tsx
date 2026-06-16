// Channels tab — channel-worker connection cards. Extracted from App.tsx
// (CODE_ROADMAP Phase 1.2). Prop-driven.
import { HelpTip, StatusPill } from '../app-helpers';
import type { DashboardState } from '../app-types';
import type { WorkerDashboardViewDefinition } from '../workers/types';

export interface ChannelsTabProps {
  dashboard: DashboardState;
  expandedChannelId: string | null;
  setExpandedChannelId: (id: string | null) => void;
  dashboardViews: WorkerDashboardViewDefinition[];
  fetchDashboard: (preserveDrafts: boolean) => void | Promise<void>;
}

export function ChannelsTab({
  dashboard,
  expandedChannelId,
  setExpandedChannelId,
  dashboardViews,
  fetchDashboard,
}: ChannelsTabProps) {
    const channelWorkers = dashboard!.workers.filter((w) => w.kind === 'channel' && w.enabled);

    if (channelWorkers.length === 0) {
      return (
        <section className="panel tab-page">
          <div className="panel-head">
            <div>
              <p className="panel-kicker">Communication channels</p>
              <h2>Channels <HelpTip>Channels are how BFrost delivers your content and receives your commands. Telegram lets you get a daily news digest as a message; Discord does the same. The dashboard chat is always available as a built-in channel. Enable a channel worker from the Workers tab, then connect it here.</HelpTip></h2>
            </div>
          </div>
          <p className="empty-state">
            No channel workers are installed. Enable a channel worker (Telegram, Discord, …) from the Workers tab to connect it here.
          </p>
        </section>
      );
    }

    return (
      <section className="panel tab-page">
        <div className="panel-head">
          <div>
            <p className="panel-kicker">Communication channels</p>
            <h2>Channels <HelpTip>Channels are how BFrost delivers your content and receives your commands. Telegram lets you get a daily news digest as a message; Discord does the same. The dashboard chat is always available as a built-in channel. Enable a channel worker from the Workers tab, then connect it here.</HelpTip></h2>
          </div>
          <StatusPill tone="muted">
            {`${channelWorkers.filter((w) => w.healthState === 'healthy').length}/${channelWorkers.length} connected`}
          </StatusPill>
        </div>

        <div className="stack-list channel-list">
          {channelWorkers.map((worker) => {
            const isConnected = worker.healthState === 'healthy';
            const isOpen = expandedChannelId === worker.id;
            const connectView = dashboardViews.find(
              (v) => v.workerId === worker.id && v.kind === 'channel-connect',
            );

            return (
              <div key={worker.id} className={`channel-card${isOpen ? ' open' : ''}`}>
                <button
                  type="button"
                  className="channel-card-head run-button"
                  aria-expanded={isOpen}
                  onClick={() => setExpandedChannelId(isOpen ? null : worker.id)}
                >
                  <div className="channel-card-meta">
                    <strong>{worker.displayName ?? worker.name}</strong>
                    <span>{worker.tagline ?? worker.description}</span>
                  </div>
                  <div className="channel-card-actions">
                    <StatusPill tone={isConnected ? 'good' : 'warning'}>
                      {isConnected ? 'Connected' : 'Setup needed'}
                    </StatusPill>
                    <span className="channel-card-caret" aria-hidden="true">{isOpen ? '▲' : '▼'}</span>
                  </div>
                </button>

                {isOpen ? (
                  <div className="channel-card-body">
                    {connectView ? (
                      connectView.render!({ onSaved: () => void fetchDashboard(true) })
                    ) : (
                      <p className="empty-state">
                        This channel worker has no guided setup panel. Configure it from the Config tab.
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
    );
}
