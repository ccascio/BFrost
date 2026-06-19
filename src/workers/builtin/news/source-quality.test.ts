import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { config } from '../../../config';
import { closeDb } from '../../../sqlite';
import { loadSourceQualityRules, saveSourceQualityRules } from './source-quality';
import { getNewsStoreDir, setNewsStoreDirForTests } from './settings';

test('source quality rules persist to SQLite', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-source-rules-'));
  const previousDbPath = config.appDbPath;
  const previousNewsDir = getNewsStoreDir();
  config.appDbPath = path.join(dir, 'app.sqlite');
  setNewsStoreDirForTests(path.join(dir, 'news'));

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
    setNewsStoreDirForTests(previousNewsDir);
    closeDb();
    await rm(dir, { recursive: true, force: true });
  }
});
