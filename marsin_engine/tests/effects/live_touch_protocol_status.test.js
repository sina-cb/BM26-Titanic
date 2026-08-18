import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LIVE_TOUCH_PROTOCOL_VERSION,
  liveTouchProtocolStatus,
} from '../../lib/api_server.js';
import { GLOBAL_EFFECT_LIBRARY } from '../../lib/global_effect_library.js';
import { buildLiveTouchPerformanceSlots } from '../../lib/live_touch_session_context.js';

test('GET /status Live Touch protocol contract is exactly version 2', () => {
  assert.equal(LIVE_TOUCH_PROTOCOL_VERSION, 2);
  assert.deepEqual(liveTouchProtocolStatus(), { liveTouchProtocolVersion: 2 });
});

test('protocol v2 refuses a Performance seed whose executable catalog is incomplete', () => {
  const invalidCatalog = {
    ...GLOBAL_EFFECT_LIBRARY,
    freeze: {
      ...GLOBAL_EFFECT_LIBRARY.freeze,
      presets: { ...GLOBAL_EFFECT_LIBRARY.freeze.presets },
    },
  };
  delete invalidCatalog.freeze.presets.hold;

  assert.equal(LIVE_TOUCH_PROTOCOL_VERSION, 2);
  assert.throws(
    () => buildLiveTouchPerformanceSlots(invalidCatalog),
    /requires catalog binding 'freeze\|hold'/,
    'v2 must fail loud instead of exposing a partial canonical Performance grid',
  );
});
