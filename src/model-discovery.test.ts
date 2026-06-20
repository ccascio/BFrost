import assert from 'node:assert/strict';
import test from 'node:test';
import { availableModels, clearDiscoveredProviderModels, config } from './config';
import {
  refreshActiveLocalProviderModels,
  refreshCloudProviderModels,
  seedDeclaredProviderModels,
} from './model-discovery';
import {
  resolveAnthropicApiKey,
  resolveAnthropicAuthMode,
  resolveAnthropicOAuthCredentials,
  setAnthropicApiKey,
  setAnthropicAuthMode,
  setAnthropicOAuthCredentials,
} from './workers/builtin/providers-anthropic/credentials';
import {
  resolveOpenAIApiKey,
  resolveOpenAIAuthMode,
  setOpenAIApiKey,
  setOpenAIAuthMode,
} from './workers/builtin/providers-openai/credentials';
import { PI_COMPATIBLE_PROVIDERS } from './workers/builtin/providers-pi-compatible/catalog';
import { resolvePiProviderApiKey, setPiProviderApiKey } from './workers/builtin/providers-pi-compatible/credentials';

test('model discovery only keeps cloud providers that are configured', async () => {
  const provider = PI_COMPATIBLE_PROVIDERS[0];
  assert.ok(provider, 'expected at least one OpenAI-compatible provider fixture');

  const previousProviderKey = resolvePiProviderApiKey(provider);
  const previousOpenAIKey = resolveOpenAIApiKey();
  const previousOpenAIMode = resolveOpenAIAuthMode();
  const previousAnthropicKey = resolveAnthropicApiKey();
  const previousAnthropicMode = resolveAnthropicAuthMode();
  const previousAnthropicOAuth = resolveAnthropicOAuthCredentials();
  const previousBaseUrl = config.ollamaBaseUrl;

  try {
    setOpenAIAuthMode('api');
    setOpenAIApiKey('');
    setAnthropicAuthMode('api');
    setAnthropicApiKey('');
    setAnthropicOAuthCredentials({ access: '', refresh: '', expires: 0 });
    config.ollamaBaseUrl = '';
    setPiProviderApiKey(provider.id, '');

    seedDeclaredProviderModels();
    assert.equal(availableModels.some((model) => model.provider === provider.id), true);

    await refreshCloudProviderModels();
    assert.equal(availableModels.some((model) => model.provider === provider.id), false);

    await refreshActiveLocalProviderModels();
    assert.equal(availableModels.some((model) => model.provider === provider.id), false);

    setPiProviderApiKey(provider.id, 'test-key');
    await refreshCloudProviderModels();
    assert.equal(availableModels.some((model) => model.provider === provider.id), true);
  } finally {
    setPiProviderApiKey(provider.id, previousProviderKey);
    clearDiscoveredProviderModels(provider.id);
    setOpenAIAuthMode(previousOpenAIMode);
    setOpenAIApiKey(previousOpenAIKey);
    setAnthropicAuthMode(previousAnthropicMode);
    setAnthropicApiKey(previousAnthropicKey);
    setAnthropicOAuthCredentials(previousAnthropicOAuth);
    config.ollamaBaseUrl = previousBaseUrl;
  }
});
