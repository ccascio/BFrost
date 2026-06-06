import { AsyncLocalStorage } from 'async_hooks';

/**
 * Ambient context for the currently running chat turn. Generic by design: core
 * carries an opaque `conversationId` and an optional `projectId` so that worker
 * tools invoked during the turn can scope themselves (e.g. retrieve only the
 * documents belonging to the active project) without core ever knowing what a
 * worker does with it.
 *
 * Propagation relies on AsyncLocalStorage flowing across `await` boundaries
 * within the same async context. The agent wraps the whole turn — including the
 * AI SDK's `generateText` → tool `execute` await chain — in `runWithChatContext`,
 * so a tool's `execute` reads the same store. Calls made outside a chat turn
 * (cron jobs, manual job runs) see an empty context and must handle that.
 */

export interface ChatContext {
  conversationId?: string;
  projectId?: string | null;
}

const storage = new AsyncLocalStorage<ChatContext>();

export function runWithChatContext<T>(context: ChatContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** The active chat context, or an empty object when invoked outside a chat turn. */
export function getActiveChatContext(): ChatContext {
  return storage.getStore() ?? {};
}
