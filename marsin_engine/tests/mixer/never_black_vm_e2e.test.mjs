// END-TO-END never-black enforcement through the REAL vendored WASM VM
// (red-team _112 I1/I2, wave-1 _118). Unlike never_black_enforcer.test.js
// (fake host, proves the enforcer logic), this compiles ACTUAL hostile
// MarsinScript through the real WasmHost, wires the compiled handle as the
// mixer deck, and renders the whole path — proving the two silent dark-ship
// root causes really do reach the enforcer as a black composite and trip it:
//
//   I1 — a NaN in ONE arg to rgbwau() blacks the whole pixel, and NaN is
//        absorbing in persistent state (acc = acc + 0/0 → black forever).
//   I2 — a beforeRender that overruns the ~5000-instruction budget truncates
//        SILENTLY, so the mandatory palette resolve never runs → black rig
//        from a pattern that compiled clean.
//
// Both compile cleanly (proving the "clean-compiling pattern goes dark"
// hazard) and both must drive renderHealth.ok=false with the floor engaged.
//
// Run: cd marsin_engine && node --test tests/mixer/never_black_vm_e2e.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { WasmHost } from '../../lib/wasm_host.js';
import { PatternMixer } from '../../lib/pattern_mixer.js';

const N = 16;

function mkCoords(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ nx: i / (n - 1), ny: (i % 7) / 6, nz: (i % 5) / 4 });
  return out;
}

async function runHostilePattern(src) {
  const host = new WasmHost();
  await host.init(N);
  host.setCoords(mkCoords(N));
  const compiled = host.compile(src);
  assert.equal(compiled.ok, true, `hostile pattern must COMPILE CLEAN (that is the hazard): ${compiled.error}`);

  const mixer = new PatternMixer({ wasmHost: host, pixelCount: N });
  mixer.viewFader = 0.0;      // composite = pure deck
  mixer.targetViewFader = 0.0;
  mixer.master = 1.0;
  const deck = mixer.setDeckChannel({
    id: 'deck', name: 'D', pattern: 'hostile', handle: compiled.handle, fader: 1.0, enabled: true,
  });

  // Render past the trip threshold. beginFrame advances the pattern clock so a
  // NaN-in-persistent-state pattern latches, exactly as it would on the rig.
  let t = 0;
  for (let f = 0; f < mixer.NEVER_BLACK_TRIP_FRAMES + 4; f++) {
    deck.beginFrame(host, t, true);
    mixer.renderAll6ch();
    t += 0.025;
  }
  const health = mixer.getRenderHealth();
  mixer.destroy();
  return health;
}

test('I1: a NaN arg to rgbwau() blacks the pixel and trips the enforcer (real VM)', async () => {
  // A single NaN argument (0.0/0.0) blacks the whole pixel in the vendored VM.
  const src = `
export function beforeRender(delta) {}
export function render3D(index, x, y, z) { rgbwau(1.0, 0.0/0.0, 1.0, 0.5, 0.5, 0.0); }
`;
  const h = await runHostilePattern(src);
  assert.equal(h.darkness.tripped, true, 'NaN-black must trip never-black');
  assert.equal(h.ok, false, 'renderHealth.ok must be false');
  assert.equal(h.darkness.floorActive, true, 'last-resort floor must engage');
});

test('I1: an absorbing NaN in persistent state trips the enforcer (real VM)', async () => {
  // acc goes NaN on frame 1 and never recovers → black forever.
  const src = `
var acc = 0.5;
export function beforeRender(delta) { acc = acc + (0.0/0.0); }
export function render3D(index, x, y, z) { rgbwau(acc, 0.5, 0.5, 0.0, 0.0, 0.0); }
`;
  const h = await runHostilePattern(src);
  assert.equal(h.darkness.tripped, true, 'absorbing-NaN black must trip never-black');
  assert.equal(h.ok, false);
  assert.equal(h.darkness.floorActive, true);
});

test('I2: a beforeRender budget overrun blacks the rig and trips the enforcer (real VM)', async () => {
  // The house idiom: resolve the palette at the TOP of beforeRender. A heavy
  // precompute loop BEFORE it (a plausible ChatGPT "smooth motion" edit) blows
  // the instruction budget, truncates beforeRender silently, and the palette
  // resolve never runs → render3D reads zeroed state → black.
  const src = `
var pr = 0.0, pg = 0.0, pb = 0.0;
var junk = 0.0;
export function beforeRender(delta) {
  for (var kk = 0; kk < 6000; kk++) { junk = junk + 0.00001; }
  pr = 1.0; pg = 0.5; pb = 0.25;
}
export function render3D(index, x, y, z) { rgbwau(pr, pg, pb, 0.0, 0.0, 0.0); }
`;
  const h = await runHostilePattern(src);
  assert.equal(h.darkness.tripped, true, 'beforeRender-truncation black must trip never-black');
  assert.equal(h.ok, false);
  assert.equal(h.darkness.floorActive, true);
});

test('a healthy pattern renders lit and stays green (real VM)', async () => {
  const src = `
export function beforeRender(delta) {}
export function render3D(index, x, y, z) { rgbwau(0.8, 0.2, 0.4, 0.0, 0.0, 0.0); }
`;
  const h = await runHostilePattern(src);
  assert.equal(h.darkness.tripped, false, 'a lit pattern must never trip');
  assert.equal(h.ok, true);
  assert.equal(h.darkness.floorActive, false);
});
