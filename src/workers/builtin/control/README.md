# Conversational Control Panel (`core.control`)

Thin assistant-tool worker that maps natural-language chat commands to BFrost dashboard actions — no round-trip to the admin HTTP API required; all execute functions call internal scheduler and worker-state APIs directly in the same process.

## What it does

When this worker is enabled, the BFrost assistant understands commands like:

- *"Enable the news digest at 8 am"* → `setJobSchedule` + `enableJob`
- *"Run the research job now"* → `triggerJob`
- *"Disable the Twitter publisher worker"* → `disableWorker`
- *"What jobs are scheduled?"* → `listJobs`
- *"Which workers are active?"* → `listWorkers`

## Tools registered

| Tool ID | Name | Intent |
|---|---|---|
| `list-jobs` | `listJobs` | Show all jobs with status, schedule, last run |
| `enable-job` | `enableJob` | Re-enable a disabled job |
| `disable-job` | `disableJob` | Pause a job without changing its schedule |
| `set-job-schedule` | `setJobSchedule` | Change cron + re-enable a job |
| `trigger-job` | `triggerJob` | Kick off a job immediately |
| `list-workers` | `listWorkers` | Show all workers + enabled/disabled state |
| `enable-worker` | `enableWorker` | Enable a worker |
| `disable-worker` | `disableWorker` | Disable a worker |

## Credentials / env vars

None. This worker calls internal APIs only.

## Settings

None. Enable/disable the worker from the Workers tab.

## Permissions declared

- `storage:read` — read scheduler snapshot and worker state (read-only tools)
- `scheduler:write` — update cron schedules, enable/disable jobs, trigger jobs
- `workers:write` — enable/disable workers

## Operational notes

- Job names are resolved with fuzzy matching: the model can pass `"news"` and the tool will match `"news-digest"` if that is the only job whose label contains "news".
- Worker IDs are similarly resolved by id, display name, or tagline fragment — `"telegram"` resolves to `core.channels.telegram`.
- Enabling/disabling a worker persists to `worker.state` KV immediately; jobs tied to that worker will stop/start at the next scheduler tick (within 1 minute).
- `triggerJob` fires the job asynchronously. The model should tell the user to check the Jobs tab for progress rather than waiting for a synchronous result.
