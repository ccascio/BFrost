import assert from 'node:assert/strict';
import test from 'node:test';
import { getRegisteredTool, listRegisteredTools } from './registry';

test('built-in workers expose the assistant tool catalog', () => {
  const tools = listRegisteredTools();
  const names = tools.map((entry) => entry.manifest.name).sort();

  assert.deepEqual(names, [
    'disableJob',
    'disableWorker',
    'enableJob',
    'enableWorker',
    'fetchArticle',
    'listJobs',
    'listWorkers',
    'queryItems',
    'recallMemory',
    'recentRuns',
    'saveMemory',
    'searchDocuments',
    'setJobSchedule',
    'shellExec',
    'triggerJob',
    'webSearch',
  ]);
});

test('tool ownership and metadata are consistent with the manifest', () => {
  for (const entry of listRegisteredTools()) {
    assert.equal(entry.manifest.workerId, entry.worker.id);
    assert.equal(typeof entry.manifest.execute, 'function');
    assert.equal(typeof entry.manifest.description, 'string');
    assert.ok(entry.manifest.inputSchema, `${entry.manifest.name} should declare an input schema`);
  }
});

test('getRegisteredTool resolves by tool name', () => {
  const web = getRegisteredTool('webSearch');
  assert.ok(web, 'webSearch tool should be registered');
  assert.equal(web!.worker.id, 'core.search.google');

  const missing = getRegisteredTool('definitelyMissing');
  assert.equal(missing, undefined);
});
