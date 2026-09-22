import assert from 'node:assert/strict';
import test from 'node:test';
import { config } from './config';
import { safeFetchTarget, withDebugTiming, withDebugTimingAsync } from './debug';

function captureDebugOutput(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const previous = console.debug;
  console.debug = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  return {
    lines,
    restore: () => {
      console.debug = previous;
    },
  };
}

test('debug timings are silent unless LOG_LEVEL is debug', () => {
  const previousLevel = config.logLevel;
  const capture = captureDebugOutput();
  config.logLevel = 'info';
  try {
    withDebugTiming('test.silent', () => 42);
    assert.deepEqual(capture.lines, []);
  } finally {
    config.logLevel = previousLevel;
    capture.restore();
  }
});

test('debug timings include start/end timestamps and duration for success', async () => {
  const previousLevel = config.logLevel;
  const capture = captureDebugOutput();
  config.logLevel = 'debug';
  try {
    await withDebugTimingAsync('test.success', async () => 'ok');
    assert.equal(capture.lines.length, 2);
    assert.match(capture.lines[0], /^\[DEBUG\] \S+ START test\.success$/);
    assert.match(capture.lines[1], /^\[DEBUG\] \S+ END test\.success status=ok durationMs=\d+\.\d{2}$/);
  } finally {
    config.logLevel = previousLevel;
    capture.restore();
  }
});

test('fetch timing targets omit credential-bearing paths and query strings', () => {
  assert.equal(
    safeFetchTarget('https://api.example.test/bot-secret-token/send?api_key=also-secret'),
    'https://api.example.test',
  );
  assert.equal(safeFetchTarget('not a URL'), '<invalid-url>');
});

test('debug timings emit an end record when an operation fails', () => {
  const previousLevel = config.logLevel;
  const capture = captureDebugOutput();
  config.logLevel = 'debug';
  try {
    assert.throws(() => withDebugTiming('test.failure', () => { throw new Error('expected'); }), /expected/);
    assert.equal(capture.lines.length, 2);
    assert.match(capture.lines[0], / START test\.failure$/);
    assert.match(capture.lines[1], / END test\.failure status=error durationMs=\d+\.\d{2} errorType=Error$/);
  } finally {
    config.logLevel = previousLevel;
    capture.restore();
  }
});
