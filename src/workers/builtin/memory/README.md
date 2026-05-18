# `core.memory`

Long-term assistant memory backed by local embeddings. Reference implementation of a **tool worker** — exposes callable tools to the assistant rather than running scheduled jobs.

## Tools

- `saveMemory(content: string, tags?: string[])` — persists a memory record under the agent's namespace.
- `recallMemory(query: string, limit?: number)` — returns the top-k semantically similar memories.

Both tools are auto-discovered by `src/agent.ts` via `listRegisteredTools()`. No core code names these tools individually.

## Storage

- Per-worker SQLite tables via `openWorkerDb('core.memory')`: one table for memory records, one for embedding vectors.
- Embeddings are computed by the active model provider when its capability flags include `embeddings`.

## Operational notes

- The Memory worker does not consume Item Bus items. If you want the assistant to remember items from the queue, write a thin local worker that subscribes to your `itemType` and calls `saveMemory` from its job runner.
- Disable the worker to remove memory tools from the assistant's catalog cleanly.
