import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertExactFiveHsv,
  overlayFrameFromTransitionState,
} from '../../lib/live_touch_session_palette.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WIRE_SOURCE = fs.readFileSync(
  path.resolve(HERE, '../../../CaptainPad/live_touch/touch_control_wire.js'),
  'utf8',
);

const ring = [
  { h: 0.1, s: 0.9, v: 0.8 },
  { h: 0.6, s: 0.9, v: 0.8 },
  { h: 0.2, s: 0.7, v: 0.7 },
  { h: 0.3, s: 0.6, v: 0.6 },
  { h: 0.4, s: 0.5, v: 0.5 },
];
const sel = [0, 1];

function createOverlayTransitionDriver() {
  const requests = [];
  const ctx = { ring: ring.slice(), sel: sel.slice(), transitionId: null, terminalPosted: false };
  return {
    requests,
    rememberPalette(detail) {
      if (Array.isArray(detail.palette) && detail.palette.length === 5) {
        ctx.ring = assertExactFiveHsv(detail.palette);
      }
      if (Array.isArray(detail.sel) && detail.sel.length === 2) ctx.sel = detail.sel.slice();
    },
    reset() {
      ctx.transitionId = null;
      ctx.terminalPosted = false;
    },
    handle(transition, armed) {
      if (!transition || typeof transition !== 'object') {
        this.reset();
        return;
      }
      if (!armed) {
        this.reset();
        return;
      }
      const status = transition.status || (transition.active ? 'running' : 'idle');
      if (status === 'running') {
        ctx.terminalPosted = false;
        ctx.transitionId = transition.id;
        const frame = overlayFrameFromTransitionState(transition, ctx.ring, ctx.sel);
        requests.push({ colorPalette: assertExactFiveHsv(frame) });
        return;
      }
      if (ctx.transitionId !== null && transition.id !== ctx.transitionId) return;
      if (ctx.terminalPosted) return;
      if (status === 'settled' || status === 'cancelled' || status === 'failed') {
        const frame = overlayFrameFromTransitionState(transition, ctx.ring, ctx.sel);
        requests.push({ colorPalette: assertExactFiveHsv(frame) });
        ctx.terminalPosted = true;
        ctx.transitionId = null;
      }
    },
  };
}

test('wire contract keeps canonical five-colour overlay transition driver while ARMED', () => {
  assert.match(WIRE_SOURCE, /handleColorTransitionBroadcast/);
  assert.match(WIRE_SOURCE, /readPublishedFivePalette/);
  assert.match(WIRE_SOURCE, /resetOverlayTransitionDriver/);
  assert.match(WIRE_SOURCE, /LiveTouchSessionPalette/);
  assert.match(WIRE_SOURCE, /assertExactFiveHsv\(parsed\)/);
});

test('ARMED crossfade transition publishes only exact-five overlay palette requests', () => {
  const driver = createOverlayTransitionDriver();
  driver.rememberPalette({ palette: ring, sel });

  const frames = [
    {
      id: 1,
      status: 'running',
      active: true,
      progress: 0,
      params: {
        colorPalette1: { h: 0.1, s: 0.9, v: 0.8 },
        colorPalette2: { h: 0.6, s: 0.9, v: 0.8 },
      },
    },
    {
      id: 1,
      status: 'running',
      active: true,
      progress: 0.5,
      params: {
        colorPalette1: { h: 0.35, s: 0.9, v: 0.8 },
        colorPalette2: { h: 0.35, s: 0.9, v: 0.8 },
      },
    },
    {
      id: 1,
      status: 'settled',
      active: false,
      progress: 1,
      params: {
        colorPalette1: { h: 0.6, s: 0.9, v: 0.8 },
        colorPalette2: { h: 0.1, s: 0.9, v: 0.8 },
      },
    },
  ];

  frames.forEach((transition) => driver.handle(transition, true));
  driver.handle({
    id: 2,
    status: 'running',
    active: true,
    progress: 0.2,
    params: {
      colorPalette1: { h: 0.2, s: 0.9, v: 0.8 },
      colorPalette2: { h: 0.5, s: 0.9, v: 0.8 },
    },
  }, false);

  assert.equal(driver.requests.length, 3, 'running + terminal frames only while ARMED');
  driver.requests.forEach((req, index) => {
    assert.equal(assertExactFiveHsv(req.colorPalette, `frame ${index}`).length, 5);
  });
  assert.deepEqual(
    driver.requests.at(-1).colorPalette[0],
    overlayFrameFromTransitionState(frames.at(-1), ring, sel)[0],
  );
});

test('rapid repeated transitions post the latest terminal destination only once per id', () => {
  const driver = createOverlayTransitionDriver();
  driver.rememberPalette({ palette: ring, sel });

  [
    {
      id: 10,
      status: 'running',
      active: true,
      progress: 0.2,
      params: {
        colorPalette1: { h: 0.15, s: 0.9, v: 0.8 },
        colorPalette2: { h: 0.55, s: 0.9, v: 0.8 },
      },
    },
    {
      id: 11,
      status: 'running',
      active: true,
      progress: 0.1,
      params: {
        colorPalette1: { h: 0.25, s: 0.9, v: 0.8 },
        colorPalette2: { h: 0.45, s: 0.9, v: 0.8 },
      },
    },
    {
      id: 11,
      status: 'settled',
      active: false,
      progress: 1,
      params: {
        colorPalette1: { h: 0.6, s: 0.9, v: 0.8 },
        colorPalette2: { h: 0.1, s: 0.9, v: 0.8 },
      },
    },
  ].forEach((transition) => driver.handle(transition, true));

  assert.equal(driver.requests.length, 3);
  assert.deepEqual(driver.requests.at(-1).colorPalette[0], { h: 0.6, s: 0.9, v: 0.8 });
});

test('two-colour crossfade never publishes fewer than five swatch colours to the overlay', () => {
  const twoColourOrbit = [{ h: 0.1, s: 1, v: 1 }, { h: 0.6, s: 1, v: 1 }];
  assert.throws(
    () => assertExactFiveHsv(twoColourOrbit.map((c) => ({ h: c.h, s: c.s, v: c.v }))),
    /exactly 5 HSV colors/,
  );
  const frame = overlayFrameFromTransitionState({
    status: 'running',
    params: { colorPalette1: twoColourOrbit[0], colorPalette2: twoColourOrbit[1] },
  }, ring, sel);
  assert.equal(frame.length, 5);
});

test('five-swatch wheel mode keeps slots 3-5 on the staged ring during transition', () => {
  const frame = overlayFrameFromTransitionState({
    status: 'running',
    params: {
      colorPalette1: { h: 0.35, s: 0.9, v: 0.8 },
      colorPalette2: { h: 0.35, s: 0.9, v: 0.8 },
    },
  }, ring, sel);
  assert.deepEqual(frame.slice(2), ring.slice(2));
});

test('overlay driver drops pending palette writes on disarm cleanup', () => {
  assert.match(WIRE_SOURCE, /delete pending\['overlayPalette'\]/);
  assert.match(WIRE_SOURCE, /if \(state\.phase !== 'armed'\) return Promise\.resolve\(\);[\s\S]*?pushOverlayPalette/);
});

test('invalid published palette fails before overlay network write', () => {
  assert.match(WIRE_SOURCE, /catch \(e\) \{[\s\S]*?fail\('palette transition', e\)/);
});
