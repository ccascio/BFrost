import type { CSSProperties, ReactNode } from 'react';
import type { DashboardState, QueueItem, WorkerSummary } from '../app-types';

export interface PipelineNode {
  workerId: string;
  displayName: string;
  count: number;
  itemTypes: string[];
}

export interface PipelineTopology {
  producers: PipelineNode[];
  consumers: PipelineNode[];
  totalItems: number;
  unconsumedCount: number;
}

export function buildPipelineTopology(items: QueueItem[], workers: WorkerSummary[]): PipelineTopology {
  const producerMap = new Map<string, { count: number; types: Set<string> }>();
  const consumerMap = new Map<string, { count: number; types: Set<string> }>();
  let unconsumedCount = 0;

  for (const item of items) {
    if (!item.producerWorkerId) continue;
    if (!producerMap.has(item.producerWorkerId)) {
      producerMap.set(item.producerWorkerId, { count: 0, types: new Set() });
    }
    const p = producerMap.get(item.producerWorkerId)!;
    p.count++;
    if (item.itemType) p.types.add(item.itemType);

    const consumers = Object.keys(item.metadata ?? {});
    if (consumers.length === 0) unconsumedCount++;
    for (const cId of consumers) {
      if (!consumerMap.has(cId)) consumerMap.set(cId, { count: 0, types: new Set() });
      const c = consumerMap.get(cId)!;
      c.count++;
      if (item.itemType) c.types.add(item.itemType);
    }
  }

  const label = (id: string) => workers.find((w) => w.id === id)?.displayName ?? id;

  return {
    producers: [...producerMap.entries()].map(([workerId, d]) => ({
      workerId,
      displayName: label(workerId),
      count: d.count,
      itemTypes: [...d.types],
    })),
    consumers: [...consumerMap.entries()].map(([workerId, d]) => ({
      workerId,
      displayName: label(workerId),
      count: d.count,
      itemTypes: [...d.types],
    })),
    totalItems: items.filter((i) => i.producerWorkerId).length,
    unconsumedCount,
  };
}

export function renderPipelineTab(dashboard: DashboardState, onRunDemo: () => void): ReactNode {
  const topology = buildPipelineTopology(dashboard.queue.recentItems, dashboard.workers);
  const isEmpty = topology.producers.length === 0 && topology.consumers.length === 0;

  return (
    <section className="tab-page pipeline-tab">
      <div className="pipeline-tab-header">
        <p className="panel-kicker">Live view</p>
        <h2>Item Bus Pipeline</h2>
        <p className="footnote">
          Every item in the bus, organised by who produced it and who consumed it.
          Producers publish items; consumers stamp their workerId into the metadata -
          this graph is derived from those stamps alone, with no worker names baked in.
        </p>
      </div>

      {isEmpty ? (
        <section className="panel">
          <div className="empty-state">
            <p>The bus is empty - no items have been produced yet.</p>
            <p className="footnote">
              Run the demo to see a live producer to bus to consumer graph, or enable the
              producer and consumer workers to start a real pipeline.
            </p>
            <div className="panel-actions" style={{ marginTop: '0.5rem' }}>
              <button type="button" className="primary" onClick={onRunDemo}>
                Go to the demo →
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section className="panel pipeline-graph-card">
          <div className="pipeline-graph">
            <div className="pipeline-col pipeline-producers-col" aria-label="Producers">
              <p className="pipeline-col-label">Producers</p>
              {topology.producers.map((node) => (
                <div key={node.workerId} className="pipeline-node pipeline-node-producer">
                  <strong className="pipeline-node-name">{node.displayName}</strong>
                  <span className="pipeline-node-count">{node.count} item{node.count !== 1 ? 's' : ''}</span>
                  <span className="pipeline-node-types footnote">{node.itemTypes.join(' · ')}</span>
                </div>
              ))}
            </div>

            <div className="pipeline-lane" aria-hidden>
              <div className="pipeline-lane-track">
                <span className="pipeline-dot" style={{ '--dot-delay': '0s' } as CSSProperties} />
                <span className="pipeline-dot" style={{ '--dot-delay': '0.5s' } as CSSProperties} />
                <span className="pipeline-dot" style={{ '--dot-delay': '1.0s' } as CSSProperties} />
              </div>
            </div>

            <div className="pipeline-bus-col" aria-label="Item Bus">
              <p className="pipeline-col-label">Item Bus</p>
              <div className="pipeline-bus-node">
                <strong className="pipeline-bus-count">{topology.totalItems}</strong>
                <span className="pipeline-bus-label">items</span>
                {topology.unconsumedCount > 0 ? (
                  <span className="pipeline-bus-inflight footnote">{topology.unconsumedCount} queued</span>
                ) : null}
                {topology.totalItems - topology.unconsumedCount > 0 ? (
                  <span className="pipeline-bus-consumed footnote">{topology.totalItems - topology.unconsumedCount} consumed</span>
                ) : null}
              </div>
            </div>

            <div className="pipeline-lane pipeline-lane-right" aria-hidden>
              <div className="pipeline-lane-track">
                <span className="pipeline-dot" style={{ '--dot-delay': '0.25s' } as CSSProperties} />
                <span className="pipeline-dot" style={{ '--dot-delay': '0.75s' } as CSSProperties} />
                <span className="pipeline-dot" style={{ '--dot-delay': '1.25s' } as CSSProperties} />
              </div>
            </div>

            <div className="pipeline-col pipeline-consumers-col" aria-label="Consumers">
              <p className="pipeline-col-label">Consumers</p>
              {topology.consumers.length > 0 ? topology.consumers.map((node) => (
                <div key={node.workerId} className="pipeline-node pipeline-node-consumer">
                  <strong className="pipeline-node-name">{node.displayName}</strong>
                  <span className="pipeline-node-count">{node.count} consumed</span>
                  <span className="pipeline-node-types footnote">{node.itemTypes.join(' · ')}</span>
                </div>
              )) : (
                <div className="pipeline-node pipeline-node-empty">
                  <span className="pipeline-node-name muted">No consumers yet</span>
                  <span className="pipeline-node-types footnote">Items are queued, waiting to be picked up</span>
                </div>
              )}
            </div>
          </div>

          <p className="footnote pipeline-graph-footer">
            Producers left · consumers right · the bus in the middle. Item types and consumer IDs
            come from the queue - adding a worker that produces or consumes a type updates this graph automatically.
          </p>
        </section>
      )}
    </section>
  );
}
