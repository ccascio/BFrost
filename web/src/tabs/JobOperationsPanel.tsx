import type { Dispatch, SetStateAction } from 'react';
import type {
  DashboardState,
  JobDraft,
  JobParamDraftValue,
  JobPreset,
  SchedulerJobState,
  SchedulerRunRecord,
} from '../app-types';
import {
  Detail,
  DetailBlock,
  RunError,
  StatusPill,
  buildJobParamsDraft,
  fieldDefaultDraftValue,
  formatDate,
  jobScheduleChanges,
  runDuration,
  runSeverity,
  runStatusSummary,
  runStatusTone,
  serializeJobParams,
} from '../app-helpers';
import { AlertDialog, Button, CronBuilder, Progress } from '../ui';
import { DashboardFieldEditor } from './DashboardFieldEditor';

type Mutate = (
  key: string,
  input: RequestInfo,
  init: RequestInit,
  successMessage: string,
) => void | Promise<void>;

type TriggerRun = (key: string, url: string, successMessage: string) => void | Promise<void>;

interface JobOperationsPanelProps {
  dashboard: DashboardState;
  job: SchedulerJobState;
  runs: SchedulerRunRecord[];
  busyKey: string | null;
  jobDrafts: Record<string, JobDraft>;
  setJobDrafts: Dispatch<SetStateAction<Record<string, JobDraft>>>;
  confirmSaveJobName: string | null;
  setConfirmSaveJobName: Dispatch<SetStateAction<string | null>>;
  openPromptEditors: Record<string, boolean>;
  setOpenPromptEditors: Dispatch<SetStateAction<Record<string, boolean>>>;
  customListItemDrafts: Record<string, string>;
  setCustomListItemDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  mutate: Mutate;
  triggerRun: TriggerRun;
}

