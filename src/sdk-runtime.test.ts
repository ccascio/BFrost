import assert from 'node:assert/strict';
import test from 'node:test';
import { registerBfrostRuntimeModule } from './sdk-runtime';
import { bfrostSdk } from './sdk';

test("registerBfrostRuntimeModule lets require('bfrost') resolve to the host SDK", () => {
  registerBfrostRuntimeModule();

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const resolved = require('bfrost');
  // Identity check — the worker must reach the host's singleton, not a copy. Hooks
  // depend on object identity for things like the worker KV's namespace prefix table.
  assert.equal(resolved, bfrostSdk);
  assert.equal(typeof resolved.openWorkerKv, 'function');
  assert.equal(typeof resolved.openWorkerDb, 'function');
  assert.equal(typeof resolved.publishItem, 'function');
});

test('registerBfrostRuntimeModule is idempotent', () => {
  registerBfrostRuntimeModule();
  registerBfrostRuntimeModule();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const a = require('bfrost');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const b = require('bfrost');
  assert.equal(a, b);
});
