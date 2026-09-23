import assert from 'node:assert/strict';
import test from 'node:test';
import { config } from './config';
import { bfrostSdk, verifyAdminPassword } from './sdk';

test('verifyAdminPassword matches the dashboard password and stays locked without one', () => {
  const previous = config.adminPassword;
  try {
    config.adminPassword = '';
    assert.equal(verifyAdminPassword(''), false);
    config.adminPassword = 'correct horse';
    assert.equal(verifyAdminPassword('correct horse'), true);
    assert.equal(verifyAdminPassword('correct hors'), false);
    assert.equal(bfrostSdk.verifyAdminPassword('correct horse'), true);
  } finally {
    config.adminPassword = previous;
  }
});
