import type { ReactNode } from 'react';
import type { DashboardState, SchedulerJobState, SchedulerRunRecord, WorkerSummary } from '../app-types';
import { HelpTip, StatusPill, statusTone, workerHealthLabel, workerHealthTone } from '../app-helpers';

interface JobsTabProps {
  dashboard: DashboardState;
  jobsByWorker: Array<{ worker: WorkerSummary; jobs: SchedulerJobState[] }>;
  selectedJob: SchedulerJobState | null;
  selectedJobRuns: SchedulerRunRecord[];
  setSelectedJobName: (name: string) => void;
  renderJobOperations: (job: SchedulerJobState, runs: SchedulerRunRecord[]) => ReactNode;
}

export function JobsTab(props: JobsTabProps) {
  const {
    dashboard,
    jobsByWorker,
    selectedJob,
    selectedJobRuns,
    setSelectedJobName,
    renderJobOperations,
  } = props;

  return (
    <section className="panel tab-page">
      <div className="panel-head">
        <div>
          <p className="panel-kicker">Cron jobs</p>
          <h2>Schedules and run status <HelpTip>Each worker can run one or more scheduled jobs — cron-based tasks that fire automatically. Select a job on the left to change its schedule, adjust parameters, or trigger it manually. The last-run timestamp and any errors are shown inline.</HelpTip></h2>
        </div>
        <StatusPill tone="muted">{dashboard.cron.timezone}</StatusPill>
      </div>

      <div className="jobs-workspace">
        <div className="jobs">
          {jobsByWorker.map(({ worker, jobs }) => (
            <section className="job-worker-group" key={worker.id}>
              <div className="job-worker-head">
                <div>
                  <p className="panel-kicker">{worker.builtIn ? 'Built-in worker' : 'Local worker'}</p>
                  <h3>{worker.displayName ?? worker.name}</h3>
                  <span>{worker.id} · {worker.enabledJobCount}/{worker.jobCount} jobs enabled</span>
                </div>
                <StatusPill tone={workerHealthTone(worker.healthState)}>
                  {worker.runningJobCount > 0 ? 'running' : workerHealthLabel(worker.healthState)}
                </StatusPill>
              </div>

              <div className="stack-list compact">
                {jobs.map((job) => (
                  <button
                    className={`run-item run-button job-row-button${selectedJob?.name === job.name ? ' selected' : ''}`}
                    key={job.name}
                    type="button"
                    aria-pressed={selectedJob?.name === job.name}
                    onClick={() => setSelectedJobName(job.name)}
                  >
                    <div>
                      <strong>{job.label}</strong>
                      <span>{job.description}</span>
                      <span>{job.enabled ? job.cron : 'disabled'} · {job.effectiveModelAlias}</span>
                    </div>
                    <StatusPill tone={statusTone(job.lastStatus)}>
                      {job.running ? 'running' : job.lastStatus}
                    </StatusPill>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>

        <aside className="queue-detail-column job-detail-column">
          <section className="detail-panel job-detail-panel">
            <div className="panel-head">
              <div>
                <p className="panel-kicker">Job detail</p>
                <h2>{selectedJob?.label ?? 'No job selected'}</h2>
              </div>
              {selectedJob ? (
                <StatusPill tone={statusTone(selectedJob.lastStatus)}>
                  {selectedJob.running ? 'running' : selectedJob.lastStatus}
                </StatusPill>
              ) : null}
            </div>

            {selectedJob ? renderJobOperations(selectedJob, selectedJobRuns) : (
              <p className="empty-state">Select a job row to edit its standard schedule controls and inspect its timeline.</p>
            )}
          </section>
        </aside>
      </div>
    </section>
  );
}
