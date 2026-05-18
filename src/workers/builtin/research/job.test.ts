import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { config } from '../../../config';
import { loadResearchSettings, parseResearchTopics, saveResearchSettings } from './job';

test('parseResearchTopics trims empty values and caps the list', () => {
  assert.deepEqual(
    parseResearchTopics(' local AI agents, , privacy tools, open source llms, evals, memory systems, extra '),
    ['local AI agents', 'privacy tools', 'open source llms', 'evals', 'memory systems'],
  );
});

test('parseResearchTopics returns an empty list for blank config', () => {
  assert.deepEqual(parseResearchTopics('   ,  '), []);
});

test('research settings persist normalized dashboard topics in SQLite', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'bfrost-research-'));
  const previousDbPath = config.appDbPath;
  config.appDbPath = path.join(dir, 'app.sqlite');
  try {
    const saved = await saveResearchSettings({
      topics: [' local AI agents ', '', 'privacy tools', 'open source llms', 'evals', 'memory systems', 'extra'],
    });

    // saveResearchSettings trims whitespace and removes blanks, but no longer caps — maxTopics is a per-run param
    assert.deepEqual(saved.topics, [
      'local AI agents',
      'privacy tools',
      'open source llms',
      'evals',
      'memory systems',
      'extra',
    ]);
    assert.deepEqual(await loadResearchSettings(), saved);
  } finally {
    config.appDbPath = previousDbPath;
    await rm(dir, { recursive: true, force: true });
  }
});
