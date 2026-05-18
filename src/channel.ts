import { createHash } from 'crypto';
import { processMessage, type AgentResponse } from './agent';

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
}

export async function processChannelMessage(message: ChannelMessage): Promise<AgentResponse> {
  return processMessage({
    chatId: conversationStorageId(message),
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
