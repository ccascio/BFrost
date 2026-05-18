import { promises as fs } from 'fs';
import { ModelMessage, UserContent } from 'ai';
import { config } from './config';
import { loadKvJson, saveKvJson } from './sqlite';

const MAX_MESSAGES = 30;
const CONVERSATION_STORE_KEY = 'assistant.conversations';

const conversations = new Map<number, ModelMessage[]>();
const selectedModels = new Map<number, string>();
let writeChain: Promise<void> = Promise.resolve();

interface PersistedConversationStore {
  version: 1;
  conversations: Record<string, ModelMessage[]>;
  selectedModels: Record<string, string>;
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
  await writeChain;
}

export function getSelectedModel(chatId: number): string {
  return selectedModels.get(chatId) ?? config.ollamaModel;
}

export function setSelectedModel(chatId: number, modelId: string): void {
  selectedModels.set(chatId, modelId);
  schedulePersist();
}

export function getHistory(chatId: number): ModelMessage[] {
  return conversations.get(chatId) ?? [];
}

export function addUserMessage(chatId: number, content: UserContent): void {
  const history = getHistory(chatId);
  history.push({ role: 'user', content });
  trimAndStore(chatId, history);
}

export function addAssistantMessage(chatId: number, text: string): void {
  const history = getHistory(chatId);
  history.push({ role: 'assistant', content: text });
  trimAndStore(chatId, history);
}

export function clearHistory(chatId: number): void {
  conversations.delete(chatId);
  schedulePersist();
}

function trimAndStore(chatId: number, history: ModelMessage[]): void {
  if (history.length > MAX_MESSAGES) {
    conversations.set(chatId, history.slice(-MAX_MESSAGES));
  } else {
    conversations.set(chatId, history);
  }
  schedulePersist();
}

function schedulePersist(): void {
  const snapshot = buildSnapshot();
  writeChain = writeChain
    .then(() => saveSnapshot(snapshot))
    .catch((err) => {
      console.warn('[Conversation] Failed to persist conversations:', err);
    });
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
  };
}

async function saveSnapshot(snapshot: PersistedConversationStore): Promise<void> {
  await saveKvJson(CONVERSATION_STORE_KEY, snapshot);
}

function hydrateFromStore(parsed: Partial<PersistedConversationStore>): void {
  conversations.clear();
  selectedModels.clear();

  for (const [chatId, history] of Object.entries(parsed.conversations ?? {})) {
    const numericChatId = Number(chatId);
    if (Number.isSafeInteger(numericChatId) && Array.isArray(history)) {
      conversations.set(numericChatId, history.slice(-MAX_MESSAGES));
    }
  }

  for (const [chatId, modelId] of Object.entries(parsed.selectedModels ?? {})) {
    const numericChatId = Number(chatId);
    if (Number.isSafeInteger(numericChatId) && typeof modelId === 'string' && modelId.trim()) {
      selectedModels.set(numericChatId, modelId);
    }
  }
}
