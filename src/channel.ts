import { createHash } from 'crypto';
import { processMessage, type AgentResponse } from './agent';
import { touchThread } from './chat-threads';

/**
 * Channel identifiers are owned by the channel worker that emits them. Core does not
 * enumerate the closed set — that would re-couple us to specific built-in workers.
 *
 * The special-case for `telegram` below preserves numeric Telegram chat/user ids in
 * the existing conversation store; new channels should pass opaque string identifiers
 * and let core derive a stable numeric storage id from them.
 */
export type ChannelName = string;

export interface ChannelMessage {
  channel: ChannelName;
  conversationId: string;
  userId: string;
  username?: string;
  text: string;
  imageBase64?: string;
  imageMimeType?: string;
  /** Optional project grouping to scope the turn (and seed a brand-new thread). */
  projectId?: string | null;
}

export async function processChannelMessage(message: ChannelMessage): Promise<AgentResponse> {
  const chatId = conversationStorageId(message);
  // Register/refresh the thread so the conversation surfaces in chat history.
  const thread = touchThread({
    channel: message.channel,
    conversationId: message.conversationId,
    chatId,
    text: message.text,
    projectId: message.projectId,
  });
  // Scope the turn to the named project, falling back to the thread's grouping.
  const projectId = message.projectId ?? thread.projectId ?? null;
  return processMessage({
    chatId,
    conversationId: message.conversationId,
    projectId,
    userId: userStorageId(message),
    username: message.username,
    message: message.text,
    imageBase64: message.imageBase64,
    imageMimeType: message.imageMimeType,
  });
}

export function conversationStorageId(message: Pick<ChannelMessage, 'channel' | 'conversationId'>): number {
  if (message.channel === 'telegram') {
    const numeric = Number(message.conversationId);
    if (Number.isSafeInteger(numeric)) {
      return numeric;
    }
  }

  return stablePositiveInt(`${message.channel}:conversation:${message.conversationId}`);
}

export function userStorageId(message: Pick<ChannelMessage, 'channel' | 'userId'>): number {
  if (message.channel === 'telegram') {
    const numeric = Number(message.userId);
    if (Number.isSafeInteger(numeric)) {
      return numeric;
    }
  }

  return stablePositiveInt(`${message.channel}:user:${message.userId}`);
}

function stablePositiveInt(value: string): number {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 12);
  return Number.parseInt(hex, 16);
}
