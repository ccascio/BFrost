import assert from 'node:assert/strict';
import test from 'node:test';

import {
  describeFetchFailure,
  fetchFailureError,
  flagTransientFailure,
  isTransientFetchFailure,
  isTransientHttpStatus,
} from './net-errors';

/** `target` is ES2020, so these shapes are built structurally rather than with the
 *  `{ cause }` constructor option / `AggregateError` the runtime actually provides —
 *  which is exactly the surface `net-errors` reads. */
function withCause(message: string, cause: unknown, name?: string): Error {
  const err = new Error(message);
  if (name) err.name = name;
  (err as Error & { cause?: unknown }).cause = cause;
  return err;
}

function withCode(message: string, code: string, name?: string): Error {
  const err = new Error(message);
  if (name) err.name = name;
  (err as Error & { code?: string }).code = code;
  return err;
}

function aggregate(children: Error[], code?: string): Error {
  const err = new Error('');
  err.name = 'AggregateError';
  (err as Error & { errors?: unknown }).errors = children;
  if (code) (err as Error & { code?: string }).code = code;
  return err;
}

/** The exact shape Node hands back for a connect timeout: an opaque `TypeError` whose
 *  `.cause` carries the real reason. Rebuilt so the test needs no network. */
function connectTimeoutRejection(host: string): Error {
  const cause = withCode(
    `Connect Timeout Error (attempted address: ${host}:443, timeout: 10000ms)`,
    'UND_ERR_CONNECT_TIMEOUT',
    'ConnectTimeoutError',
  );
  return withCause('fetch failed', cause, 'TypeError');
}

test('describeFetchFailure replaces the opaque wrapper with the real cause', () => {
  const described = describeFetchFailure(connectTimeoutRejection('query1.finance.yahoo.com'));
  assert.match(described, /Connect Timeout Error \(attempted address: query1\.finance\.yahoo\.com:443/);
  assert.match(described, /UND_ERR_CONNECT_TIMEOUT/);
  assert.doesNotMatch(described, /fetch failed/);
});

test('describeFetchFailure names a code-only cause that carries no message', () => {
  assert.equal(describeFetchFailure(withCause('fetch failed', withCode('', 'ECONNRESET'))), 'ECONNRESET');
});

test('describeFetchFailure summarises the addresses an AggregateError raced', () => {
  const raced = aggregate(
    [new Error('connect ETIMEDOUT 69.147.80.15:443'), new Error('connect ETIMEDOUT 69.147.80.12:443')],
    'ETIMEDOUT',
  );
  const described = describeFetchFailure(withCause('fetch failed', raced));
  assert.match(described, /69\.147\.80\.15:443/);
  assert.match(described, /69\.147\.80\.12:443/);
});

test('describeFetchFailure collapses repeated identical Happy Eyeballs children', () => {
  const raced = aggregate([new Error('connect ENETUNREACH'), new Error('connect ENETUNREACH')]);
  assert.equal(describeFetchFailure(withCause('fetch failed', raced)), 'connect ENETUNREACH');
});

test('describeFetchFailure keeps intermediate wrappers that say which call failed', () => {
  const described = describeFetchFailure(
    withCause('Stooq request failed for RKLB', connectTimeoutRejection('stooq.com')),
  );
  assert.match(described, /^Stooq request failed for RKLB \(/);
  assert.match(described, /Connect Timeout Error/);
});

test('describeFetchFailure survives a self-referencing cause', () => {
  const looping = new Error('outer');
  (looping as Error & { cause?: unknown }).cause = looping;
  assert.equal(describeFetchFailure(looping), 'outer');
});

test('describeFetchFailure handles a thrown non-Error', () => {
  assert.equal(describeFetchFailure('plain string'), 'plain string');
});

test('fetchFailureError produces the log line the price sources emit, cause intact', () => {
  const wrapped = fetchFailureError(
    'Yahoo chart request failed for RKLB',
    connectTimeoutRejection('query1.finance.yahoo.com'),
  );
  assert.match(wrapped.message, /^Yahoo chart request failed for RKLB: Connect Timeout Error/);
  assert.doesNotMatch(wrapped.message, /fetch failed/);
  assert.equal(isTransientFetchFailure(wrapped), true);
});

test('isTransientFetchFailure finds a transient code nested behind wrappers', () => {
  const wrapped = withCause('Yahoo chart request failed for RKLB', connectTimeoutRejection('query1.finance.yahoo.com'));
  assert.equal(isTransientFetchFailure(wrapped), true);
});

test('isTransientFetchFailure reads AggregateError children', () => {
  assert.equal(isTransientFetchFailure(aggregate([withCode('connect failed', 'ECONNREFUSED')])), true);
});

test('isTransientFetchFailure treats a parse failure as deterministic', () => {
  assert.equal(isTransientFetchFailure(new Error('Yahoo returned no parseable daily bars.')), false);
});

test('isTransientFetchFailure honours an explicit flag with no code to read', () => {
  const rateLimited = new Error('Yahoo chart request failed for RKLB: HTTP 429');
  assert.equal(isTransientFetchFailure(rateLimited), false);
  assert.equal(isTransientFetchFailure(flagTransientFailure(rateLimited)), true);
});

test('isTransientFetchFailure ignores a non-Error', () => {
  assert.equal(isTransientFetchFailure('ECONNRESET'), false);
});

test('isTransientHttpStatus separates "later" from "your request is wrong"', () => {
  for (const status of [408, 425, 429, 500, 502, 503, 504]) {
    assert.equal(isTransientHttpStatus(status), true, `${status} should be transient`);
  }
  for (const status of [200, 301, 400, 401, 403, 404, 422]) {
    assert.equal(isTransientHttpStatus(status), false, `${status} should not be transient`);
  }
});
