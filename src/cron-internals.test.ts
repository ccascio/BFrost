import assert from 'node:assert/strict';
import test from 'node:test';
import cron from 'node-cron';
import { getNextCronMatch, getPreviousCronMatch, installReliableCronMatcher } from './cron-internals';

test('getNextCronMatch resolves the next weekly slot instead of jumping years', () => {
  const next = getNextCronMatch('0 8 * * 1', 'Europe/Berlin', new Date('2026-07-15T07:00:00.000Z'));
  assert.equal(next.toISOString(), '2026-07-20T06:00:00.000Z');
});

test('getNextCronMatch rolls a weekday schedule from Friday evening to Monday', () => {
  const next = getNextCronMatch('0 8 * * 1-5', 'Europe/Berlin', new Date('2026-07-17T18:00:00.000Z'));
  assert.equal(next.toISOString(), '2026-07-20T06:00:00.000Z');
});

test('getNextCronMatch applies the timezone offset after a DST transition', () => {
  const next = getNextCronMatch('0 8 * * 1', 'Europe/Berlin', new Date('2026-10-24T12:00:00.000Z'));
  assert.equal(next.toISOString(), '2026-10-26T07:00:00.000Z');
});

test('installReliableCronMatcher corrects the matcher retained by a node-cron task', () => {
  const task = cron.createTask('0 8 * * 1', () => {}, { timezone: 'Europe/Berlin' });
  try {
    installReliableCronMatcher(task, '0 8 * * 1', 'Europe/Berlin');
    const previous = getPreviousCronMatch(task, new Date('2026-07-22T07:00:00.000Z'), {
      lookbackMs: 8 * 24 * 60 * 60 * 1000,
    });
    assert.equal(previous?.toISOString(), '2026-07-20T06:00:00.000Z');
  } finally {
    task.destroy();
  }
});

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
