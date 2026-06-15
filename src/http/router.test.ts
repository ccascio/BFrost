import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'http';
import { HttpRouter } from './router';

const noop: () => void = () => {};

function mkUrl(pathname: string): URL {
  return new URL(pathname, 'http://127.0.0.1');
}

test('router matches an exact path + method', () => {
  const r = new HttpRouter();
  r.add('GET', '/api/dashboard', noop);
  const m = r.match('GET', '/api/dashboard');
  assert.ok(m);
  assert.deepEqual(m!.params, {});
});

test('router is method-sensitive', () => {
  const r = new HttpRouter();
  r.add('POST', '/api/auth/login', noop);
  assert.equal(r.match('GET', '/api/auth/login'), null);
  assert.ok(r.match('post', '/api/auth/login')); // case-insensitive method
});

test('router extracts and URL-decodes params', () => {
  const r = new HttpRouter();
  r.add('GET', '/api/workers/:id/dashboard.js', noop);
  const m = r.match('GET', '/api/workers/my%20worker/dashboard.js');
  assert.ok(m);
  assert.equal(m!.params.id, 'my worker');
});

test('router extracts multiple params', () => {
  const r = new HttpRouter();
  r.add('POST', '/api/actions/:id/:decision', noop);
  const m = r.match('POST', '/api/actions/abc/approve');
  assert.deepEqual(m!.params, { id: 'abc', decision: 'approve' });
});

test('router prefers the most specific (most literal) route', () => {
  const r = new HttpRouter();
  let hit = '';
  r.add('POST', '/api/workers/:id', () => {
    hit = 'param';
  });
  r.add('POST', '/api/workers/rescan', () => {
    hit = 'literal';
  });
  const m = r.match('POST', '/api/workers/rescan');
  m!.handler({} as IncomingMessage, {} as ServerResponse, { url: mkUrl('/'), params: m!.params });
  assert.equal(hit, 'literal');
  // a different id still falls to the param route
  assert.equal(r.match('POST', '/api/workers/abc')!.params.id, 'abc');
});

test('router does not match on differing segment counts', () => {
  const r = new HttpRouter();
  r.add('GET', '/api/workers/:id', noop);
  assert.equal(r.match('GET', '/api/workers'), null);
  assert.equal(r.match('GET', '/api/workers/a/b'), null);
});

test('router handles the root path and trailing slashes uniformly', () => {
  const r = new HttpRouter();
  r.add('GET', '/api/dashboard', noop);
  assert.ok(r.match('GET', '/api/dashboard/')); // trailing slash tolerated
});

test('dispatch runs the handler and reports a match; misses return false', async () => {
  const r = new HttpRouter();
  let ran = false;
  r.add('GET', '/api/ping', (_req, _res, ctx) => {
    ran = true;
    assert.equal(ctx.params.x, undefined);
  });
  const matched = await r.dispatch(
    { method: 'GET' } as IncomingMessage,
    {} as ServerResponse,
    mkUrl('/api/ping'),
  );
  assert.equal(matched, true);
  assert.equal(ran, true);

  const missed = await r.dispatch(
    { method: 'GET' } as IncomingMessage,
    {} as ServerResponse,
    mkUrl('/api/nope'),
  );
  assert.equal(missed, false);
});

test('dispatch propagates handler errors to the caller', async () => {
  const r = new HttpRouter();
  r.add('GET', '/api/boom', () => {
    throw new Error('kaboom');
  });
  await assert.rejects(
    () => r.dispatch({ method: 'GET' } as IncomingMessage, {} as ServerResponse, mkUrl('/api/boom')),
    /kaboom/,
  );
});
