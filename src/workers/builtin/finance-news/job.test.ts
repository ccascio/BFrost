import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FinanceNewsParamsSchema,
  DEFAULT_FINANCE_NEWS_PARAMS,
  buildQueries,
  tagCategory,
  matchTickers,
  parseRelevanceDecisions,
} from './job';

test('params schema fills defaults and coerces bad input', () => {
  const parsed = FinanceNewsParamsSchema.parse({});
  assert.ok(parsed.watchlist.length >= 1);
  assert.ok(parsed.categories.length >= 1);
  assert.equal(parsed.relevanceFilter, true);
  assert.equal(parsed.notifyOnRelevant, false);
  assert.equal(parsed.investorLens, 'none');

  // Invalid investorLens falls back to 'none' rather than throwing.
  const coerced = FinanceNewsParamsSchema.parse({ ...DEFAULT_FINANCE_NEWS_PARAMS, investorLens: 'not-a-lens' });
  assert.equal(coerced.investorLens, 'none');
});

test('buildQueries makes one query per name with OR-ed category keywords', () => {
  const queries = buildQueries(['AAPL', 'NVDA'], ['earnings', 'ratings']);
  assert.equal(queries.length, 2);
  assert.equal(queries[0].name, 'AAPL');
  assert.match(queries[0].query, /^"AAPL" \(/);
  assert.match(queries[0].query, /earnings/);
  assert.match(queries[0].query, /upgrade|downgrade|price target/);
  // No category keywords from unselected groups.
  assert.doesNotMatch(queries[0].query, /merger/);
});

test('tagCategory classifies by keyword, defaults to general', () => {
  assert.equal(tagCategory('Apple beats on Q3 earnings and raises guidance'), 'earnings');
  assert.equal(tagCategory('Analyst upgrades NVDA to buy, lifts price target'), 'ratings');
  assert.equal(tagCategory('A quiet day at the office'), 'general');
});

test('matchTickers includes the producing name plus any mentioned', () => {
  const hits = matchTickers('AAPL and Microsoft announce a deal', ['AAPL', 'Microsoft', 'NVDA'], 'AAPL');
  assert.ok(hits.includes('AAPL'));
  assert.ok(hits.includes('Microsoft'));
  assert.ok(!hits.includes('NVDA'));
  // Producing name is always present even if not in the text.
  assert.ok(matchTickers('unrelated text', ['AAPL'], 'AAPL').includes('AAPL'));
});

test('parseRelevanceDecisions extracts a url-keyed map from noisy output', () => {
  const raw =
    'Here is the JSON:\n[{"url":"https://x.com/a","relevant":true,"reason":"earnings beat"},' +
    '{"url":"https://x.com/b","relevant":false,"reason":"recap"}] done';
  const map = parseRelevanceDecisions(raw);
  assert.equal(map.size, 2);
  assert.equal(map.get('https://x.com/a')?.relevant, true);
  assert.equal(map.get('https://x.com/b')?.relevant, false);
});
