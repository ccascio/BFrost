import assert from 'node:assert/strict';
import test from 'node:test';
import cron from 'node-cron';
import { getPreviousCronMatch } from './cron-internals';

test('getPreviousCronMatch reads the current node-cron timeMatcher shape', () => {
  const task = cron.createTask('0 * * * *', () => {}, { timezone: 'UTC', name: 'cron-internals-test' });
  try {
    const previous = getPreviousCronMatch(task, new Date('2026-01-01T10:30:00.000Z'));
    assert.equal(previous?.toISOString(), '2026-01-01T10:00:00.000Z');
  } finally {
    task.destroy();
  }
});

test('getPreviousCronMatch degrades to null when internals are unavailable', () => {
  assert.equal(getPreviousCronMatch(undefined, new Date('2026-01-01T10:30:00.000Z')), null);
});
