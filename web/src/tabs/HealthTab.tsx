// Health tab — per-worker job metrics, sparklines, success rates. Extracted from
// App.tsx (CODE_ROADMAP Phase 1.2). The render* helpers are health-only and pure,
// so they live here as module-level functions.
import type { CSSProperties, Dispatch, SetStateAction } from 'react';
import { HelpTip } from '../app-helpers';
import type { DashboardTab, JobMetricsResponse } from '../app-types';

function renderSparkline(statuses: Array<'success' | 'error' | 'skipped'>) {
    if (statuses.length === 0) {
      return (
        <svg className="sparkline sparkline-empty" viewBox="0 0 100 16" aria-hidden="true">
          <line x1="0" y1="8" x2="100" y2="8" stroke="var(--border)" strokeWidth="1" strokeDasharray="3 3" />
        </svg>
      );
    }

    const count = statuses.length;
    const dotR = 3;
    const gap = 2;
    const dotStep = dotR * 2 + gap;
    const totalWidth = count * dotStep - gap;
    const viewW = Math.max(totalWidth, 100);

    const dots = statuses.map((s, i) => {
      const cx = i * dotStep + dotR;
      const cy = 8;
      const fill = s === 'success' ? 'var(--health-ok, #22c55e)'
        : s === 'error' ? 'var(--health-err, #ef4444)'
          : 'var(--health-skip, #a1a1aa)';
      return <circle key={i} cx={cx} cy={cy} r={dotR} fill={fill} />;
    });

    return (
      <svg
        className="sparkline"
        viewBox={`0 0 ${viewW} 16`}
        aria-label={`${statuses.filter((s) => s === 'success').length} of ${count} recent runs succeeded`}
        role="img"
      >
        {dots}
      </svg>
    );
  }

function renderSuccessBar(rate: number | null, total: number) {
    if (rate === null || total === 0) {
      return <span className="success-rate-na footnote">—</span>;
    }
    const pct = Math.round(rate * 100);
    const color = pct >= 90 ? 'var(--health-ok, #22c55e)' : pct >= 70 ? 'var(--health-warn, #f59e0b)' : 'var(--health-err, #ef4444)';
    return (
      <span className="success-rate-pill" style={{ '--rate-color': color } as CSSProperties}>
        <span className="success-rate-bar" style={{ width: `${pct}%`, background: color }} />
        <span className="success-rate-label">{pct}%</span>
      </span>
    );
  }

function renderDurationChip(label: string, ms: number | null) {
    if (ms === null) return null;
    const display = ms >= 60000
      ? `${(ms / 60000).toFixed(1)}m`
      : ms >= 1000
        ? `${(ms / 1000).toFixed(1)}s`
        : `${ms}ms`;
    return <span className="duration-chip footnote">{label} {display}</span>;
  }


export interface HealthTabProps {
  jobMetrics: JobMetricsResponse | null;
  jobMetricsLoading: boolean;
  jobMetricsError: string | null;
  fetchJobMetrics: (force?: boolean) => void | Promise<void>;
  expandedWorkerIds: Set<string>;
  setExpandedWorkerIds: Dispatch<SetStateAction<Set<string>>>;
  setActiveTab: (tab: DashboardTab) => void;
}

