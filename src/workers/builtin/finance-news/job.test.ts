import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FinanceNewsParamsSchema,
  DEFAULT_FINANCE_NEWS_PARAMS,
  buildQueries,
  tagCategory,
  matchTickers,
  parseRelevanceDecisions,
  resolveRelevancePrompt,
  DEFAULT_RELEVANCE_PROMPT,
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

test('matchTickers includes only mentioned watchlist entries and recognises company aliases', () => {
  const hits = matchTickers('Apple and Microsoft announce a deal', ['AAPL', 'Microsoft', 'NVDA']);
  assert.ok(hits.includes('AAPL'));
  assert.ok(hits.includes('Microsoft'));
  assert.ok(!hits.includes('NVDA'));
  assert.deepEqual(matchTickers('unrelated text', ['AAPL']), []);
  assert.deepEqual(matchTickers('The S&P 500 rose today', ['S&P 500']), ['S&P 500']);
});

test('parseRelevanceDecisions extracts a url-keyed map from noisy output', () => {
  const raw =
    'Here is the JSON:\n[{"url":"https://x.com/a","relevant":true,"targets":["AAPL"],"reason":"earnings beat"},' +
    '{"url":"https://x.com/b","relevant":false,"targets":[],"reason":"recap"}] done';
  const map = parseRelevanceDecisions(raw);
  assert.equal(map.size, 2);
  assert.equal(map.get('https://x.com/a')?.relevant, true);
  assert.deepEqual(map.get('https://x.com/a')?.targets, ['AAPL']);
  assert.equal(map.get('https://x.com/b')?.relevant, false);
});

test('resolveRelevancePrompt upgrades the former default but preserves custom text', () => {
  const legacy = `You are a financial-news relevance filter working for an investor.

For each article, decide whether it is *materially relevant* — i.e. a real development that a holder of these names would want to know about — versus noise (recaps, listicles, generic market wraps, ads, or stale repeats).

Be strict: when in doubt, mark it not relevant. Never invent URLs; only use URLs present verbatim in the input. Do not give buy/sell advice — only judge relevance and state in one short sentence why it could matter.`;
  assert.equal(resolveRelevancePrompt(legacy), DEFAULT_RELEVANCE_PROMPT);
  assert.equal(resolveRelevancePrompt('Keep only filings.'), 'Keep only filings.');
});
