/**
 * sacn_mapper.test.js — demap contract tests (docs/33 + operator
 * reports 2026-06-11/12 and 20260725_78/_81).
 *
 * TWO rules, and they are independent:
 *
 *  1. NO BLEEDING (2026-06-11, non-negotiable). A fixture the frame does not
 *     drive is REPAINTED every time its treatment changes — it must never
 *     freeze at whatever colour the local pattern last painted. In sACN-in
 *     mode the frame is the only truth.
 *
 *  2. WHICH repaint is the operator's call, via "Show Unpatched (Red)".
 *     ON  → bright red, his 2026-06-12 "red, not black" diagnostic, unchanged.
 *     OFF → black, matching the other two unpatched indicators (the fixture
 *           shell tint and the instanced-dot flush, both animate.js), which
 *           have always obeyed that switch. Before 20260725_81 this one
 *           obeyed nothing, so an operator with the toggle off still got red
 *           bulbs and red halo rings he could not turn off.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { demapSacnToPixels } from '../src/dmx/sacn_mapper.js';

function mockRouter(frames) {
  return { getFullFrame: (u) => frames[u] || null };
}

function entryWithStaleColor(overrides = {}) {
  const applied = [];
  return {
    entry: {
      r: 0.8, g: 0.1, b: 0.9, w: 0, a: 0, u: 0,
      patch: null,
      channels: { r: 1, g: 2, b: 3 },
      apply: (r, g, b) => applied.push([r, g, b]),
      ...overrides,
    },
    applied,
  };
}

function assertUndrivenRed(entry) {
  assert.equal(entry.r, 1, 'undriven indicator red');
  assert.equal(entry.g, 0);
  assert.equal(entry.b, 0);
  assert.equal(entry.w, 0);
  assert.equal(entry.a, 0);
  assert.equal(entry.u, 0);
}

function assertUndrivenBlack(entry) {
  assert.equal(entry.r, 0, 'undriven with the toggle off must be BLACK');
  assert.equal(entry.g, 0);
  assert.equal(entry.b, 0);
  assert.equal(entry.w, 0);
  assert.equal(entry.a, 0);
  assert.equal(entry.u, 0);
  assert.equal(entry._sacnUndriven, true,
    'black-because-undriven must still be MARKED undriven — that flag is what ' +
    'keeps it distinguishable from a driven blackout and stops it bleeding');
}

// ── Rule 1: no bleeding, under either treatment ──────────────────────────

test('unpatched entry is repainted bright red instead of keeping stale colors', () => {
  const { entry, applied } = entryWithStaleColor({ patch: null });
  demapSacnToPixels([entry], mockRouter({}), true);
  assertUndrivenRed(entry);
  assert.deepEqual(applied, [[1, 0, 0]]);
});

test('unpatched entry is repainted BLACK — not left bleeding — when the toggle is off', () => {
  const { entry, applied } = entryWithStaleColor({ patch: null });
  demapSacnToPixels([entry], mockRouter({}), false);
  assertUndrivenBlack(entry);
  assert.deepEqual(applied, [[0, 0, 0]],
    'the stale pattern colour must be actively overwritten, not just skipped');
});

test('entry on a universe with no received buffer is repainted bright red', () => {
  const { entry, applied } = entryWithStaleColor({
    patch: { universe: 7, addr: 1, footprint: 10 },
  });
  demapSacnToPixels([entry], mockRouter({}), true); // no U7 buffer
  assertUndrivenRed(entry);
  assert.deepEqual(applied, [[1, 0, 0]]);
});

test('entry on a universe with no received buffer goes black when the toggle is off', () => {
  const { entry, applied } = entryWithStaleColor({
    patch: { universe: 7, addr: 1, footprint: 10 },
  });
  demapSacnToPixels([entry], mockRouter({}), false);
  assertUndrivenBlack(entry);
  assert.deepEqual(applied, [[0, 0, 0]]);
});

test('indicator apply is skipped once the entry is marked (steady state)', () => {
  const { entry, applied } = entryWithStaleColor({ patch: null });
  const router = mockRouter({});
  demapSacnToPixels([entry], router, true);
  demapSacnToPixels([entry], router, true);
  demapSacnToPixels([entry], router, true);
  assert.equal(applied.length, 1, 'apply(1,0,0) fires once, not per frame');
});

test('the black treatment is just as cheap in steady state', () => {
  const { entry, applied } = entryWithStaleColor({ patch: null });
  const router = mockRouter({});
  for (let i = 0; i < 5; i++) demapSacnToPixels([entry], router, false);
  assert.equal(applied.length, 1, 'apply(0,0,0) fires once, not per frame');
});

// ── Rule 2: the toggle owns which treatment, live ────────────────────────

test('flipping "Show Unpatched (Red)" repaints on the NEXT frame, no reload', () => {
  // The operator flips the switch mid-session; the demap runs every frame, so
  // the very next one must carry the new treatment through to entry.apply()
  // (which is what paints bulb + halo + cone). A steady-state fast path that
  // only looked at "am I already marked undriven?" would swallow this.
  const { entry, applied } = entryWithStaleColor({ patch: null });
  const router = mockRouter({});

  demapSacnToPixels([entry], router, false);
  assertUndrivenBlack(entry);

  demapSacnToPixels([entry], router, true);   // toggle ON
  assertUndrivenRed(entry);

  demapSacnToPixels([entry], router, false);  // toggle OFF again
  assertUndrivenBlack(entry);

  assert.deepEqual(applied, [[0, 0, 0], [1, 0, 0], [0, 0, 0]],
    'each flip must produce exactly one repaint — no misses, no per-frame churn');
});

test('a caller that forgets to pass the toggle fails loudly', () => {
  // No fallback: the treatment of an unmapped fixture is an operator setting,
  // so a miswired caller must crash rather than quietly pick a colour.
  const { entry } = entryWithStaleColor({ patch: null });
  assert.throws(() => demapSacnToPixels([entry], mockRouter({})), TypeError);
  assert.throws(() => demapSacnToPixels([entry], mockRouter({}), 'yes'), TypeError);
  assert.throws(() => demapSacnToPixels([entry], mockRouter({}), 1), TypeError);
});

// ── The driven path is untouched by any of this ──────────────────────────

test('patched entry still demaps frame values at addr + channel offsets', () => {
  const frame = new Uint8Array(512);
  // fixture at addr 100, channels {r:3,g:4,b:5} → absolute 102,103,104
  frame[101] = 255; // ch 3 (r)
  frame[102] = 128; // ch 4 (g)
  frame[103] = 0;   // ch 5 (b)
  const { entry } = entryWithStaleColor({
    patch: { universe: 2, addr: 100, footprint: 10 },
    channels: { r: 3, g: 4, b: 5 },
  });
  demapSacnToPixels([entry], mockRouter({ 2: frame }), false);
  assert.equal(entry.r, 1);
  assert.ok(Math.abs(entry.g - 128 / 255) < 1e-9);
  assert.equal(entry.b, 0);
});

test('a genuinely RED driven frame stays red with the toggle off', () => {
  // The Left Auditorium pars, measured live 2026-07-30: patched on U6/U8 and
  // driven [dimmer 100, R 47, G 0, B 0]. Nothing in the unpatched gate may
  // touch a fixture the frame IS driving — that red is the show.
  const frame = new Uint8Array(512);
  frame[0] = 100; // dimmer
  frame[2] = 47;  // ch 3 (r)
  const { entry } = entryWithStaleColor({
    patch: { universe: 6, addr: 1, footprint: 10 },
    channels: { r: 3, g: 4, b: 5 },
  });
  demapSacnToPixels([entry], mockRouter({ 6: frame }), false);
  assert.ok(Math.abs(entry.r - 47 / 255) < 1e-9, 'driven red survives the gate');
  assert.equal(entry.g, 0);
  assert.equal(entry.b, 0);
});

test('a fixture that loses its patch mid-session turns red on the next frame', () => {
  const frame = new Uint8Array(512);
  frame[2] = 255; // U2:1 ch3 (b) — drive blue while patched
  const { entry, applied } = entryWithStaleColor({
    patch: { universe: 2, addr: 1, footprint: 3 },
    channels: { r: 1, g: 2, b: 3 },
  });
  const router = mockRouter({ 2: frame });
  demapSacnToPixels([entry], router, true);
  assert.equal(entry.b, 1, 'driven blue while patched');
  assert.equal(entry.r, 0);
  entry.patch = null; // mapper unmapped it (projection → unpatched)
  demapSacnToPixels([entry], router, true);
  assertUndrivenRed(entry);
  assert.deepEqual(applied[applied.length - 1], [1, 0, 0]);
});

test('regaining a patch clears the undriven marks (no stale-flag confusion)', () => {
  // lose patch → painted red and marked → regain patch on a coincidentally red
  // frame. The marks must be cleared, or the next toggle flip would repaint a
  // fixture that is now genuinely driven.
  const frame = new Uint8Array(512);
  frame[0] = 255; // ch1 (r)
  const { entry } = entryWithStaleColor({ patch: null, channels: { r: 1, g: 2, b: 3 } });
  const router = mockRouter({ 2: frame });
  demapSacnToPixels([entry], router, true);
  assert.equal(entry._sacnUndriven, true);
  entry.patch = { universe: 2, addr: 1, footprint: 3 };
  demapSacnToPixels([entry], router, true);
  assert.equal(entry._sacnUndriven, false, 'driven again → not undriven');
  assert.equal(entry._sacnUndrivenRed, false, 'the treatment mark clears with it');
  assert.equal(entry.r, 1, 'and it carries its real, driven colour');
});

test('a driven black frame stays black — the indicator is only for UNDRIVEN entries', () => {
  const frame = new Uint8Array(512); // engine fader down: all zeros
  const { entry } = entryWithStaleColor({
    patch: { universe: 2, addr: 1, footprint: 3 },
    channels: { r: 1, g: 2, b: 3 },
  });
  demapSacnToPixels([entry], mockRouter({ 2: frame }), true);
  assert.equal(entry.r, 0, 'patched fixture at blackout renders black, not red');
  assert.equal(entry.g, 0);
  assert.equal(entry.b, 0);
  assert.notEqual(entry._sacnUndriven, true, 'and it is not marked undriven');
});
