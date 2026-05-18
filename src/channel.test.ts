import assert from 'node:assert/strict';
import test from 'node:test';
import { conversationStorageId, userStorageId } from './channel';

test('telegram channel converts string ids back to legacy numeric storage ids', () => {
  assert.equal(conversationStorageId({ channel: 'telegram', conversationId: '12345' }), 12345);
  assert.equal(userStorageId({ channel: 'telegram', userId: '67890' }), 67890);
});

test('non-telegram channel storage ids are stable safe integers', () => {
  const first = conversationStorageId({ channel: 'dashboard', conversationId: 'admin' });
  const second = conversationStorageId({ channel: 'dashboard', conversationId: 'admin' });
  const other = conversationStorageId({ channel: 'api', conversationId: 'admin' });

  assert.equal(first, second);
  assert.notEqual(first, other);
  assert.equal(Number.isSafeInteger(first), true);
});
