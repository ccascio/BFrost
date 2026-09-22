import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { config } from './config';
import { closeDb } from './sqlite';
import {
  costByJob,
  costBySubject,
  currentUsageAttribution,
  estimateCostUsd,
  meterLanguageModel,
  MODEL_PRICES,
  normalizeUsage,
  PRICE_TABLE_VERSION,
  readsByArtifact,
  recordArtifactRead,
  recordModelUsage,
  runWithUsageAttribution,
  runWithUsageSubject,
} from './usage-metering';

/**
 * `01.1` acceptance: *"A week of cron runs produces per-job and per-artifact cost distributions.
 * The operator can answer what one profiler run costs and which public artifacts are being
 * read."* Both questions are asserted below against a real database.
 *
 * This is core, so nothing here names a worker: every `jobName`/`workerId` in the fixtures is an
 * invented string, and the module under test would behave identically with any other.
 */

async function withSandbox<T>(fn: () => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bfrost-metering-'));
  const previousDbPath = config.appDbPath;
  const previousBusDir = config.itemBusStoreDir;
  config.appDbPath = path.join(dir, 'BFrost.sqlite');
  config.itemBusStoreDir = path.join(dir, 'item-bus');
  try {
    return await fn();
  } finally {
    closeDb();
    config.appDbPath = previousDbPath;
    config.itemBusStoreDir = previousBusDir;
    await rm(dir, { recursive: true, force: true });
  }
}

const V3_USAGE = {
  inputTokens: { total: 10_000, noCache: 6_000, cacheRead: 4_000, cacheWrite: 0 },
  outputTokens: { total: 2_000, text: 1_500, reasoning: 500 },
};

test('the v3 nested usage shape is flattened, including the cache split', () => {
  assert.deepEqual(normalizeUsage(V3_USAGE), {
    inputTokens: 10_000,
    outputTokens: 2_000,
    cachedInputTokens: 4_000,
    reasoningTokens: 500,
  });
});

test('the older flat usage shape still works', () => {
  // A locally-installed provider worker may ship either spec, and core must not require them all
  // to move together.
  assert.deepEqual(normalizeUsage({ inputTokens: 100, outputTokens: 20, cachedInputTokens: 30 }), {
    inputTokens: 100, outputTokens: 20, cachedInputTokens: 30, reasoningTokens: null,
  });
});

test('an unrecognised usage shape yields nulls, never zeros', () => {
  // Zero is a measurement; null is an admission. Conflating them makes a call that reported
  // nothing look like a call that cost nothing.
  for (const value of [undefined, null, 'nope', 42, {}]) {
    assert.deepEqual(normalizeUsage(value), {
      inputTokens: null, outputTokens: null, cachedInputTokens: null, reasoningTokens: null,
    });
  }
});

test('cached input is billed at its own rate and not double-counted', () => {
  // Providers report `cacheRead` as a *subset* of the input total. Adding both would charge twice
  // for exactly the tokens caching was meant to make cheaper.
  const price = MODEL_PRICES['gpt-5.5'];
  const cost = estimateCostUsd('gpt-5.5', normalizeUsage(V3_USAGE));

  const expected = (6_000 * price.inputPerMillion
    + 4_000 * price.cachedInputPerMillion!
    + 2_000 * price.outputPerMillion) / 1_000_000;
  assert.equal(cost, expected);

  // Sanity: charging the full input at the uncached rate would cost strictly more.
  const naive = (10_000 * price.inputPerMillion + 2_000 * price.outputPerMillion) / 1_000_000;
  assert.ok(cost! < naive);
});

test('an unpriced model costs null, not zero', () => {
  assert.equal(estimateCostUsd('some-local-model', normalizeUsage(V3_USAGE)), null);
});

test('all-zero usage is unreported, not free', () => {
  // The flat-rate subscription path returns a hard-coded zero usage object, because a
  // subscription is not billed per token. A completed call cannot have consumed zero input, so
  // pricing that at $0.000000 would state a measured zero for a cost that is simply unknown.
  const reportedNothing = normalizeUsage({
    inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 0, text: 0, reasoning: 0 },
  });
  assert.equal(estimateCostUsd('gpt-5.4-mini', reportedNothing), null);

  // …while a genuinely tiny call is still priced.
  assert.ok(estimateCostUsd('gpt-5.4-mini', { inputTokens: 1, outputTokens: 0, cachedInputTokens: null, reasoningTokens: null })! > 0);
});

