import assert from 'node:assert/strict';
import test from 'node:test';
import { guardRequest, hostnameOf, isAllowedHost, isCrossSiteWrite, parseAllowedHosts } from './request-guard';

test('hostnameOf strips ports and IPv6 brackets', () => {
  assert.equal(hostnameOf('127.0.0.1:3040'), '127.0.0.1');
  assert.equal(hostnameOf('LocalHost:5183'), 'localhost');
  assert.equal(hostnameOf('[::1]:3040'), '::1');
  assert.equal(hostnameOf('::1'), '::1');
  assert.equal(hostnameOf('example.com'), 'example.com');
  assert.equal(hostnameOf('[]'), null);
  assert.equal(hostnameOf(''), null);
});

test('isAllowedHost accepts IP literals, localhost and configured names only', () => {
  assert.equal(isAllowedHost('127.0.0.1:3040', []), true);
  assert.equal(isAllowedHost('localhost:3040', []), true);
  assert.equal(isAllowedHost('[::1]:3040', []), true);
  assert.equal(isAllowedHost('192.168.1.20:3040', []), true);
  // A DNS-rebinding page arrives under its own domain name.
  assert.equal(isAllowedHost('attacker.example:3040', []), false);
  assert.equal(isAllowedHost('localhost.attacker.example', []), false);
  assert.equal(isAllowedHost(undefined, []), false);
  const allowed = parseAllowedHosts(' Dashboard.Internal , ops.example ');
  assert.deepEqual(allowed, ['dashboard.internal', 'ops.example']);
  assert.equal(isAllowedHost('dashboard.internal:443', allowed), true);
});

test('isCrossSiteWrite blocks browser writes from another origin', () => {
  const host = '127.0.0.1:3040';
  assert.equal(isCrossSiteWrite({ method: 'GET', headers: { host, 'sec-fetch-site': 'cross-site' } }), false);
  assert.equal(isCrossSiteWrite({ method: 'POST', headers: { host, 'sec-fetch-site': 'same-origin' } }), false);
  assert.equal(isCrossSiteWrite({ method: 'POST', headers: { host, 'sec-fetch-site': 'cross-site' } }), true);
  assert.equal(isCrossSiteWrite({ method: 'DELETE', headers: { host, 'sec-fetch-site': 'same-site' } }), true);
  assert.equal(isCrossSiteWrite({ method: 'POST', headers: { host, origin: `http://${host}` } }), false);
  assert.equal(isCrossSiteWrite({ method: 'POST', headers: { host, origin: 'https://evil.example' } }), true);
  assert.equal(isCrossSiteWrite({ method: 'POST', headers: { host, origin: 'null' } }), true);
  // Non-browser clients send neither header.
  assert.equal(isCrossSiteWrite({ method: 'POST', headers: { host } }), false);
});

test('guardRequest checks the host everywhere and origin only for API writes', () => {
  assert.deepEqual(guardRequest({ method: 'GET', headers: { host: '127.0.0.1:3040' } }, '/', []), { ok: true });
  assert.equal(guardRequest({ method: 'GET', headers: { host: 'rebound.example' } }, '/', []).ok, false);
  assert.equal(
    guardRequest({ method: 'POST', headers: { host: '127.0.0.1:3040', 'sec-fetch-site': 'cross-site' } }, '/api/backups', []).ok,
    false,
  );
  assert.equal(
    guardRequest({ method: 'POST', headers: { host: '127.0.0.1:3040', 'sec-fetch-site': 'cross-site' } }, '/login', []).ok,
    true,
  );
});
