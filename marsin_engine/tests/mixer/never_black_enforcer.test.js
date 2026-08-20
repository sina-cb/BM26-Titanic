// Regression tests for the R4 "NEVER FULLY BLACK" runtime enforcer
// (red-team _112 findings I1 NaN-black / I2 beforeRender-truncation-black,
// fixed in wave-1 _118). These are the _112 repros flipped from break-it to
// green regression: the enforcer must trip a LOUD render-health flag (and
// engage a dim last-resort floor) when the composite that feeds sACN goes
// fully black while the mix is configured to emit light — the exact silent
// dark-ship outcome a NaN in a colour builtin or a beforeRender budget overrun
// produces on a clean-compiling pattern.
//
// The vendored WASM absorbs the NaN into a 0 byte before JS sees it and the
// marsin_begin_frame ABI is void (no truncation channel — verified in _118),
// so enforcement is necessarily on the CONSEQUENCE: a persistently-black-while
// -lit output buffer. These tests drive the real PatternMixer.renderAll6ch()
// with a fake WASM host + painters, mirroring channel_metering.test.js.
//
// Run:  cd marsin_engine && node --test tests/mixer/never_black_enforcer.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PatternMixer } from '../../lib/pattern_mixer.js';

function makeFakeWasmHost() {
  return {
    renderAll6ch(handle, buffer) {
      if (typeof handle?.fillFn === 'function') handle.fillFn(buffer);
    },
    renderBlend6ch(blendHandle, n, bg, fg, fader) {
      const out = new Uint8Array(bg.length);
      for (let i = 0; i < bg.length; i++) out[i] = Math.round(bg[i] + (fg[i] - bg[i]) * fader);
      return out;
    },
    beginFrame() {},
    setControl() {},
    destroy() {},
    getExports() { return []; },
    compile() { return { ok: true, handle: { fillFn: () => {} } }; },
  };
}

// A handle whose fillFn writes a constant byte to every channel (v=0 → black).
function constPainter(v) {
  return { fillFn: (buf) => { for (let i = 0; i < buf.length; i++) buf[i] = v; } };
}

// A handle that paints every pixel exactly (255,0,0,0,0,0) — the VM's silent
// over-budget signature (_112 F9).
function redPainter(pixelCount) {
  return {
    fillFn: (buf) => {
      for (let p = 0; p < pixelCount; p++) {
        const k = p * 6;
        buf[k] = 255; buf[k + 1] = 0; buf[k + 2] = 0; buf[k + 3] = 0; buf[k + 4] = 0; buf[k + 5] = 0;
      }
    },
  };
}

// Deck-only mixer (viewFader = 0 → composite is pure deck), master up.
function makeDeckMixer({ pixelCount = 8 } = {}) {
  const mixer = new PatternMixer({ wasmHost: makeFakeWasmHost(), pixelCount });
  mixer.viewFader = 0.0;
  mixer.targetViewFader = 0.0;
  mixer.master = 1.0;
  return mixer;
}

function renderN(mixer, n) {
  for (let i = 0; i < n; i++) mixer.renderAll6ch();
}

test('a fully-black deck at full fader trips the never-black flag after the streak', () => {
  const m = makeDeckMixer();
  m.setDeckChannel({ id: 'deck', name: 'D', pattern: 'evil_black', handle: constPainter(0), fader: 1.0, enabled: true });

  // One frame short of the trip threshold: dark, streak building, NOT tripped.
  renderN(m, m.NEVER_BLACK_TRIP_FRAMES - 1);
  let h = m.getRenderHealth();
  assert.equal(h.darkness.black, true, 'frame should be flagged black');
  assert.equal(h.darkness.tripped, false, 'must not trip before the streak threshold');
  assert.equal(h.ok, true, 'ok stays true until the trip');

  // Crossing the threshold trips the flag, drives ok=false, and floors output.
  m.renderAll6ch();
  h = m.getRenderHealth();
  assert.equal(h.darkness.tripped, true, 'never-black must trip at the threshold');
  assert.equal(h.ok, false, 'renderHealth.ok must go false when dark-while-lit');
  assert.equal(h.darkness.floorActive, true, 'last-resort floor must engage');
  assert.equal(h.darkness.pattern, 'evil_black', 'the trip names the offending deck pattern');
  assert.ok(h.darkness.blackStreak >= m.NEVER_BLACK_TRIP_FRAMES);

  // The shipped buffer is no longer fully black — the dim floor is present.
  const out = m.outputBuffer;
  assert.equal(out[0], m.NEVER_BLACK_FLOOR_VALUE, 'R floored');
  assert.equal(out[1], m.NEVER_BLACK_FLOOR_VALUE, 'G floored');
  assert.equal(out[2], m.NEVER_BLACK_FLOOR_VALUE, 'B floored');
  let anyNonZero = false;
  for (let i = 0; i < out.length; i++) if (out[i] !== 0) { anyNonZero = true; break; }
  assert.ok(anyNonZero, 'the ship must never be shipped fully dark once tripped');
});

