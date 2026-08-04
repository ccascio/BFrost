import assert from 'node:assert/strict';
import test from 'node:test';
import { Telegraf } from 'telegraf';
import { stopTelegramBot } from './adapter';

test('stopping Telegram before polling starts is a no-op', () => {
  const bot = new Telegraf('not-a-real-token');

  assert.doesNotThrow(() => {
    stopTelegramBot(bot, 'SIGTERM');
    stopTelegramBot(bot, 'SIGTERM');
  });
});

test('unexpected Telegram stop errors are still propagated', () => {
  const bot = {
    stop() {
      throw new Error('unexpected stop failure');
    },
  } as unknown as Telegraf;

  assert.throws(() => stopTelegramBot(bot, 'SIGTERM'), /unexpected stop failure/);
});
