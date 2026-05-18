import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getActiveLocalProvider,
  getProviderAdapter,
  getRegisteredProvider,
  listRegisteredProviders,
} from './registry';

test('built-in provider registry exposes the LM Studio adapter', () => {
  const providers = listRegisteredProviders();
  const lmstudio = providers.find((entry) => entry.manifest.id === 'lmstudio');

  assert.ok(lmstudio, 'lmstudio provider should be registered');
  assert.equal(lmstudio!.worker.id, 'core.providers.lmstudio');
  assert.equal(lmstudio!.manifest.capabilities.chat, true);
  assert.equal(lmstudio!.manifest.capabilities.localRuntime, true);
});

test('getProviderAdapter caches a single instance per provider id', () => {
  const first = getProviderAdapter('lmstudio');
  const second = getProviderAdapter('lmstudio');
  assert.ok(first, 'lmstudio adapter should resolve');
  assert.equal(first, second, 'adapter instances should be cached');
  assert.equal(first!.providerId, 'lmstudio');
  assert.equal(typeof first!.getChatModel, 'function');
  assert.equal(typeof first!.startRuntime, 'function');
  assert.equal(typeof first!.stopRuntime, 'function');
  assert.equal(typeof first!.listLoadedModels, 'function');
});

test('getActiveLocalProvider resolves the LM Studio adapter when configured', () => {
  const registered = getRegisteredProvider('lmstudio');
  assert.ok(registered);
  // Active resolution depends on isConfigured() — at minimum it should not throw,
  // and if configured it must be the local-runtime adapter we registered.
  const active = getActiveLocalProvider();
  if (active) {
    assert.equal(active.providerId, 'lmstudio');
  }
});

test('getRegisteredProvider returns undefined for unknown providers', () => {
  assert.equal(getRegisteredProvider('definitely-missing'), undefined);
  assert.equal(getProviderAdapter('definitely-missing'), undefined);
});
