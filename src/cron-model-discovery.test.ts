import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * `npm run task` boots `cron.ts`, not `index.ts`, and every boot step `index.ts` performs has to
 * be repeated there. The file's own header says so about `./net-tuning`; cloud model discovery
 * was the same omission and went unnoticed for longer, because its symptom was not an error.
 *
 * `cron.ts` refreshed only *local* provider models. The effects, all silent:
 *
 *   - `npm run task -- --help` listed local models only, so the catalog looked complete;
 *   - `--model gpt-5.5` exited with "Unknown model alias", which reads like a bad alias;
 *   - a job configured with a cloud alias fell back to whatever local model was active.
 *
 * The last one is the expensive case. It is how a profiler run intended for a cloud model
 * silently became a 20 GB local model load on a machine with 2.7 GB free — and the failure that
 * surfaced was a memory error, which points at the machine rather than at the missing call.
 *
 * A source-level check rather than a behavioural one: `cron.ts` is a process entrypoint whose
 * `main()` runs jobs and calls `process.exit`, so importing it in a test would run it. Same
 * approach as the other repo-structure tests in core.
 */

const CRON = path.join(process.cwd(), 'src', 'cron.ts');

test('the task CLI refreshes cloud provider models, not only local ones', () => {
  const src = readFileSync(CRON, 'utf8');

  assert.match(src, /refreshCloudProviderModels/,
    'cron.ts must refresh cloud provider models, or every cloud model is invisible to '
    + '`npm run task` and a cloud-aliased job silently falls back to the local runtime');
  assert.match(src, /refreshActiveLocalProviderModels/,
    'cron.ts must still refresh the active local provider');

  // Imported as well as mentioned — a name appearing only inside a comment would satisfy a
  // bare substring check while the call never happens.
  assert.match(src, /import\s*\{[^}]*refreshCloudProviderModels[^}]*\}\s*from\s*'\.\/model-discovery'/,
    'refreshCloudProviderModels must be imported from ./model-discovery');
});

test('both refreshers run before the model alias is resolved', () => {
  const src = readFileSync(CRON, 'utf8');
  const cloudCall = src.indexOf('refreshCloudProviderModels()');
  const findModel = src.indexOf('findModel(modelAlias)');

  assert.ok(cloudCall > 0, 'refreshCloudProviderModels is imported but never called');
  assert.ok(findModel > 0, 'expected cron.ts to resolve the model alias via findModel');
  assert.ok(cloudCall < findModel,
    'cloud models must be registered before the alias is resolved, or a valid cloud alias '
    + 'still fails with "Unknown model alias"');
});
