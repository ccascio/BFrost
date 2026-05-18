# Shared Job Infrastructure

This directory now holds shared backend primitives used by multiple workers.

- `queue.ts`: durable queue item model and transitions
- `queue-service.ts`: dashboard queue actions and snapshots
- `near-duplicates.ts`: URL/title duplicate helpers used by more than one worker

Worker-owned scheduled job implementations live under `src/workers/builtin/*/job.ts`.

The goal is to keep this directory small and shared. If code is only used by one worker, prefer placing it inside that worker folder.
