import assert from 'node:assert/strict';
import test from 'node:test';

import { AudioPersistenceError } from '../../audio/config/audio_config_store.js';
import { audioConfigErrorStatus } from '../../lib/api_server.js';

test('audio config API classifies validation errors as 400', () => {
  assert.equal(audioConfigErrorStatus(new TypeError('bad field')), 400);
  assert.equal(audioConfigErrorStatus(new RangeError('bad range')), 400);
});

test('audio config API classifies durable-state failures as 500', () => {
  const error = new AudioPersistenceError('disk full');
  assert.equal(error.code, 'AUDIO_PERSISTENCE_ERROR');
  assert.equal(audioConfigErrorStatus(error), 500);
});

test('audio config API defaults unknown and absent internal failures to 500', () => {
  assert.equal(audioConfigErrorStatus(new Error('unexpected')), 500);
  assert.equal(audioConfigErrorStatus(null), 500);
  assert.equal(audioConfigErrorStatus(undefined), 500);
  assert.equal(audioConfigErrorStatus({ message: 'foreign failure' }), 500);
});
