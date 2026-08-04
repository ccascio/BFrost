import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { DashboardState, PipelineStageSummary, QueueItem, WorkerSummary } from '../app-types';

const LEGACY_PRODUCER_ID = 'legacy.producer';

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
    const producerWorkerId = item.producerWorkerId ?? LEGACY_PRODUCER_ID;
    if (!producerMap.has(producerWorkerId)) {
      producerMap.set(producerWorkerId, { count: 0, types: new Set() });
    }
    const p = producerMap.get(producerWorkerId)!;
    p.count++;
    p.types.add(item.itemType ?? 'legacy.item');

    const consumers = Object.keys(item.metadata ?? {});
    if (consumers.length === 0) unconsumedCount++;
    for (const cId of consumers) {
      if (!consumerMap.has(cId)) consumerMap.set(cId, { count: 0, types: new Set() });
      const c = consumerMap.get(cId)!;
      c.count++;
      if (item.itemType) c.types.add(item.itemType);
    }
  }

  const label = (id: string) =>
    id === LEGACY_PRODUCER_ID
      ? 'Legacy items'
      : workers.find((w) => w.id === id)?.displayName ?? id;

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
    totalItems: items.length,
    unconsumedCount,
  };
}

/**
 * Live pipeline-stage strip: one animated block per registered job that opted in via
 * `pendingCount` + `pipelineStageOrder` on its manifest (see `WorkerJobManifest`). This
 * component has no knowledge of which specific workers those are — it just renders
 * whatever `dashboard.pipelineStages` reports, already sorted by `order`.
 */
export function PipelineStageBlocks({ stages }: { stages: PipelineStageSummary[] }): ReactNode {
  const previousCounts = useRef<Record<string, number>>({});
  const [bumpedIds, setBumpedIds] = useState<Set<string>>(new Set());
  const bumpTimers = useRef<Record<string, number>>({});

  useEffect(() => {
    const prev = previousCounts.current;
    const changed: string[] = [];
    for (const stage of stages) {
      if (prev[stage.jobId] !== undefined && prev[stage.jobId] !== stage.pendingCount) {
        changed.push(stage.jobId);
      }
      prev[stage.jobId] = stage.pendingCount;
    }
    if (changed.length === 0) return;

    setBumpedIds((current) => new Set([...current, ...changed]));
    for (const jobId of changed) {
      if (bumpTimers.current[jobId]) window.clearTimeout(bumpTimers.current[jobId]);
      bumpTimers.current[jobId] = window.setTimeout(() => {
        setBumpedIds((current) => {
          const next = new Set(current);
          next.delete(jobId);
          return next;
        });
      }, 600);
    }
  }, [stages]);

  useEffect(() => {
    return () => {
      for (const timer of Object.values(bumpTimers.current)) window.clearTimeout(timer);
    };
  }, []);

  if (stages.length === 0) {
    return (
      <div className="empty-state">
        <p>No pipeline stages registered yet.</p>
        <p className="footnote">
          Enable a worker that declares a pipeline stage (a job with a pending-item count) to
          see live blocks here.
        </p>
      </div>
    );
  }

  return (
    <div className="pipeline-stage-strip">
      {stages.map((stage, index) => (
        <div key={stage.jobId} style={{ display: 'contents' }}>
          <div
            className={
              'pipeline-stage-block' +
              (stage.pendingCount > 0 ? ' pipeline-stage-active' : '') +
              (stage.running ? ' pipeline-stage-running' : '') +
              (bumpedIds.has(stage.jobId) ? ' pipeline-stage-bump' : '')
            }
          >
            <strong className="pipeline-stage-count">{stage.pendingCount}</strong>
            <span className="pipeline-stage-name">{stage.workerDisplayName}</span>
            <span className="pipeline-stage-job footnote">{stage.jobLabel}</span>
            {/* The counts say what is waiting; this says what is actually moving. */}
            {stage.running ? (
              <span className="pipeline-stage-state running">
                <span className="pipeline-stage-spinner" aria-hidden />
                Running
              </span>
            ) : stage.queued ? (
              <span className="pipeline-stage-state queued">Queued</span>
            ) : null}
          </div>
          {index < stages.length - 1 ? (
            <div className="pipeline-lane pipeline-stage-lane" aria-hidden>
              <div className="pipeline-lane-track">
                <span className="pipeline-dot" style={{ '--dot-delay': '0s' } as CSSProperties} />
                <span className="pipeline-dot" style={{ '--dot-delay': '0.6s' } as CSSProperties} />
              </div>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
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