export function JobOperationsPanel({
  dashboard,
  job,
  runs,
  busyKey,
  jobDrafts,
  setJobDrafts,
  confirmSaveJobName,
  setConfirmSaveJobName,
  openPromptEditors,
  setOpenPromptEditors,
  customListItemDrafts,
  setCustomListItemDrafts,
  mutate,
  triggerRun,
}: JobOperationsPanelProps) {
  const draft = jobDrafts[job.name] ?? buildDraft(job);
  const changes = jobScheduleChanges(job, draft);
  const runningRun = job.running
    ? runs.find((run) => run.status === 'running' || run.finishedAt === null)
    : null;

  return (
    <div className="detail-body">
      {!job.workerEnabled ? <p className="error-box">Worker disabled. Enable it from Workers to run this job.</p> : null}
      {job.running ? (
        <div className="job-running-progress">
          <Progress
            value={null}
            label={runningRun?.startedAt ? `Running since ${formatDate(runningRun.startedAt)}` : 'Job running'}
            tone="warning"
          />
        </div>
      ) : null}

      <div className="job-grid standard-job-grid">
        <label className="field checkbox">
          <span>Enabled</span>
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) =>
              setJobDrafts((current) => ({
                ...current,
                [job.name]: { ...draft, enabled: event.target.checked },
              }))
            }
          />
        </label>

        <div className="field cron-builder-field">
          <span>Schedule</span>
          <CronBuilder
            value={draft.cron}
            onChange={(cron) =>
              setJobDrafts((current) => ({
                ...current,
                [job.name]: { ...draft, cron },
              }))
            }
          />
        </div>

        <label className="field">
          <span>Model override</span>
          <select
            value={draft.modelAlias}
            onChange={(event) =>
              setJobDrafts((current) => ({
                ...current,
                [job.name]: { ...draft, modelAlias: event.target.value },
              }))
            }
          >
            <option value="">Use default model</option>
            {dashboard.models.map((model) => (
              <option key={model.alias} value={model.alias}>
                {model.label}
              </option>
            ))}
          </select>
        </label>

        {job.approvalRequiredEditable ? (
          <label className="field checkbox">
            <span>Require approval</span>
            <input
              type="checkbox"
              checked={draft.approvalRequired}
              onChange={(event) =>
                setJobDrafts((current) => ({
                  ...current,
                  [job.name]: { ...draft, approvalRequired: event.target.checked },
                }))
              }
            />
          </label>
        ) : null}
      </div>

      <div className="panel-actions wrap">
        <button
          className="primary"
          disabled={jobDrafts[job.name] === undefined || confirmSaveJobName === job.name}
          onClick={() => setConfirmSaveJobName(job.name)}
        >
          Save schedule
        </button>
        <button
          disabled={busyKey === `run-${job.name}` || job.running || !job.workerEnabled}
          onClick={() =>
            void triggerRun(
              `run-${job.name}`,
              `/api/cron-jobs/${job.name}/run`,
              `${job.label} started.`,
            )
          }
        >
          {job.running ? 'Running...' : 'Run now'}
        </button>
        {jobDrafts[job.name] !== undefined ? (
          <button
            type="button"
            onClick={() => {
              setConfirmSaveJobName(null);
              discardJobDraft(job.name, setJobDrafts);
            }}
          >
            Discard changes
          </button>
        ) : null}
      </div>

      {(job.dashboardFields.length > 0 || job.promptEditable) ? (
        <JobConfiguration
          job={job}
          draft={draft}
          busyKey={busyKey}
          jobDrafts={jobDrafts}
          setJobDrafts={setJobDrafts}
          openPromptEditors={openPromptEditors}
          setOpenPromptEditors={setOpenPromptEditors}
          customListItemDrafts={customListItemDrafts}
          setCustomListItemDrafts={setCustomListItemDrafts}
          mutate={mutate}
        />
      ) : null}

      <JobTimeline job={job} runs={runs} />

      <AlertDialog
        open={confirmSaveJobName === job.name}
        onOpenChange={(open) => {
          if (!open) setConfirmSaveJobName(null);
        }}
        title={`Save schedule for ${job.label}?`}
        description="Review the operational changes before they affect future runs."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmSaveJobName(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={busyKey === `save-${job.name}` || changes.length === 0}
              onClick={() => {
                setConfirmSaveJobName(null);
                void mutate(
                  `save-${job.name}`,
                  `/api/cron-jobs/${job.name}`,
                  {
                    method: 'POST',
                    body: JSON.stringify({
                      enabled: draft.enabled,
                      cron: draft.cron,
                      modelAlias: draft.modelAlias,
                      approvalRequired: draft.approvalRequired,
                    }),
                  },
                  `${job.label} schedule saved.`,
                );
              }}
            >
              Confirm save
            </Button>
          </>
        }
      >
        {changes.length === 0 ? (
          <p className="schedule-preview-no-changes">No changes to save.</p>
        ) : (
          <table className="schedule-preview-table">
            <thead>
              <tr><th>Field</th><th>Current</th><th>New value</th></tr>
            </thead>
            <tbody>
              {changes.map((change) => (
                <tr key={change.field}>
                  <td>{change.field}</td>
                  <td className="schedule-preview-old">{change.from}</td>
                  <td className="schedule-preview-new">{change.to}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </AlertDialog>
    </div>
  );
}

interface JobConfigurationProps {
  job: SchedulerJobState;
  draft: JobDraft;
  busyKey: string | null;
  jobDrafts: Record<string, JobDraft>;
  setJobDrafts: Dispatch<SetStateAction<Record<string, JobDraft>>>;
  openPromptEditors: Record<string, boolean>;
  setOpenPromptEditors: Dispatch<SetStateAction<Record<string, boolean>>>;
  customListItemDrafts: Record<string, string>;
  setCustomListItemDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  mutate: Mutate;
}

function JobConfiguration({
  job,
  draft,
  busyKey,
  jobDrafts,
  setJobDrafts,
  openPromptEditors,
  setOpenPromptEditors,
  customListItemDrafts,
  setCustomListItemDrafts,
  mutate,
}: JobConfigurationProps) {
  const promptEditorOpen = openPromptEditors[job.name] ?? false;

  function applyPreset(preset: JobPreset) {
    const presetParams: Record<string, JobParamDraftValue> = {};
    for (const [key, value] of Object.entries(preset.params ?? {})) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        presetParams[key] = value;
      }
    }
    setJobDrafts((current) => ({
      ...current,
      [job.name]: {
        ...draft,
        cron: preset.cron ?? draft.cron,
        params: { ...(draft.params ?? {}), ...presetParams },
      },
    }));
  }

  return (
    <div className="detail-body">
      {job.presets.length > 0 ? (
        <div className="panel-actions wrap" style={{ marginBottom: '0.75rem' }}>
          <span className="footnote" style={{ marginRight: '0.25rem' }}>Recipes:</span>
          {job.presets.map((preset) => {
            const presetApplied =
              (preset.cron === undefined || preset.cron === draft.cron) &&
              Object.entries(preset.params ?? {}).every(([key, value]) => draft.params[key] === value);
            return (
              <button
                key={preset.id}
                type="button"
                className={`preset-chip${presetApplied ? ' active' : ''}`}
                aria-pressed={presetApplied}
                title={preset.description}
                onClick={() => applyPreset(preset)}
              >
                {preset.label}
              </button>
            );
          })}
          <span className="footnote" style={{ flexBasis: '100%', marginTop: '0.25rem' }}>
            Click a recipe to fill the form. Nothing saves until you press Save below.
          </span>
        </div>
      ) : null}

      <div className="job-grid config-field-grid">
        {job.dashboardFields.map((field) => {
          const value = draft.params[field.key] ?? fieldDefaultDraftValue(field);
          return (
            <DashboardFieldEditor
              key={field.key}
              field={field}
              value={value}
              onChange={(nextValue) =>
                setJobDrafts((current) => ({
                  ...current,
                  [job.name]: {
                    ...draft,
                    params: {
                      ...draft.params,
                      [field.key]: nextValue,
                    },
                  },
                }))
              }
              customListItemDrafts={customListItemDrafts}
              setCustomListItemDrafts={setCustomListItemDrafts}
              draftKey={`${job.name}.${field.key}`}
            />
          );
        })}
      </div>

      {job.promptEditable ? (
        <section className="advanced-settings">
          <button
            type="button"
            className="advanced-settings-toggle"
            aria-expanded={promptEditorOpen}
            onClick={() =>
              setOpenPromptEditors((current) => ({
                ...current,
                [job.name]: !promptEditorOpen,
              }))
            }
          >
            <span>
              <strong>Advanced writing instructions</strong>
              <small>Keep this closed to use the saved prompt.</small>
            </span>
            <span aria-hidden="true">{promptEditorOpen ? 'Hide' : 'Edit'}</span>
          </button>
          {promptEditorOpen ? (
            <label className="field prompt-field advanced-prompt-field">
              <span>Writing instructions</span>
              <textarea
                value={draft.prompt}
                onChange={(event) =>
                  setJobDrafts((current) => ({
                    ...current,
                    [job.name]: { ...draft, prompt: event.target.value },
                  }))
                }
                rows={13}
              />
              {job.promptHelpText ? <small>{job.promptHelpText}</small> : null}
              {job.promptExamples && job.promptExamples.length > 0 ? (
                <div className="prompt-examples">
                  <small>Start from an example:</small>
                  <div className="prompt-example-chips">
                    {job.promptExamples.map((ex) => (
                      <button
                        key={ex.label}
                        type="button"
                        className="chip"
                        title={ex.description}
                        onClick={() =>
                          setJobDrafts((current) => ({
                            ...current,
                            [job.name]: { ...draft, prompt: ex.value },
                          }))
                        }
                      >
                        {ex.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <button
                type="button"
                className="secondary-inline"
                onClick={() =>
                  setJobDrafts((current) => ({
                    ...current,
                    [job.name]: { ...draft, prompt: job.prompt },
                  }))
                }
              >
                Restore saved instructions
              </button>
            </label>
          ) : null}
        </section>
      ) : null}

      <div className="panel-actions wrap">
        <button
          className="primary"
          disabled={busyKey === `config-${job.name}`}
          onClick={() =>
            void mutate(
              `config-${job.name}`,
              `/api/cron-jobs/${job.name}`,
              {
                method: 'POST',
                body: JSON.stringify({
                  modelAlias: draft.modelAlias,
                  prompt: draft.prompt,
                  params: serializeJobParams(job, draft),
                }),
              },
              `${job.label} configuration saved.`,
            )
          }
        >
          Save configuration
        </button>
        {jobDrafts[job.name] !== undefined ? (
          <button
            type="button"
            onClick={() => discardJobDraft(job.name, setJobDrafts)}
          >
            Discard changes
          </button>
        ) : null}
      </div>
    </div>
  );
}

function JobTimeline({ job, runs }: { job: SchedulerJobState; runs: SchedulerRunRecord[] }) {
  const latestFinished = runs.find((run) => run.finishedAt);

  return (
    <div className="detail-body">
      <div className="detail-grid">
        <Detail label="Worker" value={`${job.workerName} (${job.workerId})`} />
        <Detail label="Worker type" value={job.workerBuiltIn ? 'built-in' : 'local'} />
        <Detail label="Enabled" value={job.enabled ? 'yes' : 'no'} />
        <Detail label="Cron" value={job.cron} />
        <Detail label="Effective model" value={job.effectiveModelAlias} />
        <Detail label="Last trigger" value={job.lastTrigger ?? 'n/a'} />
        <Detail label="Last started" value={formatDate(job.lastStartedAt)} />
        <Detail label="Last finished" value={formatDate(job.lastFinishedAt)} />
        <Detail label="Last duration" value={runDuration(latestFinished) ?? 'n/a'} />
        <Detail label="Stored runs" value={String(runs.length)} />
      </div>

      <DetailBlock label="Last summary" value={job.lastSummary ?? undefined} />
      <DetailBlock label="Last error" value={job.lastError ?? undefined} tone="error" />

      <div className="timeline">
        {runs.map((run) => (
          <div className={`timeline-event ${runSeverity(run)}`} key={run.id}>
            <div>
              <strong>{run.summary ?? runStatusSummary(run)}</strong>
              <span>{run.status} · {formatDate(run.startedAt)}</span>
              <span>
                {run.trigger} · {run.modelAlias}
                {typeof run.itemCount === 'number' ? ` · ${run.itemCount} items` : ''}
                {runDuration(run) ? ` · ${runDuration(run)}` : ''}
                {run.attempts.length > 1 ? ` · ${run.attempts.length} attempts` : ''}
              </span>
              {run.error ? <RunError message={run.error} /> : null}
              {run.attempts.length > 1 ? (
                <details className="attempt-details">
                  <summary>Attempt history</summary>
                  <div className="stack-list">
                    {run.attempts.map((attempt) => (
                      <div className="mini-card" key={attempt.attempt}>
                        <strong>Attempt {attempt.attempt}: {attempt.status}</strong>
                        <span className="footnote">
                          {formatDate(attempt.startedAt)} → {formatDate(attempt.finishedAt)}
                          {attempt.nextDelayMs !== undefined ? ` · retried after ${Math.round(attempt.nextDelayMs / 1000)}s` : ''}
                        </span>
                        {attempt.error ? <RunError message={attempt.error} /> : null}
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
            <StatusPill tone={runStatusTone(run.status)}>{run.status}</StatusPill>
          </div>
        ))}
        {runs.length === 0 ? (
          <div className="empty-state">
            <p>This job has not run yet.</p>
            <p className="footnote">
              Click <strong>Run now</strong> in the job row above to trigger it once, or wait for
              its next scheduled time. Runs appear here as soon as the job finishes.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function buildDraft(job: SchedulerJobState): JobDraft {
  return {
    enabled: job.enabled,
    cron: job.cron,
    modelAlias: job.modelAlias,
    approvalRequired: job.approvalRequired,
    prompt: job.prompt,
    params: buildJobParamsDraft(job),
  };
}

function discardJobDraft(
  jobName: string,
  setJobDrafts: Dispatch<SetStateAction<Record<string, JobDraft>>>,
) {
  setJobDrafts((current) => {
    const next = { ...current };
    delete next[jobName];
    return next;
  });
}
