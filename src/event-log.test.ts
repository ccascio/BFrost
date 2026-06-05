import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { config } from './config';
import { closeDb } from './sqlite';
import { listRecentEvents, recordEvent } from './event-log';

test('event log records and lists recent events from SQLite', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-events-'));
  const previousPath = config.appDbPath;
  config.appDbPath = path.join(dir, 'events.sqlite');

  try {
    await recordEvent({
      category: 'test',
      action: 'created',
      summary: 'Recorded a test event.',
      metadata: { value: 42 },
    });

    const events = await listRecentEvents(5);
    assert.equal(events.length, 1);
    assert.equal(events[0].category, 'test');
    assert.equal(events[0].action, 'created');
    assert.equal(events[0].summary, 'Recorded a test event.');
    assert.deepEqual(events[0].metadata, { value: 42 });
  } finally {
    config.appDbPath = previousPath;
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});
