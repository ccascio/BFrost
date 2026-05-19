# `core.items.query`

Read-only assistant tools that query the BFrost Item Bus and scheduler run history. Lets the
dashboard chat (and any other connected channel) answer questions like:

- "What are the latest news items I have queued?"
- "Show me what got posted to X yesterday."
- "Did the research job run today?"
- "Which jobs failed this week?"

## Tools

### `queryItems`

Filters and returns items from the shared Item Bus. Filters:

- `itemType` / `itemTypes` — `"news.article"`, `"research.note"`, etc.
- `producerWorkerId` — restrict to items produced by a specific worker.
- `tags` — match items carrying any of these tags.
- `states` — `queued`, `approved`, `posted`, `rejected`, `failed`, `seen`, `retrying`.
- `since` — ISO-8601 timestamp; only items added at or after this time.
- `limit` — default 10, capped at 50.

Items are returned newest-first.

### `recentRuns`

Lists records from the scheduler run log. Filters by `jobName` and `status`. Default 10, capped
at 50.

## Permissions

Both tools are read-only and never call out to the network or write to disk. They read from the
shared queue store and the scheduler-runs KV — no external requests, no mutations.

## How the assistant picks them up

The tools register through `listRegisteredTools()` like any other worker tool; `src/agent.ts`
includes them in the system prompt automatically. No core changes needed.
