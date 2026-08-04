import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';
import { DEFAULT_CONNECT_ATTEMPT_TIMEOUT_MS, applyNetworkTuning, resolveConnectAttemptTimeoutMs } from './net-tuning';

test('resolveConnectAttemptTimeoutMs defaults above a slow-link handshake', () => {
  assert.equal(resolveConnectAttemptTimeoutMs({}), DEFAULT_CONNECT_ATTEMPT_TIMEOUT_MS);
  // Node's own default is 500ms. On the degraded link that motivated this module,
  // handshakes ran 0.3-1.0s and that default failed 3/8 requests to the shared store,
  // 4/5 to Yahoo and 5/5 to SEC; 3000ms passed 8/8 and 5/5 respectively. The margin
  // over the ~1s worst case is deliberate — connect latency is not stable, so a bound
  // only just above the last measurement would re-break on the next bad day. Guard the
  // margin, not the sample: anything at or below 2s is too tight to be worth shipping.
  assert.ok(DEFAULT_CONNECT_ATTEMPT_TIMEOUT_MS >= 2_000, 'default must keep real headroom over a ~1s handshake');
});

test('resolveConnectAttemptTimeoutMs honours an operator override, and 0 opts out', () => {
  assert.equal(resolveConnectAttemptTimeoutMs({ NET_CONNECT_ATTEMPT_TIMEOUT_MS: '7500' }), 7_500);
  assert.equal(resolveConnectAttemptTimeoutMs({ NET_CONNECT_ATTEMPT_TIMEOUT_MS: '0' }), null, '0 keeps Node\'s own default');
});

test('resolveConnectAttemptTimeoutMs falls back rather than crashing on a bad value', () => {
  // Boot must never die on a typo in .env.
  for (const bad of ['abc', '-1', '   ', 'NaN']) {
    assert.equal(
      resolveConnectAttemptTimeoutMs({ NET_CONNECT_ATTEMPT_TIMEOUT_MS: bad }),
      DEFAULT_CONNECT_ATTEMPT_TIMEOUT_MS,
      `"${bad}" should fall back to the default`,
    );
  }
});

test('applyNetworkTuning actually moves the runtime default, and is idempotent', (t) => {
  if (typeof net.setDefaultAutoSelectFamilyAttemptTimeout !== 'function') {
    t.skip('runtime has no autoSelectFamily setters');
    return;
  }
  const original = net.getDefaultAutoSelectFamilyAttemptTimeout();
  t.after(() => net.setDefaultAutoSelectFamilyAttemptTimeout(original));

  assert.equal(applyNetworkTuning({ NET_CONNECT_ATTEMPT_TIMEOUT_MS: '4321' }), 4_321);
  assert.equal(net.getDefaultAutoSelectFamilyAttemptTimeout(), 4_321);
  assert.equal(applyNetworkTuning({ NET_CONNECT_ATTEMPT_TIMEOUT_MS: '4321' }), 4_321, 'reapplying is a no-op');
  assert.equal(net.getDefaultAutoSelectFamilyAttemptTimeout(), 4_321);

  assert.equal(applyNetworkTuning({ NET_CONNECT_ATTEMPT_TIMEOUT_MS: '0' }), null);
  assert.equal(net.getDefaultAutoSelectFamilyAttemptTimeout(), 4_321, 'opting out leaves the runtime untouched');
});
