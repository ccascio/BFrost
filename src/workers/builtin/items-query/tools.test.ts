import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { config } from '../../../config';
import { closeDb } from '../../../sqlite';
import { publishItem } from '../../../jobs/item-bus';
import { queryItems } from './tools';

function withTempStore<T>(fn: () => Promise<T>): Promise<T> {
  return (async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-items-query-'));
    const previousDir = config.newsStoreDir;
    const previousDbPath = config.appDbPath;
    config.newsStoreDir = dir;
    config.appDbPath = path.join(dir, 'app.sqlite');
    try {
      return await fn();
    } finally {
      config.newsStoreDir = previousDir;
      config.appDbPath = previousDbPath;
      closeDb();
      await rm(dir, { recursive: true, force: true });
    }
  })();
}

async function seedNewsItem(suffix: string, ts: string) {
  await publishItem({
    producerWorkerId: 'core.news',
    itemType: 'news.article',
    tags: ['news'],
    title: `News ${suffix}`,
    shortDesc: `Short ${suffix}`,
    url: `https://example.com/news/${suffix}`,
    addedAt: ts,
  });
}

test('queryItems returns newest items first and respects limit', async () => {
  await withTempStore(async () => {
    await seedNewsItem('a', '2026-05-01T10:00:00.000Z');
    await seedNewsItem('b', '2026-05-02T10:00:00.000Z');
    await seedNewsItem('c', '2026-05-03T10:00:00.000Z');

    const result = await queryItems({ limit: 2 });
    const aIdx = result.indexOf('News a');
    const bIdx = result.indexOf('News b');
    const cIdx = result.indexOf('News c');

    assert.ok(cIdx >= 0 && bIdx >= 0, 'newest two items are present');
    assert.equal(aIdx, -1, 'limit truncates the oldest item');
    assert.ok(cIdx < bIdx, 'newest item appears first');
    assert.ok(result.includes('showing newest 2'), 'header reflects truncation');
  });
});

test('queryItems filters by producerWorkerId', async () => {
  await withTempStore(async () => {
    await seedNewsItem('news', '2026-05-01T10:00:00.000Z');
    await publishItem({
      producerWorkerId: 'core.research',
      itemType: 'research.note',
      tags: ['research'],
      title: 'Research note',
      shortDesc: 'Notes about something.',
      url: 'https://example.com/research/1',
      addedAt: '2026-05-02T10:00:00.000Z',
    });

    const onlyNews = await queryItems({ producerWorkerId: 'core.news' });
    assert.ok(onlyNews.includes('News news'));
    assert.ok(!onlyNews.includes('Research note'));

    const onlyResearch = await queryItems({ producerWorkerId: 'core.research' });
    assert.ok(onlyResearch.includes('Research note'));
    assert.ok(!onlyResearch.includes('News news'));
  });
});

test('queryItems filters by itemType', async () => {
  await withTempStore(async () => {
    await seedNewsItem('a', '2026-05-01T10:00:00.000Z');
    await publishItem({
      producerWorkerId: 'core.research',
      itemType: 'research.note',
      title: 'Research note',
      shortDesc: 'A note.',
      url: 'https://example.com/research/1',
      addedAt: '2026-05-02T10:00:00.000Z',
    });

    const result = await queryItems({ itemType: 'news.article' });
    assert.ok(result.includes('News a'));
    assert.ok(!result.includes('Research note'));
  });
});

test('queryItems returns a clear empty message when nothing matches', async () => {
  await withTempStore(async () => {
    const empty = await queryItems({});
    assert.match(empty, /No items have been published/);

    await seedNewsItem('a', '2026-05-01T10:00:00.000Z');
    const filtered = await queryItems({ producerWorkerId: 'core.does-not-exist' });
    assert.match(filtered, /No items match/);
    assert.match(filtered, /producerWorkerId="core\.does-not-exist"/);
  });
});

test('queryItems includes producer attribution and short description in output', async () => {
  await withTempStore(async () => {
    await seedNewsItem('a', '2026-05-01T10:00:00.000Z');
    const result = await queryItems({});
    // core.news uses summarizeForAssistant which produces:
    //   • "News a" (from core.news · news.article · queued) — Short a
    //     https://example.com/news/a
    assert.ok(result.includes('core.news'), 'producer attribution present');
    assert.ok(result.includes('news.article'), 'item type present');
    assert.ok(result.includes('Short a'), 'short description present');
    assert.ok(result.includes('https://example.com/news/a'), 'url present');
  });
});
