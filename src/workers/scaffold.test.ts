import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildScaffoldFiles,
  extractJsonObject,
  normalizeScaffoldSpec,
  specFromModelOutput,
  toWorkerId,
  workerSlug,
  writeWorkerScaffold,
} from './scaffold';
import { discoverLocalWorkerResult } from './local';

test('toWorkerId coerces arbitrary input into a valid local id', () => {
  assert.equal(toWorkerId('My Standup Notes!'), 'local.my-standup-notes');
  assert.equal(toWorkerId('local.already-prefixed'), 'local.already-prefixed');
  assert.equal(toWorkerId('   '), 'local.worker');
  assert.match(toWorkerId('Wëird   Spaces'), /^[a-z0-9][a-z0-9._-]*$/);
});

test('normalizeScaffoldSpec fills defaults and defaults role to producer', () => {
  const spec = normalizeScaffoldSpec({ name: 'Daily Haiku' });
  assert.equal(spec.id, 'local.daily-haiku');
  assert.equal(spec.role, 'producer');
  assert.equal(spec.itemType, 'local.daily-haiku.item');
  assert.ok(spec.prompt.length > 0);
  assert.ok(spec.cron.length > 0);
});

test('normalizeScaffoldSpec honours a consumer role and provided itemType', () => {
  const spec = normalizeScaffoldSpec({
    name: 'News Summarizer',
    role: 'consumer',
    itemType: 'news.article',
  });
  assert.equal(spec.role, 'consumer');
  assert.equal(spec.itemType, 'news.article');
});

test('buildScaffoldFiles emits the four expected files', () => {
  const spec = normalizeScaffoldSpec({ name: 'Test Worker' });
  const files = buildScaffoldFiles(spec);
  const names = files.map((f) => f.relPath).sort();
  assert.deepEqual(names, ['README.md', 'dashboard.tsx', path.join('src', 'index.ts'), 'worker.json'].sort());
});

test('producer backend wires publishItem and the worker id; consumer wires the consumer pattern', () => {
  const producer = buildScaffoldFiles(normalizeScaffoldSpec({ name: 'Pub', role: 'producer' }));
  const producerBackend = producer.find((f) => f.relPath.endsWith('index.ts'))!.contents;
  assert.match(producerBackend, /publishItem/);
  assert.match(producerBackend, /local\.pub/);
  assert.doesNotMatch(producerBackend, /applyConsumerSuccess/);

  const consumer = buildScaffoldFiles(normalizeScaffoldSpec({ name: 'Sub', role: 'consumer', itemType: 'news.article' }));
  const consumerBackend = consumer.find((f) => f.relPath.endsWith('index.ts'))!.contents;
  assert.match(consumerBackend, /listItemsForConsumer/);
  assert.match(consumerBackend, /applyConsumerSuccess/);
});

test('writeWorkerScaffold output passes the real local-worker discovery schema', async () => {
  const spec = normalizeScaffoldSpec({
    name: 'Standup Notes',
    description: 'Writes a short standup note every morning.',
    role: 'producer',
  });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bfrost-scaffold-test-'));
  try {
    const workerDir = path.join(root, workerSlug(spec.id));
    await fs.mkdir(workerDir, { recursive: true });
    const written = await writeWorkerScaffold(workerDir, spec);
    assert.ok(written.includes('worker.json'));

    const result = await discoverLocalWorkerResult([root]);
    assert.equal(result.issues.length, 0, `unexpected issues: ${JSON.stringify(result.issues)}`);
    assert.equal(result.workers.length, 1);
    const discovered = result.workers[0];
    assert.equal(discovered.manifest.id, spec.id);
    assert.equal(discovered.language, 'typescript');
    assert.equal(discovered.backendSource, 'src/index.ts');
    assert.equal(discovered.backendEntrypoint, 'dist/index.js');
    assert.equal(discovered.dashboardSource, 'dashboard.tsx');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('extractJsonObject reads clean, fenced, and prose-wrapped JSON', () => {
  assert.deepEqual(extractJsonObject('{"role":"producer"}'), { role: 'producer' });
  assert.deepEqual(extractJsonObject('```json\n{"role":"consumer"}\n```'), { role: 'consumer' });
  assert.deepEqual(
    extractJsonObject('Sure! Here is the spec:\n{"name":"X"}\nHope that helps.'),
    { name: 'X' },
  );
  assert.throws(() => extractJsonObject('no json here'), /No JSON object/);
});

test('specFromModelOutput parses a clean spec and honours the consumer role', () => {
  const spec = specFromModelOutput(
    '```json\n{"id":"local.summarizer","name":"Summarizer","role":"consumer","itemType":"news.article","cron":"0 8 * * *","prompt":"Summarize it."}\n```',
  );
  assert.equal(spec.id, 'local.summarizer');
  assert.equal(spec.role, 'consumer');
  assert.equal(spec.itemType, 'news.article');
  assert.equal(spec.prompt, 'Summarize it.');
});

test('specFromModelOutput defaults role to producer and rejects non-objects', () => {
  const spec = specFromModelOutput('{"name":"Haiku Bot","prompt":"Write a haiku."}');
  assert.equal(spec.role, 'producer');
  assert.equal(spec.id, 'local.haiku-bot');
  // No braces → rejected at extraction.
  assert.throws(() => specFromModelOutput('[1,2,3]'), /No JSON object/);
  assert.throws(() => specFromModelOutput('"just a string"'), /No JSON object/);
});

test('text fields are sanitized against template-literal / comment injection', () => {
  const spec = normalizeScaffoldSpec({ name: 'Evil`Name', description: 'breaks */ comment ${x}' });
  assert.doesNotMatch(spec.name, /`/);
  assert.doesNotMatch(spec.description, /\*\//);
  assert.doesNotMatch(spec.description, /\$\{/);
  // The generated header comment must close exactly once — a stray */ in the description would
  // close it early and leave the rest of the doc comment as live (broken) code.
  const backend = buildScaffoldFiles(spec).find((f) => f.relPath.endsWith('index.ts'))!.contents;
  const headerComment = backend.slice(0, backend.indexOf('*/') + 2);
  assert.match(headerComment, /^\/\*\*[\s\S]*\*\/$/);
  assert.ok(backend.includes('SYSTEM_PROMPT'));
});

test('writeWorkerScaffold refuses to write into a non-empty directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bfrost-scaffold-test-'));
  try {
    await fs.writeFile(path.join(root, 'existing.txt'), 'x', 'utf8');
    const spec = normalizeScaffoldSpec({ name: 'Clobber' });
    await assert.rejects(() => writeWorkerScaffold(root, spec), /not empty/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
