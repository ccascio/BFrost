import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { config } from '../../../config';
import { loadSourceQualityRules, saveSourceQualityRules } from './source-quality';

test('source quality rules persist to SQLite', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-source-rules-'));
  const previousDbPath = config.appDbPath;
  const previousNewsDir = config.newsStoreDir;
  config.appDbPath = path.join(dir, 'app.sqlite');
  config.newsStoreDir = path.join(dir, 'news');

  try {
    await saveSourceQualityRules({
      minScore: 2,
      allowHosts: ['Example.com'],
      blockHosts: ['blocked.example'],
      preferredHosts: ['preferred.example'],
      lowQualityHosts: ['low.example'],
    });

    const rules = await loadSourceQualityRules();
    assert.equal(rules.minScore, 2);
    assert.deepEqual(rules.allowHosts, ['example.com']);
    assert.deepEqual(rules.blockHosts, ['blocked.example']);
  } finally {
    config.appDbPath = previousDbPath;
    config.newsStoreDir = previousNewsDir;
    await rm(dir, { recursive: true, force: true });
  }
});
