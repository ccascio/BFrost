import { loadKvJson, saveKvJsonSync } from './sqlite';
import { clearHistory } from './conversation';

/**
 * Generic chat-thread registry. Core knows about threads (a labelled, durable
 * conversation a user can list, reopen, rename, and delete) but nothing about
 * workers, item types, or channels beyond the opaque channel string. The
 * message bodies themselves live in `conversation.ts`, keyed by the numeric
 * `chatId`; this module only tracks the metadata needed to surface a history.
 *
 * `conversationId` is the durable string id the caller mints; `chatId` is the
 * hashed numeric id derived from it by the channel layer. Callers always supply
 * `chatId` so this module never has to depend on `channel.ts` (avoids a cycle).
 */

const THREADS_STORE_KEY = 'assistant.threads';
const MAX_TITLE_LENGTH = 60;

export interface ChatThread {
  conversationId: string;
  chatId: number;
  channel: string;
  title: string;
  createdAt: string;
  lastMessageAt: string;
  /** Optional project grouping. Populated in PR2; core treats it as an opaque id. */
  projectId?: string | null;
}

interface PersistedThreadStore {
  version: 1;
  threads: ChatThread[];
}

const threads = new Map<string, ChatThread>();

export async function hydrateThreads(): Promise<void> {
  threads.clear();
  const stored = await loadKvJson<Partial<PersistedThreadStore>>(THREADS_STORE_KEY);
  for (const thread of stored?.threads ?? []) {
    if (isValidThread(thread)) {
      threads.set(thread.conversationId, normalizeThread(thread));
    }
  }
}

export async function flushThreads(): Promise<void> {
  // Writes are synchronous; nothing to flush.
}

/** Threads newest-activity first, optionally filtered to a single channel. */
export function listThreads(channel?: string): ChatThread[] {
  return [...threads.values()]
    .filter((thread) => (channel ? thread.channel === channel : true))
    .sort((a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt));
}

export function getThread(conversationId: string): ChatThread | undefined {
  return threads.get(conversationId);
}

export function createThread(input: {
  channel: string;
  conversationId: string;
  chatId: number;
  title?: string;
  projectId?: string | null;
}): ChatThread {
  const existing = threads.get(input.conversationId);
  if (existing) return existing;
  const now = new Date().toISOString();
  const thread: ChatThread = {
    conversationId: input.conversationId,
    chatId: input.chatId,
    channel: input.channel,
    title: input.title?.trim() || 'New chat',
    createdAt: now,
    lastMessageAt: now,
    projectId: input.projectId ?? null,
  };
  threads.set(thread.conversationId, thread);
  schedulePersist();
  return thread;
}

export function renameThread(conversationId: string, title: string): ChatThread | undefined {
  const thread = threads.get(conversationId);
  if (!thread) return undefined;
  thread.title = clampTitle(title) || thread.title;
  schedulePersist();
  return thread;
}

/** Assign (or clear, with null) the project grouping of an existing thread. */
export function assignThreadProject(conversationId: string, projectId: string | null): ChatThread | undefined {
  const thread = threads.get(conversationId);
  if (!thread) return undefined;
  thread.projectId = projectId;
  schedulePersist();
  return thread;
}

/** Detach every thread from a project (used when that project is deleted). */
export function clearProjectFromThreads(projectId: string): number {
  let cleared = 0;
  for (const thread of threads.values()) {
    if (thread.projectId === projectId) {
      thread.projectId = null;
      cleared += 1;
    }
  }
  if (cleared > 0) schedulePersist();
  return cleared;
}

export function deleteThread(conversationId: string): boolean {
  const thread = threads.get(conversationId);
  if (!thread) return false;
  threads.delete(conversationId);
  clearHistory(thread.chatId);
  schedulePersist();
  return true;
}

/**
 * Record activity on a thread, creating it if this is the first message. The
 * first user message seeds the title. Called on every processed turn so any
 * channel's conversations show up in the history with sensible labels.
 */
export function touchThread(input: {
  channel: string;
  conversationId: string;
  chatId: number;
  text?: string;
  projectId?: string | null;
}): ChatThread {
  const now = new Date().toISOString();
  const existing = threads.get(input.conversationId);
  if (existing) {
    existing.lastMessageAt = now;
    if (existing.title === 'New chat' && input.text?.trim()) {
      existing.title = clampTitle(input.text);
    }
    // Keep the thread's project grouping in sync when the turn names a project.
    if (input.projectId !== undefined) {
      existing.projectId = input.projectId;
    }
    schedulePersist();
    return existing;
  }
  const thread: ChatThread = {
    conversationId: input.conversationId,
    chatId: input.chatId,
    channel: input.channel,
    title: input.text?.trim() ? clampTitle(input.text) : 'New chat',
    createdAt: now,
    lastMessageAt: now,
    projectId: input.projectId ?? null,
  };
  threads.set(thread.conversationId, thread);
  schedulePersist();
  return thread;
}

function clampTitle(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (!oneLine) return '';
  return oneLine.length > MAX_TITLE_LENGTH ? `${oneLine.slice(0, MAX_TITLE_LENGTH - 1)}…` : oneLine;
}

function isValidThread(value: unknown): value is ChatThread {
  const thread = value as Partial<ChatThread>;
  return (
    typeof thread?.conversationId === 'string' &&
    Number.isSafeInteger(thread.chatId) &&
    typeof thread.channel === 'string'
  );
}

function normalizeThread(thread: ChatThread): ChatThread {
  return {
    conversationId: thread.conversationId,
    chatId: thread.chatId,
    channel: thread.channel,
    title: thread.title?.trim() || 'New chat',
    createdAt: thread.createdAt ?? new Date().toISOString(),
    lastMessageAt: thread.lastMessageAt ?? thread.createdAt ?? new Date().toISOString(),
    projectId: thread.projectId ?? null,
  };
}

function schedulePersist(): void {
  try {
    saveKvJsonSync(THREADS_STORE_KEY, { version: 1, threads: [...threads.values()] });
  } catch (err) {
    console.warn('[ChatThreads] Failed to persist thread registry:', err);
  }
}
