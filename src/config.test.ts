import assert from 'node:assert/strict';
import test from 'node:test';
import {
  availableModels,
  clearDiscoveredProviderModels,
  config,
  findModel,
  getDefaultModelAlias,
  replaceDiscoveredProviderModels,
} from './config';

test('model lookup accepts aliases and ids', () => {
  const gpt = findModel('gpt-5.5');
  assert.ok(gpt);
  assert.equal(findModel(gpt.id)?.alias, 'gpt-5.5');
});

test('default model falls back to configured model when known', () => {
  const previous = config.ollamaModel;
  config.ollamaModel = 'gpt-5.4-mini';

  try {
    assert.equal(getDefaultModelAlias(), 'gpt-5.4-mini');
  } finally {
    config.ollamaModel = previous;
  }
});

test('model catalog includes discovered provider models without duplicating built-ins', () => {
  try {
    replaceDiscoveredProviderModels('lmstudio', [
      {
        id: 'gpt-5.5',
        label: 'Duplicate GPT',
      },
      {
        id: 'local/new-model',
        label: 'New Local Model',
      },
    ]);

    assert.equal(findModel('local-new-model')?.id, 'local/new-model');
    assert.equal(findModel('local/new-model')?.label, 'New Local Model');
    assert.equal(availableModels.filter((model) => model.id === 'gpt-5.5').length, 1);
  } finally {
    clearDiscoveredProviderModels('lmstudio');
  }
});
