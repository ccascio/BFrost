import assert from 'node:assert/strict';
import test from 'node:test';
import { getLoadArgsForModel, getUnloadIdentifiersForModel } from './runtime';

test('LM Studio load uses non-interactive CLI args and stable identifier', () => {
  assert.deepEqual(getLoadArgsForModel('qwen3.6-35b-a3b'), [
    'load',
    'qwen3.6-35b-a3b',
    '--identifier',
    'qwen3.6-35b-a3b',
    '--yes',
    '--context-length',
    '16384',
  ]);
});

test('LM Studio unload accepts an already loaded identifier', () => {
  const identifiers = getUnloadIdentifiersForModel('local-model:2', [
    {
      modelKey: 'local-model',
      identifier: 'local-model:2',
    },
  ]);

  assert.deepEqual(identifiers, ['local-model:2']);
});
