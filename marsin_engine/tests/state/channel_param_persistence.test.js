import { test } from 'node:test';
import assert from 'node:assert/strict';

import { persistChannelParamState } from '../../lib/channel_param_persistence.js';

const BASE = {
  channelId: 'ch_test',
  successType: 'channelParamsSaved',
  failureMessage: 'applied but not saved',
};

test('successful strict persistence emits SAVED only after the write returns', () => {
  const order = [];
  const result = persistChannelParamState({
    ...BASE,
    enabled: true,
    save: () => order.push('write'),
    emit: (message) => order.push(message.type),
    logFailure: () => order.push('failure'),
  });

  assert.deepEqual(order, ['write', 'channelParamsSaved']);
  assert.deepEqual(result, { attempted: true, saved: true, error: null });
});

test('suppressed persistence performs no write and emits no acknowledgement', () => {
  const calls = [];
  const result = persistChannelParamState({
    ...BASE,
    enabled: false,
    save: () => calls.push('write'),
    emit: (message) => calls.push(message.type),
    logFailure: () => calls.push('failure'),
  });

  assert.deepEqual(calls, []);
  assert.deepEqual(result, { attempted: false, saved: false, error: null });
});

test('failed strict persistence emits failure and never emits SAVED', () => {
  const emitted = [];
  const logged = [];
  const result = persistChannelParamState({
    ...BASE,
    enabled: true,
    save: () => { throw new Error('disk full'); },
    emit: (message) => emitted.push(message),
    logFailure: (error) => logged.push(error.message),
  });

  assert.deepEqual(logged, ['disk full']);
  assert.deepEqual(emitted, [{
    type: 'channelParamsSaveFailed',
    channelId: 'ch_test',
    error: 'applied but not saved',
  }]);
  assert.deepEqual(result, {
    attempted: true,
    saved: false,
    error: 'applied but not saved',
  });
});
