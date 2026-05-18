import assert from 'node:assert/strict';
import test from 'node:test';
import { QueueItem } from '../../../jobs/queue';
import { buildTweetSignature, fitTweetText, resolveSelectedCandidate } from './job';

function queueItem(url: string): QueueItem {
  return {
    id: `q_${url.length}`,
    title: 'AI story',
    shortDesc: 'Short description',
    url,
    addedAt: '2026-04-25T08:00:00.000Z',
    state: 'approved',
    stateChangedAt: '2026-04-25T08:00:00.000Z',
  };
}

test('tweet selector resolves numeric item selections', () => {
  const candidates = [
    queueItem('https://example.com/first'),
    queueItem('https://example.com/second'),
  ];

  const selected = resolveSelectedCandidate({ itemNumber: 2 }, candidates);

  assert.equal(selected?.url, 'https://example.com/second');
});

test('tweet selector resolves harmless URL variants to candidate URLs', () => {
  const candidates = [
    queueItem('https://www.island.lk/ai-chatbots-could-be-making-you-stupider/?utm_source=feed'),
  ];

  const selected = resolveSelectedCandidate(
    { url: 'http://island.lk/ai-chatbots-could-be-making-you-stupider/' },
    candidates,
  );

  assert.equal(selected?.url, candidates[0].url);
});

test('tweet selector rejects invented URLs', () => {
  const candidates = [
    queueItem('https://example.com/real-story'),
  ];

  const selected = resolveSelectedCandidate({ url: 'https://example.com/invented-story' }, candidates);

  assert.equal(selected, null);
});

test('tweet signature returns the configured signature verbatim', () => {
  assert.equal(buildTweetSignature(' — example.com'), ' — example.com');
});

test('tweet text is trimmed when body + signature exceed the limit', () => {
  const body = 'A'.repeat(260);
  const signature = ' — example.com/some/long/path';
  const tweet = fitTweetText(body, signature);

  assert.equal([...tweet].length <= 280, true);
  assert.equal(tweet.endsWith(signature), true);
});