export function HealthTab({
  jobMetrics,
  jobMetricsLoading,
  jobMetricsError,
  fetchJobMetrics,
  expandedWorkerIds,
  setExpandedWorkerIds,
  setActiveTab,
}: HealthTabProps) {
    const isLoading = jobMetricsLoading && jobMetrics === null;
    const metrics = jobMetrics;

    // Summary aggregates
    const totalWorkers = metrics?.workers.length ?? 0;
    const overallSuccessRate = (() => {
      if (!metrics || metrics.windowRuns === 0) return null;
      const totalSuccess = metrics.workers.reduce(
        (s, w) => s + w.jobs.reduce((js, j) => js + j.successCount, 0), 0,
      );
      const totalCompleted = metrics.workers.reduce(
        (s, w) => s + w.jobs.reduce((js, j) => js + j.successCount + j.errorCount, 0), 0,
      );
      return totalCompleted > 0 ? totalSuccess / totalCompleted : null;
    })();
    const totalErrors = metrics?.workers.reduce(
      (s, w) => s + w.jobs.reduce((js, j) => js + j.errorCount, 0), 0,
    ) ?? 0;

    return (
      <div className="tab-content health-tab">
        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Observability</p>
              <h2>
                Health
                <HelpTip>
                  Computed from the last {metrics?.windowRuns ?? 200} scheduler run records.
                  Durations exclude skipped runs; percentile statistics require at least 5 completed runs.
                </HelpTip>
              </h2>
            </div>
            <button
              className="btn btn-sm"
              onClick={() => void fetchJobMetrics(true)}
              disabled={jobMetricsLoading}
              aria-label="Refresh health metrics"
            >
              {jobMetricsLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {/* Summary cards */}
          <div className="health-summary-row">
            <div className="health-summary-card">
              <span className="health-summary-value">{totalWorkers}</span>
              <span className="health-summary-label footnote">Workers with runs</span>
            </div>
            <div className="health-summary-card">
              <span className="health-summary-value">{metrics?.windowRuns ?? '—'}</span>
              <span className="health-summary-label footnote">Runs in window</span>
            </div>
            <div className="health-summary-card">
              <span
                className="health-summary-value"
                style={{
                  color: overallSuccessRate === null ? undefined
                    : overallSuccessRate >= 0.9 ? 'var(--health-ok, #22c55e)'
                      : overallSuccessRate >= 0.7 ? 'var(--health-warn, #f59e0b)'
                        : 'var(--health-err, #ef4444)',
                }}
              >
                {overallSuccessRate !== null ? `${Math.round(overallSuccessRate * 100)}%` : '—'}
              </span>
              <span className="health-summary-label footnote">Overall success rate</span>
            </div>
            <div className="health-summary-card">
              <span
                className="health-summary-value"
                style={{ color: totalErrors > 0 ? 'var(--health-err, #ef4444)' : undefined }}
              >
                {metrics ? totalErrors : '—'}
              </span>
              <span className="health-summary-label footnote">Total errors</span>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="health-loading" aria-busy="true" aria-live="polite">
            <span>Loading metrics…</span>
          </div>
        ) : jobMetricsError ? (
          <div className="health-empty">
            <div className="health-empty-icon" aria-hidden="true">⚠️</div>
            <h3>Could not load metrics</h3>
            <p className="footnote">{jobMetricsError}</p>
            <button className="btn btn-sm" onClick={() => void fetchJobMetrics(true)}>Retry</button>
          </div>
        ) : metrics && metrics.workers.length === 0 ? (
          <div className="health-empty">
            <div className="health-empty-icon" aria-hidden="true">📊</div>
            <h3>No run history yet</h3>
            <p className="footnote">
              Once your jobs start running, per-worker metrics will appear here.
              Enable a job in the <button className="link-btn" onClick={() => setActiveTab('jobs')}>Jobs tab</button> to get started.
            </p>
          </div>
        ) : metrics ? (
          <div className="health-workers">
            {metrics.workers.map((worker) => {
              const isExpanded = expandedWorkerIds.has(worker.workerId);
              const toggleExpanded = () => {
                setExpandedWorkerIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(worker.workerId)) next.delete(worker.workerId);
                  else next.add(worker.workerId);
                  return next;
                });
              };

              const successPct = worker.successRate !== null ? Math.round(worker.successRate * 100) : null;
              const rateColor = successPct === null ? undefined
                : successPct >= 90 ? 'var(--health-ok, #22c55e)'
                  : successPct >= 70 ? 'var(--health-warn, #f59e0b)'
                    : 'var(--health-err, #ef4444)';

              return (
                <div key={worker.workerId} className="health-worker-card">
                  <button
                    className="health-worker-header"
                    onClick={toggleExpanded}
                    aria-expanded={isExpanded}
                    aria-controls={`health-worker-jobs-${worker.workerId}`}
                  >
                    <div className="health-worker-title">
                      <span className="health-worker-name">{worker.workerName}</span>
                      <span className="health-worker-id footnote">{worker.workerId}</span>
                    </div>
                    <div className="health-worker-stats">
                      {successPct !== null && (
                        <span className="health-rate-badge" style={{ color: rateColor }}>
                          {successPct}%
                        </span>
                      )}
                      <span className="footnote health-run-count">{worker.totalRuns} runs</span>
                      {renderDurationChip('p50', worker.p50Ms)}
                      {renderDurationChip('p95', worker.p95Ms)}
                      <span className="health-expand-icon" aria-hidden="true">{isExpanded ? '▲' : '▼'}</span>
                    </div>
                  </button>

                  {/* Per-job rows */}
                  <div
                    id={`health-worker-jobs-${worker.workerId}`}
                    className={`health-worker-jobs${isExpanded ? ' is-expanded' : ''}`}
                    hidden={!isExpanded}
                  >
                    {worker.jobs.map((job) => (
                      <div key={job.jobName} className="health-job-row">
                        <div className="health-job-sparkline">
                          {renderSparkline(job.recentStatuses)}
                        </div>
                        <div className="health-job-info">
                          <span className="health-job-label">{job.jobLabel}</span>
                          <span className="health-job-counts footnote">
                            {job.successCount}✓ {job.errorCount > 0 ? `${job.errorCount}✗ ` : ''}{job.skippedCount > 0 ? `${job.skippedCount}↷` : ''}
                          </span>
                        </div>
                        <div className="health-job-rate">
                          {renderSuccessBar(job.successRate, job.totalRuns)}
                        </div>
                        <div className="health-job-duration">
                          {renderDurationChip('p50', job.p50Ms)}
                          {renderDurationChip('p95', job.p95Ms)}
                        </div>
                        {job.lastFailureReason && (
                          <div className="health-job-failure footnote" title={job.lastFailureReason}>
                            ⚠ {job.lastFailureReason.length > 80
                              ? `${job.lastFailureReason.slice(0, 80)}…`
                              : job.lastFailureReason}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        {metrics && (
          <p className="health-computed-at footnote" aria-live="polite">
            Computed at {new Date(metrics.computedAt).toLocaleTimeString()}
          </p>
        )}
      </div>
    );
}
