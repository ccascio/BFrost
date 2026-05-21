import assert from 'node:assert/strict';
import test from 'node:test';
import { controlWorker } from './manifest';

test('control worker manifest has correct id and required fields', () => {
  assert.equal(controlWorker.id, 'core.control');
  assert.equal(controlWorker.manifestVersion, 1);
  assert.equal(controlWorker.bfrostApiVersion, '0.1');
  assert.ok(controlWorker.displayName, 'displayName must be set');
  assert.ok(controlWorker.tagline, 'tagline must be set');
  assert.ok(Array.isArray(controlWorker.tools), 'tools must be an array');
  assert.ok(controlWorker.tools.length > 0, 'at least one tool must be declared');
});

test('all control tools have required shape', () => {
  for (const tool of controlWorker.tools ?? []) {
    assert.equal(tool.workerId, 'core.control', `tool ${tool.id} must carry workerId`);
    assert.ok(tool.id, `tool must have an id`);
    assert.ok(tool.name, `tool ${tool.id} must have a name`);
    assert.ok(tool.description, `tool ${tool.id} must have a description`);
    assert.ok(tool.inputSchema, `tool ${tool.id} must have an inputSchema`);
    assert.equal(typeof tool.execute, 'function', `tool ${tool.id} must have an execute function`);
    assert.ok(Array.isArray(tool.permissions) && tool.permissions.length > 0, `tool ${tool.id} must declare permissions`);
  }
});

test('control worker declares expected tool ids', () => {
  const ids = (controlWorker.tools ?? []).map((t) => t.id);
  for (const expected of [
    'list-jobs',
    'enable-job',
    'disable-job',
    'set-job-schedule',
    'trigger-job',
    'list-workers',
    'enable-worker',
    'disable-worker',
  ]) {
    assert.ok(ids.includes(expected), `missing tool: ${expected}`);
  }
});

test('set-job-schedule tool requires cron and jobName', () => {
  const tool = (controlWorker.tools ?? []).find((t) => t.id === 'set-job-schedule');
  assert.ok(tool, 'set-job-schedule tool must exist');
  const required = (tool.inputSchema as { required?: string[] }).required ?? [];
  assert.ok(required.includes('jobName'), 'jobName must be required');
  assert.ok(required.includes('cron'), 'cron must be required');
});

test('control worker has no jobs declared (tools-only worker)', () => {
  assert.deepEqual(controlWorker.jobs, [], 'control worker should not declare any jobs');
});
