import assert from 'node:assert/strict';
import test from 'node:test';

import {
  activeColorParamCenter,
  seedColorAutopilotFromActiveSurface,
} from '../../lib/api_server.js';

function paletteCenter(h1, h2) {
  const values = {
    colorPalette1: { h: h1, s: 1, v: 1 },
    colorPalette2: { h: h2, s: 1, v: 1 },
  };
  return { get: key => values[key] };
}

test('active ColorAutopilot seed reads the private Live rendering surface', () => {
  const shared = paletteCenter(0.1, 0.6);
  const live = paletteCenter(0.3, 0.8);
  const liveTouchSession = {
    paramCenter: live,
    getState: () => ({ active: true }),
  };
  let seeded = null;
  const colorAutopilot = { seedCurrentParams: params => { seeded = params; } };

  assert.equal(activeColorParamCenter(shared, liveTouchSession), live);
  const result = seedColorAutopilotFromActiveSurface(
    colorAutopilot,
    shared,
    liveTouchSession,
  );
  assert.deepEqual(result, {
    colorPalette1: { h: 0.3, s: 1, v: 1 },
    colorPalette2: { h: 0.8, s: 1, v: 1 },
  });
  assert.deepEqual(seeded, result);
});

test('parked ColorAutopilot seed reads the shared Deck rendering surface', () => {
  const shared = paletteCenter(0.1, 0.6);
  const live = paletteCenter(0.3, 0.8);
  const liveTouchSession = {
    paramCenter: live,
    getState: () => ({ active: false }),
  };
  let seeded = null;

  assert.equal(activeColorParamCenter(shared, liveTouchSession), shared);
  seedColorAutopilotFromActiveSurface(
    { seedCurrentParams: params => { seeded = params; } },
    shared,
    liveTouchSession,
  );
  assert.deepEqual(seeded, {
    colorPalette1: { h: 0.1, s: 1, v: 1 },
    colorPalette2: { h: 0.6, s: 1, v: 1 },
  });
});

test('an active session without a private ParamCenter fails loudly', () => {
  assert.throws(
    () => activeColorParamCenter(paletteCenter(0.1, 0.6), {
      paramCenter: null,
      getState: () => ({ active: true }),
    }),
    /active Live Touch session has no private ParamCenter/,
  );
});
