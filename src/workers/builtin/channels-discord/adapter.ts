import type { ChannelAdapter } from '../../module';
import { resolveDiscordBotToken, resolveDiscordChannelId } from './credentials';

const CHANNEL_ID = 'discord';
const DISCORD_API = 'https://discord.com/api/v10';
const DISCORD_MAX_MESSAGE_CHARS = 2000;

function chunkMessage(text: string): string[] {
  if (text.length <= DISCORD_MAX_MESSAGE_CHARS) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, DISCORD_MAX_MESSAGE_CHARS));
    remaining = remaining.slice(DISCORD_MAX_MESSAGE_CHARS);
  }
  return chunks;
}

export function createDiscordChannelAdapter(): ChannelAdapter {
  return {
    channelId: CHANNEL_ID,
    async isConfigured() {
      const [token, channelId] = await Promise.all([
        resolveDiscordBotToken(),
        resolveDiscordChannelId(),
      ]);
      return Boolean(token && channelId);
    },
    async start() {
      // Send-only adapter — no gateway connection to maintain. The Discord HTTP API is
      // called on demand from notifyOperator(). Two-way receive is a future addition.
    },
    async stop() {
      // No-op.
    },
    async notifyOperator(text: string) {
      const [token, channelId] = await Promise.all([
        resolveDiscordBotToken(),
        resolveDiscordChannelId(),
      ]);
      if (!token || !channelId) return;
      for (const content of chunkMessage(text)) {
        const response = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bot ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content }),
        });
        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new Error(`Discord ${response.status}: ${body || response.statusText}`);
        }
      }
    },
  };
}
