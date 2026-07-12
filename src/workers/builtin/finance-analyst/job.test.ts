import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAnalysisPayload,
  FinanceAnalysisParamsSchema,
  DEFAULT_FINANCE_ANALYSIS_PARAMS,
  parseAnalysisDecisions,
  resolveAnalysisPrompt,
  DEFAULT_ANALYSIS_PROMPT,
} from './job';
import type { QueueItem } from '../../../jobs/queue';

test('params schema fills defaults and coerces bad input', () => {
  const parsed = FinanceAnalysisParamsSchema.parse({});
  assert.equal(parsed.maxItems, 8);
  assert.equal(parsed.investorLens, 'none');
  assert.equal(parsed.riskTolerance, 'balanced');
  assert.equal(parsed.portfolioContext, '');
  assert.equal(parsed.notifyOnAnalysis, false);

  const coerced = FinanceAnalysisParamsSchema.parse({ ...DEFAULT_FINANCE_ANALYSIS_PARAMS, investorLens: 'bogus' });
  assert.equal(coerced.investorLens, 'none');
});

test('parseAnalysisDecisions extracts a url-keyed map and enforces the read shape', () => {
  const raw =
    'Reads:\n[{"url":"https://x.com/a","recommendations":[{"target":"AAPL","recommendation":"buy","attention":"act_on_research","catalyst":"raised guidance","evidence":"article reports an earnings beat","direction":"up","magnitude":"moderate","horizon":"days",' +
    '"confidence":"medium","pricedIn":"partly","mechanism":"earnings beat lifts guidance","risks":"demand may fade","nextCheck":"guidance update","note":"thin volume"}]},' +
    '{"url":"https://x.com/b","recommendations":[{"target":"NVDA","recommendation":"sell","attention":"watch","catalyst":"regulatory probe","evidence":"article reports an open probe","direction":"down","magnitude":"high","horizon":"weeks",' +
    '"confidence":"low","pricedIn":"unlikely","mechanism":"regulatory probe opens","risks":"probe may close","nextCheck":"regulator filing"}]}]';
  const map = parseAnalysisDecisions(raw);
  assert.equal(map.size, 2);
  assert.equal(map.get('https://x.com/a')?.recommendations[0].recommendation, 'buy');
  assert.equal(map.get('https://x.com/a')?.recommendations[0].attention, 'act_on_research');
  assert.equal(map.get('https://x.com/b')?.recommendations[0].magnitude, 'high');
  assert.equal(map.get('https://x.com/a')?.recommendations[0].note, 'thin volume');
});

test('parseAnalysisDecisions rejects an invalid enum value', () => {
  const raw = '[{"url":"https://x.com/a","recommendations":[{"target":"AAPL","recommendation":"wait","attention":"later","catalyst":"x","evidence":"y","direction":"sideways","magnitude":"moderate","horizon":"days","confidence":"medium","pricedIn":"partly","mechanism":"x","risks":"y","nextCheck":"z"}]}]';
  assert.throws(() => parseAnalysisDecisions(raw));
});

test('resolveAnalysisPrompt upgrades the former default but preserves a custom prompt', () => {
  const legacy = `You are a sober financial analyst writing a short, INFORMATIONAL read on each news item for an investor who already follows the name.

Ground every statement ONLY in the provided article text — never invent numbers or facts. Do NOT give buy/sell/hold advice. Your job is to characterise the likely market reaction and the mechanism, and to be honest about uncertainty (including whether the move is probably already priced in).`;
  assert.equal(resolveAnalysisPrompt(legacy), DEFAULT_ANALYSIS_PROMPT);
  const phaseOne = `You are an investment analyst whose job is to give a clear BUY, HOLD, or SELL recommendation for every target materially discussed in each news item.

Ground every factual claim in the supplied input. Distinguish reported facts from your inference and never invent figures, prices, consensus estimates, or portfolio details. Choose the strongest recommendation supported by the evidence. Use HOLD only when the evidence genuinely does not justify changing exposure; never choose HOLD merely to avoid commitment. Express uncertainty through confidence, risks, and the next fact to verify.`;
  assert.equal(resolveAnalysisPrompt(phaseOne), DEFAULT_ANALYSIS_PROMPT);
  assert.equal(resolveAnalysisPrompt('My custom advisory prompt.'), 'My custom advisory prompt.');
});

test('buildAnalysisPayload passes full article text and all available producer context', () => {
  const articleText = 'A'.repeat(6_000);
  const item: QueueItem = {
    id: 'q_finance',
    title: 'Apple raises guidance',
    shortDesc: 'Guidance increased.',
    url: 'https://example.com/apple',
    addedAt: '2026-07-12T08:00:00.000Z',
    state: 'queued',
    stateChangedAt: '2026-07-12T08:00:00.000Z',
    selectionReason: 'Material guidance change.',
    producerWorkerId: 'core.finance-news',
    itemType: 'finance.news',
    tags: ['earnings', 'AAPL'],
    payload: {
      tickers: ['AAPL'],
      category: 'earnings',
      source: { host: 'example.com', title: 'Apple raises guidance' },
      producedFor: ['AAPL'],
      relevanceReason: 'Material guidance change.',
      fetchedAt: '2026-07-12T07:59:00.000Z',
      contentQuality: 'article',
      articleChars: articleText.length,
      snippet: 'Apple raised guidance.',
      articleText,
    },
  };

  const [payload] = buildAnalysisPayload([item]);
  assert.equal(payload.articleText.length, 6_000);
  assert.deepEqual(payload.targets, ['AAPL']);
  assert.deepEqual(payload.searchTargets, ['AAPL']);
  assert.equal(payload.source.host, 'example.com');
  assert.equal(payload.contentQuality, 'article');
  assert.equal(payload.relevanceReason, 'Material guidance change.');
});