test('a lit deck never trips and stays green', () => {
  const m = makeDeckMixer();
  m.setDeckChannel({ id: 'deck', name: 'D', pattern: 'good', handle: constPainter(200), fader: 1.0, enabled: true });
  renderN(m, m.NEVER_BLACK_TRIP_FRAMES * 3);
  const h = m.getRenderHealth();
  assert.equal(h.darkness.tripped, false);
  assert.equal(h.darkness.floorActive, false);
  assert.equal(h.ok, true);
  assert.equal(h.darkness.blackStreak, 0);
});

test('a legitimate operator blackout (master 0) never trips', () => {
  const m = makeDeckMixer();
  m.master = 0.0; // full blackout — output is intentionally dark
  m.setDeckChannel({ id: 'deck', name: 'D', pattern: 'anything', handle: constPainter(200), fader: 1.0, enabled: true });
  renderN(m, m.NEVER_BLACK_TRIP_FRAMES * 3);
  const h = m.getRenderHealth();
  assert.equal(h.darkness.tripped, false, 'a deliberate blackout must not be flagged as a fault');
  assert.equal(h.ok, true);
});

test('a black deck faded to zero never trips (no light expected)', () => {
  const m = makeDeckMixer();
  m.setDeckChannel({ id: 'deck', name: 'D', pattern: 'x', handle: constPainter(0), fader: 0.0, enabled: true });
  renderN(m, m.NEVER_BLACK_TRIP_FRAMES * 3);
  const h = m.getRenderHealth();
  assert.equal(h.darkness.tripped, false);
  assert.equal(h.ok, true);
});

test('a solid-red (over-budget) deck flags solidRed and fails ok without flooring', () => {
  const m = makeDeckMixer();
  m.setDeckChannel({ id: 'deck', name: 'D', pattern: 'over_budget', handle: redPainter(8), fader: 1.0, enabled: true });
  m.renderAll6ch();
  const h = m.getRenderHealth();
  assert.equal(h.darkness.solidRed, true, 'solid-red over-budget signature must be detected');
  assert.equal(h.ok, false, 'solid-red must fail the render-health green light');
  assert.equal(h.darkness.black, false, 'solid-red is not counted as black');
  assert.equal(h.darkness.floorActive, false, 'solid-red is not floored (it is already visible)');
});

test('the enforcer recovers (clears the trip) when light returns', () => {
  const m = makeDeckMixer();
  const deck = m.setDeckChannel({ id: 'deck', name: 'D', pattern: 'evil_black', handle: constPainter(0), fader: 1.0, enabled: true });
  renderN(m, m.NEVER_BLACK_TRIP_FRAMES + 2);
  assert.equal(m.getRenderHealth().darkness.tripped, true);

  // Operator swaps in a working pattern — the deck now paints light.
  deck.handle = constPainter(180);
  m.renderAll6ch();
  const h = m.getRenderHealth();
  assert.equal(h.darkness.tripped, false, 'trip clears once the ship is lit again');
  assert.equal(h.darkness.blackStreak, 0);
  assert.equal(h.ok, true, 'ok goes green on recovery');
});

test('getNeverBlackHealth() exposes the standalone verdict', () => {
  const m = makeDeckMixer();
  m.setDeckChannel({ id: 'deck', name: 'D', pattern: 'evil_black', handle: constPainter(0), fader: 1.0, enabled: true });
  renderN(m, m.NEVER_BLACK_TRIP_FRAMES);
  const nb = m.getNeverBlackHealth();
  assert.equal(nb.lit, false);
  assert.equal(nb.tripped, true);
  assert.equal(nb.floorActive, true);
  assert.equal(nb.pattern, 'evil_black');
  assert.ok(typeof nb.sinceFrame === 'number');
});