test('a cache read larger than the input total cannot produce a negative cost', () => {
  // Defensive: a provider reporting an inconsistent split must not make a call look like a refund.
  const cost = estimateCostUsd('gpt-5.5', {
    inputTokens: 100, outputTokens: 0, cachedInputTokens: 5_000, reasoningTokens: null,
  });
  assert.ok(cost !== null && cost >= 0);
});

test('attribution is ambient and can be narrowed to a subject', async () => {
  assert.equal(currentUsageAttribution(), null);

  await runWithUsageAttribution({ jobName: 'some-job', runId: 'run-1', workerId: 'some.worker' }, async () => {
    assert.equal(currentUsageAttribution()?.jobName, 'some-job');
    assert.equal(currentUsageAttribution()?.subject, undefined);

    await runWithUsageSubject('SUBJ', async () => {
      assert.equal(currentUsageAttribution()?.subject, 'SUBJ');
      // Narrowing keeps the rest of the attribution intact.
      assert.equal(currentUsageAttribution()?.runId, 'run-1');
    });

    assert.equal(currentUsageAttribution()?.subject, undefined, 'the narrowing does not leak out');
  });

  assert.equal(currentUsageAttribution(), null);
});

test('narrowing to a subject outside a run is a no-op rather than an error', async () => {
  // Worker code should be able to call it unconditionally.
  let ran = false;
  await runWithUsageSubject('SUBJ', async () => { ran = true; });
  assert.equal(ran, true);
});

test('the model proxy meters a successful call and forwards everything else', async () => {
  await withSandbox(async () => {
    const calls: unknown[] = [];
    const model = {
      specificationVersion: 'v3',
      modelId: 'gpt-5.5',
      supportedUrls: { 'image/*': [] },
      async doGenerate(options: unknown) {
        calls.push(options);
        return { content: [], usage: V3_USAGE };
      },
    };
    const metered = meterLanguageModel(model, 'openai', 'gpt-5.5');

    // Properties core knows nothing about pass through untouched — the reason this is a Proxy
    // rather than a rewritten object.
    assert.equal(metered.specificationVersion, 'v3');
    assert.deepEqual(metered.supportedUrls, { 'image/*': [] });

    await runWithUsageAttribution({ jobName: 'job-a', runId: 'run-1', workerId: 'w.a' }, async () => {
      await runWithUsageSubject('AAA', () => metered.doGenerate({ prompt: 'hi' }));
    });

    assert.deepEqual(calls, [{ prompt: 'hi' }], 'the underlying call receives its arguments');

    const [row] = costByJob('2000-01-01T00:00:00.000Z');
    assert.equal(row.jobName, 'job-a');
    assert.equal(row.calls, 1);
    assert.equal(row.runs, 1);
    assert.equal(row.inputTokens, 10_000);
    assert.equal(row.cachedInputTokens, 4_000);
    assert.equal(row.unpricedCalls, 0);
    assert.ok(row.costUsd! > 0);

    assert.deepEqual(costBySubject('2000-01-01T00:00:00.000Z').map((s) => s.subject), ['AAA']);
  });
});

test('a failed call is still metered, and the error still propagates', async () => {
  await withSandbox(async () => {
    const model = {
      async doGenerate() { throw new Error('provider exploded'); },
    };
    const metered = meterLanguageModel(model, 'openai', 'gpt-5.5');

    await runWithUsageAttribution({ jobName: 'job-b', runId: 'run-2', workerId: 'w.b' }, async () => {
      await assert.rejects(() => metered.doGenerate(), /provider exploded/);
    });

    // A cost report that omitted failures would understate exactly the runs worth investigating.
    const [row] = costByJob('2000-01-01T00:00:00.000Z');
    assert.equal(row.jobName, 'job-b');
    assert.equal(row.calls, 1);
    assert.equal(row.inputTokens, 0, 'no tokens were reported');
  });
});

