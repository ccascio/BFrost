import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { config } from './config';
import { closeDb } from './sqlite';
import {
  addAssistantMessage,
  addUserMessage,
  clearHistory,
  flushConversations,
  getFullHistory,
  getHistory,
  getSelectedModel,
  hydrateConversations,
  setSelectedModel,
} from './conversation';

test('conversation history and model selections persist to disk', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-conversation-'));
  const previousPath = config.conversationStorePath;
  const previousDbPath = config.appDbPath;
  const previousModel = config.ollamaModel;
  config.conversationStorePath = path.join(dir, 'conversations.json');
  config.appDbPath = path.join(dir, 'app.sqlite');
  config.ollamaModel = 'default-model';

  try {
    clearHistory(123);
    setSelectedModel(123, 'custom-model');
    addUserMessage(123, 'hello');
    addAssistantMessage(123, 'hi there');
    await flushConversations();

    await hydrateConversations();
    assert.equal(getSelectedModel(123), 'custom-model');
    assert.deepEqual(
      getHistory(123).map((message) => message.role),
      ['user', 'assistant'],
    );
  } finally {
    config.conversationStorePath = previousPath;
    config.appDbPath = previousDbPath;
    config.ollamaModel = previousModel;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});

test('full history is stored untrimmed while the model window is capped', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-conversation-'));
  const previousPath = config.conversationStorePath;
  const previousDbPath = config.appDbPath;
  config.conversationStorePath = path.join(dir, 'conversations.json');
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    clearHistory(777);
    for (let i = 0; i < 40; i += 1) {
      addUserMessage(777, `message ${i}`);
    }

    // Storage keeps everything; only the model-facing window is capped at 30.
    assert.equal(getFullHistory(777).length, 40);
    assert.equal(getHistory(777).length, 30);
    assert.equal(getHistory(777)[0].content, 'message 10');

    await flushConversations();
    await hydrateConversations();
    assert.equal(getFullHistory(777).length, 40);
    assert.equal(getHistory(777).length, 30);
  } finally {
    config.conversationStorePath = previousPath;
    config.appDbPath = previousDbPath;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});

test('conversation hydration trims oversized histories', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-conversation-'));
  const previousPath = config.conversationStorePath;
  const previousDbPath = config.appDbPath;
  config.conversationStorePath = path.join(dir, 'conversations.json');
  config.appDbPath = path.join(dir, 'app.sqlite');

  try {
    await writeFile(
      config.conversationStorePath,
      JSON.stringify({
        version: 1,
        conversations: {
          999: Array.from({ length: 35 }, (_, index) => ({
            role: 'user',
            content: `message ${index}`,
          })),
        },
        selectedModels: {},
      }),
      'utf8',
    );

    await hydrateConversations();
    assert.equal(getHistory(999).length, 30);
    assert.equal(getHistory(999)[0].content, 'message 5');
  } finally {
    config.conversationStorePath = previousPath;
    config.appDbPath = previousDbPath;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});
