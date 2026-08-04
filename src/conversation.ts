import { promises as fs } from 'fs';
import { ModelMessage, UserContent } from 'ai';
import { config } from './config';
import { loadKvJson, saveKvJson, saveKvJsonSync } from './sqlite';

/** How many trailing messages are fed to the model. Storage keeps the full history. */
const MODEL_WINDOW = 30;
const CONVERSATION_STORE_KEY = 'assistant.conversations';

const conversations = new Map<number, ModelMessage[]>();
const selectedModels = new Map<number, string>();
const selectedReasoningLevels = new Map<number, string>();

interface PersistedConversationStore {
  version: 1;
  conversations: Record<string, ModelMessage[]>;
  selectedModels: Record<string, string>;
  /** Per-thread reasoning level. Absent for threads that never overrode the platform default. */
  selectedReasoningLevels?: Record<string, string>;
}

export async function hydrateConversations(): Promise<void> {
  const stored = await loadKvJson<Partial<PersistedConversationStore>>(CONVERSATION_STORE_KEY);
  if (stored !== null) {
    hydrateFromStore(stored);
    return;
  }

  try {
    const raw = await fs.readFile(config.conversationStorePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PersistedConversationStore>;
    hydrateFromStore(parsed);
    await saveSnapshot(buildSnapshot());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[Conversation] Failed to load persisted conversations; starting fresh:', err);
    }
  }
}

export async function flushConversations(): Promise<void> {
  // Writes are synchronous; nothing to flush.
}

export function getSelectedModel(chatId: number): string {
  return selectedModels.get(chatId) ?? config.ollamaModel;
}

/**
 * Model this thread was explicitly switched to, if any. Unlike {@link getSelectedModel}
 * this does not fall back to the platform default, so callers can tell "pinned to the
 * model that happens to be the default" from "never chose one".
 */
export function getSelectedModelOverride(chatId: number): string | undefined {
  return selectedModels.get(chatId);
}

export function setSelectedModel(chatId: number, modelId: string): void {
  selectedModels.set(chatId, modelId);
  schedulePersist();
}

/**
 * Reasoning level this thread has been switched to, if any. Undefined means the thread
 * never overrode the platform default and `resolveReasoningLevel` should decide.
 */
export function getSelectedReasoningLevel(chatId: number): string | undefined {
  return selectedReasoningLevels.get(chatId);
}

export function setSelectedReasoningLevel(chatId: number, level: string): void {
  const normalized = level.trim().toLowerCase();
  if (normalized) selectedReasoningLevels.set(chatId, normalized);
  else selectedReasoningLevels.delete(chatId);
  schedulePersist();
}

/**
 * Trailing slice fed to the model. Capped at MODEL_WINDOW so prompts stay
 * bounded; the full thread is preserved in storage and returned by
 * {@link getFullHistory}.
 */
export function getHistory(chatId: number): ModelMessage[] {
  const history = conversations.get(chatId) ?? [];
  return history.length > MODEL_WINDOW ? history.slice(-MODEL_WINDOW) : history;
}

/** Complete, untrimmed history for a thread — used to reopen a chat in the UI. */
export function getFullHistory(chatId: number): ModelMessage[] {
  return conversations.get(chatId) ?? [];
}

export function addUserMessage(chatId: number, content: UserContent): void {
  appendMessage(chatId, { role: 'user', content });
}

export function addAssistantMessage(chatId: number, text: string): void {
  appendMessage(chatId, { role: 'assistant', content: text });
}

export function clearHistory(chatId: number): void {
  conversations.delete(chatId);
  schedulePersist();
}

function appendMessage(chatId: number, message: ModelMessage): void {
  const history = conversations.get(chatId) ?? [];
  history.push(message);
  conversations.set(chatId, history);
  schedulePersist();
}

function schedulePersist(): void {
  try {
    saveKvJsonSync(CONVERSATION_STORE_KEY, buildSnapshot());
  } catch (err) {
    console.warn('[Conversation] Failed to persist conversations:', err);
  }
}

function buildSnapshot(): PersistedConversationStore {
  return {
    version: 1,
    conversations: Object.fromEntries(
      [...conversations.entries()].map(([chatId, history]) => [String(chatId), history]),
    ),
    selectedModels: Object.fromEntries(
      [...selectedModels.entries()].map(([chatId, modelId]) => [String(chatId), modelId]),
    ),
    selectedReasoningLevels: Object.fromEntries(
      [...selectedReasoningLevels.entries()].map(([chatId, level]) => [String(chatId), level]),
    ),
  };
}

async function saveSnapshot(snapshot: PersistedConversationStore): Promise<void> {
  await saveKvJson(CONVERSATION_STORE_KEY, snapshot);
}

function hydrateFromStore(parsed: Partial<PersistedConversationStore>): void {
  conversations.clear();
  selectedModels.clear();
  selectedReasoningLevels.clear();

  for (const [chatId, history] of Object.entries(parsed.conversations ?? {})) {
    const numericChatId = Number(chatId);
    if (Number.isSafeInteger(numericChatId) && Array.isArray(history)) {
      conversations.set(numericChatId, history);
    }
  }

  for (const [chatId, modelId] of Object.entries(parsed.selectedModels ?? {})) {
    const numericChatId = Number(chatId);
    if (Number.isSafeInteger(numericChatId) && typeof modelId === 'string' && modelId.trim()) {
      selectedModels.set(numericChatId, modelId);
    }
  }

  for (const [chatId, level] of Object.entries(parsed.selectedReasoningLevels ?? {})) {
    const numericChatId = Number(chatId);
    if (Number.isSafeInteger(numericChatId) && typeof level === 'string' && level.trim()) {
      selectedReasoningLevels.set(numericChatId, level.trim().toLowerCase());
    }
  }
}
