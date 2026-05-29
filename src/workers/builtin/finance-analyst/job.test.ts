import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FinanceAnalysisParamsSchema,
  DEFAULT_FINANCE_ANALYSIS_PARAMS,
  parseAnalysisDecisions,
} from './job';

test('params schema fills defaults and coerces bad input', () => {
  const parsed = FinanceAnalysisParamsSchema.parse({});
  assert.equal(parsed.maxItems, 8);
  assert.equal(parsed.investorLens, 'none');
  assert.equal(parsed.notifyOnAnalysis, false);

  const coerced = FinanceAnalysisParamsSchema.parse({ ...DEFAULT_FINANCE_ANALYSIS_PARAMS, investorLens: 'bogus' });
  assert.equal(coerced.investorLens, 'none');
});

test('parseAnalysisDecisions extracts a url-keyed map and enforces the read shape', () => {
  const raw =
    'Reads:\n[{"url":"https://x.com/a","direction":"up","magnitude":"moderate","horizon":"days",' +
    '"confidence":"medium","pricedIn":"partly","mechanism":"earnings beat lifts guidance","note":"thin volume"},' +
    '{"url":"https://x.com/b","direction":"down","magnitude":"high","horizon":"weeks",' +
    '"confidence":"low","pricedIn":"unlikely","mechanism":"regulatory probe opens"}]';
  const map = parseAnalysisDecisions(raw);
  assert.equal(map.size, 2);
  assert.equal(map.get('https://x.com/a')?.direction, 'up');
  assert.equal(map.get('https://x.com/b')?.magnitude, 'high');
  assert.equal(map.get('https://x.com/a')?.note, 'thin volume');
});

test('parseAnalysisDecisions rejects an invalid enum value', () => {
  const raw = '[{"url":"https://x.com/a","direction":"sideways","magnitude":"moderate","horizon":"days","confidence":"medium","pricedIn":"partly","mechanism":"x"}]';
  assert.throws(() => parseAnalysisDecisions(raw));
});