test('metering never breaks the call it is measuring', async () => {
  // Points the database at a path that cannot be opened, so the insert genuinely fails rather
  // than merely being assumed to. The call must still return its value.
  //
  // Inside a sandbox on purpose: an earlier version of this test ran without one and wrote a row
  // into the operator's live database. A test that reaches production state is a defect even when
  // its assertions pass.
  await withSandbox(async () => {
    const previous = config.appDbPath;
    config.appDbPath = path.join(os.tmpdir(), 'bfrost-metering-nonexistent', 'nested', 'db.sqlite');
    closeDb();
    try {
      const metered = meterLanguageModel({ async doGenerate() { return { usage: V3_USAGE, ok: true }; } }, 'p', 'm');
      assert.deepEqual(await metered.doGenerate(), { usage: V3_USAGE, ok: true });
    } finally {
      closeDb();
      config.appDbPath = previous;
    }
  });
});

test('a string model handle passes through unwrapped', () => {
  assert.equal(meterLanguageModel('gpt-5.5', 'openai', 'gpt-5.5'), 'gpt-5.5');
});

test('per-job and per-subject distributions separate their rows', async () => {
  await withSandbox(async () => {
    const record = (jobName: string, runId: string, subject: string | null, modelId: string) =>
      runWithUsageAttribution({ jobName, runId, workerId: 'w', subject }, async () => {
        recordModelUsage({ provider: 'openai', modelId, usage: V3_USAGE, wallMs: 1_000, outcome: 'ok' });
      });

    await record('job-a', 'run-1', 'AAA', 'gpt-5.5');
    await record('job-a', 'run-2', 'BBB', 'gpt-5.5');
    await record('job-b', 'run-3', 'AAA', 'local-model');

    const jobs = costByJob('2000-01-01T00:00:00.000Z');
    const jobA = jobs.find((j) => j.jobName === 'job-a')!;
    assert.equal(jobA.runs, 2, 'two distinct runs of the same job');
    assert.equal(jobA.calls, 2);

    const jobB = jobs.find((j) => j.jobName === 'job-b')!;
    assert.equal(jobB.unpricedCalls, 1, 'an unpriced model is reported as such, not as free');
    assert.equal(jobB.costUsd, null);

    const subjects = costBySubject('2000-01-01T00:00:00.000Z');
    assert.equal(subjects.find((s) => s.subject === 'AAA')!.calls, 2);
    assert.equal(subjects.find((s) => s.subject === 'BBB')!.calls, 1);
  });
});

test('reads are counted per surface without duplicating the artifact', async () => {
  await withSandbox(async () => {
    recordArtifactRead({ artifactId: 'AAA', surface: 'public', freshness: 'confirmed' });
    recordArtifactRead({ artifactId: 'AAA', surface: 'public', freshness: 'confirmed' });
    recordArtifactRead({ artifactId: 'AAA', surface: 'api', freshness: 'confirmed' });
    recordArtifactRead({ artifactId: 'BBB', surface: 'subscriber', freshness: 'potentially_stale' });

    const reads = readsByArtifact('2000-01-01');
    const aaaPublic = reads.find((r) => r.artifactId === 'AAA' && r.surface === 'public')!;
    assert.equal(aaaPublic.reads, 2);
    // The whole point: public, subscriber and API reads stay distinguishable.
    assert.equal(reads.find((r) => r.artifactId === 'AAA' && r.surface === 'api')!.reads, 1);
    assert.equal(reads.find((r) => r.artifactId === 'BBB' && r.surface === 'subscriber')!.reads, 1);
  });
});

test('every stored cost names the price table that produced it', async () => {
  await withSandbox(async () => {
    await runWithUsageAttribution({ jobName: 'j', runId: 'r', workerId: 'w' }, async () => {
      recordModelUsage({ provider: 'openai', modelId: 'gpt-5.5', usage: V3_USAGE, wallMs: 10, outcome: 'ok' });
    });
    const { getAppDbSync } = await import('./sqlite');
    const rows = getAppDbSync().prepare('SELECT price_table_version FROM run_costs').all() as Array<{ price_table_version: string }>;
    // A cost that cannot name its prices cannot be recomputed or defended after they change.
    assert.deepEqual(rows, [{ price_table_version: PRICE_TABLE_VERSION }]);
  });
});
