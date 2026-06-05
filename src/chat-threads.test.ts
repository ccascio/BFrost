import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { config } from './config';
import { closeDb } from './sqlite';
import { addUserMessage, getFullHistory } from './conversation';
import {
  createThread,
  deleteThread,
  flushThreads,
  getThread,
  hydrateThreads,
  listThreads,
  renameThread,
  touchThread,
} from './chat-threads';

async function withTempDb(run: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-threads-'));
  const previousDbPath = config.appDbPath;
  config.appDbPath = path.join(dir, 'app.sqlite');
  try {
    await hydrateThreads();
    await run();
  } finally {
    config.appDbPath = previousDbPath;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
}

test('touchThread creates a thread and seeds its title from the first message', async () => {
  await withTempDb(async () => {
    touchThread({ channel: 'dashboard', conversationId: 'c1', chatId: 11, text: 'What is the queue status today?' });
    const thread = getThread('c1');
    assert.ok(thread);
    assert.equal(thread?.title, 'What is the queue status today?');
    assert.equal(thread?.channel, 'dashboard');

    // A second message does not overwrite the established title.
    touchThread({ channel: 'dashboard', conversationId: 'c1', chatId: 11, text: 'and tomorrow?' });
    assert.equal(getThread('c1')?.title, 'What is the queue status today?');
  });
});

test('listThreads filters by channel and sorts newest activity first', async () => {
  await withTempDb(async () => {
    const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
    touchThread({ channel: 'dashboard', conversationId: 'a', chatId: 1, text: 'first' });
    await tick();
    touchThread({ channel: 'telegram', conversationId: 'b', chatId: 2, text: 'other channel' });
    await tick();
    touchThread({ channel: 'dashboard', conversationId: 'c', chatId: 3, text: 'newest' });

    const dashboard = listThreads('dashboard');
    assert.deepEqual(dashboard.map((t) => t.conversationId), ['c', 'a']);
    assert.equal(listThreads().length, 3);
  });
});

test('rename and delete update the registry and clear history', async () => {
  await withTempDb(async () => {
    createThread({ channel: 'dashboard', conversationId: 'x', chatId: 99 });
    addUserMessage(99, 'hello');
    assert.equal(getFullHistory(99).length, 1);

    renameThread('x', 'Renamed chat');
    assert.equal(getThread('x')?.title, 'Renamed chat');

    assert.equal(deleteThread('x'), true);
    assert.equal(getThread('x'), undefined);
    assert.equal(getFullHistory(99).length, 0);
    assert.equal(deleteThread('x'), false);
  });
});

test('threads persist across hydration', async () => {
  await withTempDb(async () => {
    createThread({ channel: 'dashboard', conversationId: 'persist', chatId: 42, title: 'Keep me' });
    await flushThreads();

    await hydrateThreads();
    const thread = getThread('persist');
    assert.ok(thread);
    assert.equal(thread?.title, 'Keep me');
    assert.equal(thread?.chatId, 42);
  });
});
