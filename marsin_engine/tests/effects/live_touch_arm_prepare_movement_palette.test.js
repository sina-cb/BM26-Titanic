/**
 * Regression: ARM prepare must stage movementTrace slots without slot-owned colours.
 *
 * The wire used to PATCH /global-effect-slots/9 with paramsOverride.colors during
 * atomic prepare. The engine refuses that with LIVE_TOUCH_OVERLAY_PALETTE_REQUIRED
 * because movementTrace reads the session-owned five-colour palette instead.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

import '../helpers/setup_config_guard.mjs';
import { createEngineHarness } from '../helpers/spawn_engine.mjs';

const OWNER_ID = 'live_touch_arm_palette_owner';
const OWNER_HEADERS = { 'X-Touch-Control-Owner': OWNER_ID };
const OVERLAY_PALETTE = [
  { h: 0.00, s: 1, v: 1 },
  { h: 0.16, s: 1, v: 1 },
  { h: 0.33, s: 1, v: 1 },
  { h: 0.55, s: 1, v: 1 },
  { h: 0.78, s: 1, v: 1 },
];
const SLOT_9_BODY = {
  enabled: true,
  label: 'Pulse Slow Fade',
  effectId: 'movementTrace',
  presetId: 'pulse_slow_fade',
  behavior: 'toggle',
  paramsOverride: {
    fadeSpan: 0.5,
    switchMs: 4000,
  },
};

const h = createEngineHarness({
  scene: 'test_bench',
  pattern: '13_sparkle',
  prefix: 'live-touch-arm-prepare-movement-palette',
  portBase: 17840,
  portSpan: 40,
  extraArgs: ['--dest', '192.0.2.9'],
});

function openWs() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${h.port}/ws/control`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitFor(ws, predicate, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeListener('message', onMessage);
      reject(new Error('timed out waiting for Live Touch control acknowledgement'));
    }, timeoutMs);
    function onMessage(buf) {
      let message;
      try {
        message = JSON.parse(buf.toString());
      } catch {
        return;
      }
      if (!predicate(message)) return;
      clearTimeout(timer);
      ws.removeListener('message', onMessage);
      resolve(message);
    }
    ws.on('message', onMessage);
  });
}

async function armOwner(ws) {
  const hello = waitFor(ws, message => message.type === 'touchControlHelloAck'
    && message.ownerId === OWNER_ID);
  ws.send(JSON.stringify({ type: 'touchControlHello', ownerId: OWNER_ID }));
  await hello;

  const armed = waitFor(ws, message => message.type === 'touchControlArmedAck'
    && message.ownerId === OWNER_ID && message.armed === true);
  ws.send(JSON.stringify({ type: 'touchControlArmed', ownerId: OWNER_ID, armed: true }));
  return armed;
}

before(async () => {
  h.spawnEngine();
  await h.waitForReady();
});

after(async () => {
  await h.teardown();
});

test('prepare rejects movementTrace slot colours and accepts palette-first ARM staging', async () => {
  const ws = await openWs();
  try {
    await armOwner(ws);

    const staged = await h.api('PUT', '/layers/live_touch/pattern', {
      pattern: '13_sparkle',
    }, OWNER_HEADERS);
    assert.equal(staged.status, 200, JSON.stringify(staged.data));

    const rejectedColors = await h.api('POST', '/layers/live_touch/prepare', {
      expectedSessionRevision: staged.data.sessionRevision,
      operations: [
        {
          method: 'PATCH',
          path: '/global-effect-slots/9',
          body: {
            ...SLOT_9_BODY,
            paramsOverride: {
              ...SLOT_9_BODY.paramsOverride,
              colors: OVERLAY_PALETTE.map(color => [color.h, color.s, color.v, 0, 0, 0]),
            },
          },
        },
      ],
    }, OWNER_HEADERS);
    assert.equal(rejectedColors.status, 400, JSON.stringify(rejectedColors.data));
    assert.equal(rejectedColors.data.code, 'LIVE_TOUCH_OVERLAY_PALETTE_REQUIRED');
    assert.match(rejectedColors.data.error, /movementTrace colors are session-owned/);
    assert.equal(rejectedColors.data.operationIndex, 0);

    const accepted = await h.api('POST', '/layers/live_touch/prepare', {
      expectedSessionRevision: staged.data.sessionRevision,
      operations: [
        {
          method: 'POST',
          path: '/layers/live_touch/palette',
          body: { colorPalette: OVERLAY_PALETTE },
        },
        {
          method: 'PATCH',
          path: '/global-effect-slots/9',
          body: SLOT_9_BODY,
        },
      ],
    }, OWNER_HEADERS);
    assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
    assert.equal(accepted.data.operationCount, 2);

    const paletteReadback = await h.api('GET', '/layers/live_touch/palette', undefined, OWNER_HEADERS);
    assert.deepEqual(paletteReadback.data.colorPalette, OVERLAY_PALETTE);

    const slots = await h.api('GET', '/global-effect-slots', undefined, OWNER_HEADERS);
    assert.equal(slots.status, 200, JSON.stringify(slots.data));
    const slot9 = slots.data.slots.find(slot => slot.slotId === 9);
    assert.ok(slot9, JSON.stringify(slots.data));
    assert.equal(slot9.effectId, 'movementTrace');
    assert.equal(slot9.paramsOverride.colors, undefined);
  } finally {
    ws.close();
  }
});

test('prepare does not require palette-before-slot ordering when slot colours are omitted', async () => {
  const ws = await openWs();
  try {
    await armOwner(ws);

    const staged = await h.api('PUT', '/layers/live_touch/pattern', {
      pattern: '13_sparkle',
    }, OWNER_HEADERS);
    assert.equal(staged.status, 200, JSON.stringify(staged.data));

    const reversed = await h.api('POST', '/layers/live_touch/prepare', {
      expectedSessionRevision: staged.data.sessionRevision,
      operations: [
        {
          method: 'PATCH',
          path: '/global-effect-slots/9',
          body: SLOT_9_BODY,
        },
        {
          method: 'POST',
          path: '/layers/live_touch/palette',
          body: { colorPalette: OVERLAY_PALETTE },
        },
      ],
    }, OWNER_HEADERS);
    assert.equal(reversed.status, 200, JSON.stringify(reversed.data));
    assert.equal(reversed.data.operationCount, 2);

    const paletteReadback = await h.api('GET', '/layers/live_touch/palette', undefined, OWNER_HEADERS);
    assert.deepEqual(paletteReadback.data.colorPalette, OVERLAY_PALETTE);
  } finally {
    ws.close();
  }
});
