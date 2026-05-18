import assert from 'node:assert/strict';
import test from 'node:test';
import { listRegisteredChannels } from './registry';

test('built-in channel registry exposes the Telegram channel adapter', () => {
  const channels = listRegisteredChannels();
  const telegram = channels.find((channel) => channel.manifest.id === 'telegram');

  assert.ok(telegram, 'Telegram channel should be registered');
  assert.equal(telegram!.worker.id, 'core.channels.telegram');
  assert.equal(telegram!.worker.builtIn, true);
  assert.equal(telegram!.manifest.capabilities.text, true);
  assert.equal(telegram!.manifest.capabilities.audio, true);
  assert.equal(telegram!.factory.channelId, 'telegram');
});

test('channel adapter declares isConfigured/start/stop contract', () => {
  const channels = listRegisteredChannels();
  for (const channel of channels) {
    const adapter = channel.factory.create();
    assert.equal(adapter.channelId, channel.manifest.id);
    assert.equal(typeof adapter.isConfigured, 'function');
    assert.equal(typeof adapter.start, 'function');
    assert.equal(typeof adapter.stop, 'function');
  }
});
