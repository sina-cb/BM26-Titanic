// Pattern mixer view-selection masking tests.
//
// Covers the requirements listed in
// docs/27_[todo]_mixer_layer_view_selection.md §6.1:
//   - default startup outputs the mixerBuffer (viewFader = 1.0)
//   - viewFader=0 outputs deck; viewFader=1 outputs mixer; 0.5 is linear
//   - first mixer overlay seeds mixerBuffer (background stacking)
//   - muted/disabled background mixer overlay does NOT paint into mixerBuffer
//   - per-layer masked commit: blue on "Wall" leaves rest red
//   - PFL/deck blackout: unselected pixels in deck go to black
//   - API payload validator rejects malformed shapes (400)
//   - pixel-array alignment guard throws at construction
//
// Architecture note (post slot 6 channel_isolation merge):
//   The mixer no longer treats one of `channels[]` as a "base" — the
//   deck channel lives in `this.deckChannel` (rendered into deckBuffer)
//   and the mixer overlay stack lives in `this.mixerChannels[]`
//   (composited bottom-to-top into mixerBuffer). To preserve the
//   "background wash + masked overlay" tests we wire up BOTH a red
//   deck channel (so viewFader=0 tests still see red in deckBuffer)
//   AND a red first mixer overlay (so the masked-overlay tests still
//   have a non-black background to preserve under the mask).
//
// Run:  cd marsin_engine && node --test tests/pattern_mixer_masking.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PatternMixer, compileViewSelectionMask } from '../lib/pattern_mixer.js';
import { validateViewSelection } from '../lib/api_server.js';

// ─── Fake wasm host ───────────────────────────────────────────────────
// PatternMixer talks to the WASM rendering layer through a tiny surface:
//   - renderAll6ch(handle, buffer)  → paint pattern into buffer
//   - renderBlend6ch(handle, n, bg, fg, fader) → return blended buffer
//   - getBlendHandle is bypassed here because we never have a real
//     blend script on disk. We pre-seed the mixer's blendHandles map so
//     getBlendHandle never tries to compile.
//
// `handle` is just our marker — we cast it to the per-channel painter
// function so renderAll6ch knows what color to fill.
function makeFakeWasmHost() {
  return {
    renderAll6ch(handle, buffer) {
      // handle is { fillFn(buffer) }
      if (typeof handle?.fillFn === 'function') handle.fillFn(buffer);
    },
    // "normal" blend, fader-weighted lerp(bg, fg). Mirrors the host-side
    // fallback in pattern_mixer so any test that depends on a blend
    // result gets predictable bytes.
    renderBlend6ch(blendHandle, n, bg, fg, fader) {
      const out = new Uint8Array(bg.length);
      for (let i = 0; i < bg.length; i++) {
        out[i] = Math.round(bg[i] + (fg[i] - bg[i]) * fader);
      }
      return out;
    },
    beginFrame() {},
    setControl() {},
    destroy() {},
    getExports() { return []; },
    setCoords() {},
    setPixelMeta() {},
    compile() { return { ok: true, handle: { fillFn: () => {} } }; },
  };
}

// Pixel-fill helper. Writes (r,g,b,w,a,u) at index i.
function setPixel(buffer, i, r, g, b, w = 0, a = 0, u = 0) {
  const o = i * 6;
  buffer[o + 0] = r;
  buffer[o + 1] = g;
  buffer[o + 2] = b;
  buffer[o + 3] = w;
  buffer[o + 4] = a;
  buffer[o + 5] = u;
}

// Build a small test model: 4 pixels split across 2 groups so we can
// test mask = "group=Wall" (pixels 0,1) vs "everything" (pixels 2,3).
function makeTestPixels() {
  return [
    { i: 0, group: 'Wall',  sId: 1, fId: 10, vMask: 0b001 },
    { i: 1, group: 'Wall',  sId: 1, fId: 11, vMask: 0b010 },
    { i: 2, group: 'Floor', sId: 2, fId: 12, vMask: 0b001 },
    { i: 3, group: 'Floor', sId: 2, fId: 13, vMask: 0b100 },
  ];
}

// Build a mixer with a red deck channel, a red first mixer overlay
// (background), and a blue second mixer overlay (whose mask is set
// per-test). See the architecture note at the top of the file.
function makeMixerWithRedBase(maxChannels = 3) {
  const wasmHost = makeFakeWasmHost();
  const pixels = makeTestPixels();
  const mixer = new PatternMixer({ wasmHost, pixelCount: 4, maxChannels, pixels });

  // Pre-register a blend handle (any truthy object) so getBlendHandle
  // returns it without trying to read from disk. The fake
  // renderBlend6ch ignores the handle anyway.
  mixer.blendHandles['blend_screen'] = { fake: true };
  mixer.blendHandles['blend_normal'] = { fake: true };

  const redPainter = {
    fillFn: (buf) => { for (let i = 0; i < 4; i++) setPixel(buf, i, 255, 0, 0); },
  };
  const blueOverlay = {
    fillFn: (buf) => { for (let i = 0; i < 4; i++) setPixel(buf, i, 0, 0, 255); },
  };
  // Deck slot — drives deckBuffer for viewFader=0 / PFL tests.
  mixer.setDeckChannel({
    id: 'ch_deck', name: 'Deck', pattern: 'red',
    handle: redPainter, mode: 'blend_screen', fader: 1.0, enabled: true,
  });
  // First mixer overlay — the background wash (legacy "base") that
  // seeds mixerBuffer so masked overlays have something to preserve.
  mixer.addMixerChannel({
    id: 'ch_base', name: 'Base', pattern: 'red',
    handle: redPainter, mode: 'blend_screen', fader: 1.0, enabled: true,
  });
  // Masked overlay under test.
  mixer.addMixerChannel({
    id: 'ch_overlay', name: 'Blue', pattern: 'blue',
    handle: blueOverlay, mode: 'blend_screen', fader: 1.0, enabled: true,
  });
  return { mixer, pixels };
}

// ─── compileViewSelectionMask: the pure pixel-mapping unit ────────────

test('compileViewSelectionMask: type=all returns null (fast path)', () => {
  const pixels = makeTestPixels();
  const m = compileViewSelectionMask({ pixels, pixelCount: 4, viewSelection: { type: 'all', target: null } });
  assert.equal(m, null);
});

test('compileViewSelectionMask: type=group matches by px.group', () => {
  const pixels = makeTestPixels();
  const m = compileViewSelectionMask({ pixels, pixelCount: 4, viewSelection: { type: 'group', target: 'Wall' } });
  assert.deepEqual(Array.from(m), [1, 1, 0, 0]);
});

test('compileViewSelectionMask: invert flips the mask', () => {
  const pixels = makeTestPixels();
  const m = compileViewSelectionMask({ pixels, pixelCount: 4, viewSelection: { type: 'group', target: 'Wall', invert: true } });
  assert.deepEqual(Array.from(m), [0, 0, 1, 1]);
});

test('compileViewSelectionMask: type=section honors px.sId (and sectionId fallback)', () => {
  const pixels = makeTestPixels();
  const m = compileViewSelectionMask({ pixels, pixelCount: 4, viewSelection: { type: 'section', target: 2 } });
  assert.deepEqual(Array.from(m), [0, 0, 1, 1]);
});

test('compileViewSelectionMask: type=fixture honors px.fId', () => {
  const pixels = makeTestPixels();
  const m = compileViewSelectionMask({ pixels, pixelCount: 4, viewSelection: { type: 'fixture', target: 11 } });
  assert.deepEqual(Array.from(m), [0, 1, 0, 0]);
});

test('compileViewSelectionMask: type=viewMask matches any overlapping bit (integer target legacy path)', () => {
  const pixels = makeTestPixels();
  // mask 0b001 matches pixels 0 (vMask=0b001) and 2 (vMask=0b001)
  const m = compileViewSelectionMask({ pixels, pixelCount: 4, viewSelection: { type: 'viewMask', target: 0b001 } });
  assert.deepEqual(Array.from(m), [1, 0, 1, 0]);
});

test('compileViewSelectionMask: type=viewMask resolves string target via viewMasks dictionary', () => {
  const pixels = makeTestPixels();
  // Named "Power" → bit 0b010. Only pixel 1 has vMask=0b010 in
  // makeTestPixels(), so the mask must be [0,1,0,0].
  const viewMasks = [
    { name: 'Power', bit: 0b010 },
    { name: 'Aux',   bit: 0b100 },
  ];
  const m = compileViewSelectionMask({
    pixels, pixelCount: 4,
    viewSelection: { type: 'viewMask', target: 'Power' },
    viewMasks,
  });
  assert.deepEqual(Array.from(m), [0, 1, 0, 0]);
});

test('compileViewSelectionMask: type=viewMask string + invert flips the mask', () => {
  const pixels = makeTestPixels();
  const viewMasks = [{ name: 'Power', bit: 0b010 }];
  const m = compileViewSelectionMask({
    pixels, pixelCount: 4,
    viewSelection: { type: 'viewMask', target: 'Power', invert: true },
    viewMasks,
  });
  // Complement of [0,1,0,0] = [1,0,1,1].
  assert.deepEqual(Array.from(m), [1, 0, 1, 1]);
});

test('compileViewSelectionMask: unknown viewMask name selects NO pixels (loud nothing, not silent all)', () => {
  const pixels = makeTestPixels();
  const viewMasks = [{ name: 'Power', bit: 0b010 }];
  // We expect a warn message but no throw; the returned mask is all-zero
  // so the operator sees the bad name as "nothing selected" rather than
  // accidentally turning a typo into a full-rig overlay.
  const m = compileViewSelectionMask({
    pixels, pixelCount: 4,
    viewSelection: { type: 'viewMask', target: 'NoSuchMask' },
    viewMasks,
  });
  assert.deepEqual(Array.from(m), [0, 0, 0, 0]);
});

test('compileViewSelectionMask: viewMask without dictionary AND string target → no pixels', () => {
  const pixels = makeTestPixels();
  const m = compileViewSelectionMask({
    pixels, pixelCount: 4,
    viewSelection: { type: 'viewMask', target: 'Power' },
    // No viewMasks dictionary supplied — equivalent to a model that
    // never declared any named presets.
  });
  assert.deepEqual(Array.from(m), [0, 0, 0, 0]);
});

// ─── validateViewSelection: API-facing schema gate ────────────────────

test('validateViewSelection: null/undefined → ALL default', () => {
  const a = validateViewSelection(null);
  const b = validateViewSelection(undefined);
  assert.equal(a.ok, true);
  assert.equal(a.value.type, 'all');
  assert.equal(b.ok, true);
});

test('validateViewSelection: rejects non-object', () => {
  for (const bad of ['hello', 42, [], true]) {
    const r = validateViewSelection(bad);
    assert.equal(r.ok, false, `expected reject for ${JSON.stringify(bad)}`);
  }
});

test('validateViewSelection: type=all requires no target', () => {
  assert.equal(validateViewSelection({ type: 'all', target: null }).ok, true);
  assert.equal(validateViewSelection({ type: 'all', target: 'oops' }).ok, false);
});

test('validateViewSelection: type=group requires non-empty string target', () => {
  assert.equal(validateViewSelection({ type: 'group', target: 'Wall' }).ok, true);
  assert.equal(validateViewSelection({ type: 'group', target: '' }).ok, false);
  assert.equal(validateViewSelection({ type: 'group', target: 42 }).ok, false);
});

test('validateViewSelection: type=section requires integer target', () => {
  assert.equal(validateViewSelection({ type: 'section', target: 1 }).ok, true);
  assert.equal(validateViewSelection({ type: 'section', target: '1' }).ok, false);
  assert.equal(validateViewSelection({ type: 'section', target: 1.5 }).ok, false);
});

test('validateViewSelection: type=fixture requires integer target', () => {
  assert.equal(validateViewSelection({ type: 'fixture', target: 10 }).ok, true);
  assert.equal(validateViewSelection({ type: 'fixture', target: 'x' }).ok, false);
});

test('validateViewSelection: type=viewMask accepts positive integer target (legacy bitmask)', () => {
  assert.equal(validateViewSelection({ type: 'viewMask', target: 1 }).ok, true);
  assert.equal(validateViewSelection({ type: 'viewMask', target: 0 }).ok, false);
  assert.equal(validateViewSelection({ type: 'viewMask', target: -1 }).ok, false);
  assert.equal(validateViewSelection({ type: 'viewMask', target: 1.5 }).ok, false);
});

test('validateViewSelection: type=viewMask accepts non-empty string target (named preset)', () => {
  // String name → resolved against the model's viewMasks dictionary at
  // compile time. We don't validate the name's existence here (the API
  // doesn't know about model state); compileViewSelectionMask logs and
  // returns an all-zero mask if it can't resolve.
  const r = validateViewSelection({ type: 'viewMask', target: 'MainShow' });
  assert.equal(r.ok, true);
  assert.equal(r.value.type, 'viewMask');
  assert.equal(r.value.target, 'MainShow');
  // Empty string is rejected (would be useless and indistinguishable
  // from a missing target).
  assert.equal(validateViewSelection({ type: 'viewMask', target: '' }).ok, false);
});

test('validateViewSelection: rejects unknown type', () => {
  assert.equal(validateViewSelection({ type: 'roomBitmap', target: 1 }).ok, false);
});

// ─── PatternMixer: pixel-alignment guard ──────────────────────────────

test('PatternMixer: throws on misaligned pixel indices', () => {
  const wasmHost = makeFakeWasmHost();
  const pixels = makeTestPixels();
  // Sabotage the alignment: pixel at index 2 claims index 99.
  pixels[2].i = 99;
  assert.throws(
    () => new PatternMixer({ wasmHost, pixelCount: 4, pixels }),
    /index alignment corrupted/
  );
});

test('PatternMixer: throws on pixel/pixelCount mismatch', () => {
  const wasmHost = makeFakeWasmHost();
  assert.throws(
    () => new PatternMixer({ wasmHost, pixelCount: 100, pixels: makeTestPixels() }),
    /must match pixelCount/
  );
});

// ─── PatternMixer: default startup state ──────────────────────────────

test('PatternMixer: default viewFader is 1.0 (mixer output by default)', () => {
  const wasmHost = makeFakeWasmHost();
  const mixer = new PatternMixer({ wasmHost, pixelCount: 4, pixels: makeTestPixels() });
  assert.equal(mixer.viewFader, 1.0);
  assert.equal(mixer.targetViewFader, 1.0);
});

// ─── PatternMixer: crossfade arithmetic ───────────────────────────────

test('renderAll6ch: viewFader=1 emits mixerBuffer (red base + blue overlay = blue)', () => {
  const { mixer } = makeMixerWithRedBase();
  mixer.viewFader = 1.0; mixer.targetViewFader = 1.0;
  const out = mixer.renderAll6ch();
  // blend_screen via the fake just lerps with fader=1.0 → fg wins → blue
  for (let i = 0; i < 4; i++) {
    assert.equal(out[i * 6 + 0], 0, `pixel ${i} R should be 0`);
    assert.equal(out[i * 6 + 2], 255, `pixel ${i} B should be 255`);
  }
});

test('renderAll6ch: viewFader=0 emits deckBuffer (= base channel PFL)', () => {
  const { mixer } = makeMixerWithRedBase();
  mixer.viewFader = 0.0; mixer.targetViewFader = 0.0;
  const out = mixer.renderAll6ch();
  // Deck PFL shows the base channel at full strength: red.
  for (let i = 0; i < 4; i++) {
    assert.equal(out[i * 6 + 0], 255, `pixel ${i} R should be 255`);
    assert.equal(out[i * 6 + 2], 0, `pixel ${i} B should be 0`);
  }
});

test('renderAll6ch: viewFader=0.5 is a linear crossfade between deck and mixer', () => {
  const { mixer } = makeMixerWithRedBase();
  mixer.viewFader = 0.5; mixer.targetViewFader = 0.5;
  const out = mixer.renderAll6ch();
  // deck=red(255,0,0), mixer=blue(0,0,255). 0.5 mix → (128, 0, 128) by
  // rounding. Tolerate ±1 for rounding.
  for (let i = 0; i < 4; i++) {
    const r = out[i * 6 + 0];
    const b = out[i * 6 + 2];
    assert.ok(Math.abs(r - 128) <= 1, `pixel ${i} R near 128 (got ${r})`);
    assert.ok(Math.abs(b - 128) <= 1, `pixel ${i} B near 128 (got ${b})`);
  }
});

// ─── PatternMixer: base-channel seeding of mixerBuffer ────────────────

test('renderAll6ch: base channel SEEDS mixerBuffer (background stacking)', () => {
  const { mixer } = makeMixerWithRedBase();
  // Remove the overlay so the only contribution to mixerBuffer is the
  // base channel seeding. Pre-mask change this would have been black.
  mixer.removeChannel('ch_overlay');
  mixer.viewFader = 1.0; mixer.targetViewFader = 1.0;
  const out = mixer.renderAll6ch();
  for (let i = 0; i < 4; i++) {
    assert.equal(out[i * 6 + 0], 255, `pixel ${i} R should be 255 (base seeded)`);
  }
});

test('renderAll6ch: muted base channel does NOT seed mixerBuffer', () => {
  const { mixer } = makeMixerWithRedBase();
  mixer.removeChannel('ch_overlay');
  const base = mixer.getChannel('ch_base');
  base.enabled = false; // muted
  mixer.viewFader = 1.0; mixer.targetViewFader = 1.0;
  const out = mixer.renderAll6ch();
  for (let i = 0; i < 4; i++) {
    assert.equal(out[i * 6 + 0], 0, `pixel ${i} R should be 0 (base muted)`);
    assert.equal(out[i * 6 + 1], 0, `pixel ${i} G should be 0`);
    assert.equal(out[i * 6 + 2], 0, `pixel ${i} B should be 0`);
  }
});

test('renderAll6ch: base channel at fader=0 does NOT seed', () => {
  const { mixer } = makeMixerWithRedBase();
  mixer.removeChannel('ch_overlay');
  mixer.getChannel('ch_base').fader = 0;
  mixer.viewFader = 1.0; mixer.targetViewFader = 1.0;
  const out = mixer.renderAll6ch();
  for (let i = 0; i < 4; i++) {
    assert.equal(out[i * 6 + 0], 0);
  }
});

// ─── PatternMixer: per-layer view-selection masking ───────────────────

test('renderAll6ch: overlay masked to "Wall" only paints the wall pixels', () => {
  const { mixer } = makeMixerWithRedBase();
  // Restrict overlay to "Wall" (pixels 0, 1). Pixels 2, 3 must keep the
  // red background (NOT go black, NOT go blue).
  mixer.setChannelViewSelection('ch_overlay', { type: 'group', target: 'Wall' });
  mixer.viewFader = 1.0; mixer.targetViewFader = 1.0;
  const out = mixer.renderAll6ch();
  // Pixels 0, 1: blue overlay wins.
  for (const i of [0, 1]) {
    assert.equal(out[i * 6 + 0], 0,  `pixel ${i} R should be 0 (overlay won)`);
    assert.equal(out[i * 6 + 2], 255, `pixel ${i} B should be 255`);
  }
  // Pixels 2, 3: red base preserved.
  for (const i of [2, 3]) {
    assert.equal(out[i * 6 + 0], 255, `pixel ${i} R should be 255 (base preserved)`);
    assert.equal(out[i * 6 + 2], 0,   `pixel ${i} B should be 0`);
  }
});

test('renderAll6ch: overlay masked to a NAMED viewMask only paints those pixels', () => {
  // End-to-end: PatternMixer constructed with a viewMasks dictionary,
  // overlay's viewSelection set to a named viewMask, then the render
  // loop must honour the resolved bit. This is the load-bearing
  // assertion for the "operator picks 'MainShow' in the dropdown"
  // path — if compileViewSelectionMask, the constructor, and
  // recompileChannelMask aren't all wired through, this test fails.
  const wasmHost = makeFakeWasmHost();
  const pixels = makeTestPixels();
  // 'Wall' bit = 0b001 → matches pixels with vMask=0b001 (px 0, px 2).
  const viewMasks = [
    { name: 'Wall',  bit: 0b001 },
    { name: 'Power', bit: 0b010 },
  ];
  const mixer = new PatternMixer({ wasmHost, pixelCount: 4, maxChannels: 3, pixels, viewMasks });
  mixer.blendHandles['blend_screen'] = { fake: true };
  mixer.blendHandles['blend_normal'] = { fake: true };
  const redPainter  = { fillFn: (buf) => { for (let i = 0; i < 4; i++) setPixel(buf, i, 255, 0, 0); } };
  const blueOverlay = { fillFn: (buf) => { for (let i = 0; i < 4; i++) setPixel(buf, i, 0, 0, 255); } };
  mixer.setDeckChannel({
    id: 'ch_deck', name: 'Deck', pattern: 'red',
    handle: redPainter, mode: 'blend_screen', fader: 1.0, enabled: true,
  });
  mixer.addMixerChannel({
    id: 'ch_base', name: 'Base', pattern: 'red',
    handle: redPainter, mode: 'blend_screen', fader: 1.0, enabled: true,
  });
  mixer.addMixerChannel({
    id: 'ch_overlay', name: 'Blue', pattern: 'blue',
    handle: blueOverlay, mode: 'blend_screen', fader: 1.0, enabled: true,
  });
  // The whole point of this test: a string viewMask target threaded
  // through the public PatternMixer API.
  mixer.setChannelViewSelection('ch_overlay', { type: 'viewMask', target: 'Wall' });
  mixer.viewFader = 1.0; mixer.targetViewFader = 1.0;
  const out = mixer.renderAll6ch();
  // Pixels 0, 2 carry vMask=0b001 → overlay wins → blue.
  for (const i of [0, 2]) {
    assert.equal(out[i * 6 + 0], 0,   `pixel ${i} R should be 0 (overlay won)`);
    assert.equal(out[i * 6 + 2], 255, `pixel ${i} B should be 255`);
  }
  // Pixels 1, 3 carry vMask=0b010 / 0b100 → no match → background red.
  for (const i of [1, 3]) {
    assert.equal(out[i * 6 + 0], 255, `pixel ${i} R should be 255 (base preserved)`);
    assert.equal(out[i * 6 + 2], 0,   `pixel ${i} B should be 0`);
  }
});

test('renderAll6ch: overlay with invert mask paints the COMPLEMENT', () => {
  const { mixer } = makeMixerWithRedBase();
  mixer.setChannelViewSelection('ch_overlay', { type: 'group', target: 'Wall', invert: true });
  mixer.viewFader = 1.0; mixer.targetViewFader = 1.0;
  const out = mixer.renderAll6ch();
  // Now pixels 2,3 should be blue, pixels 0,1 stay red.
  for (const i of [0, 1]) {
    assert.equal(out[i * 6 + 0], 255);
  }
  for (const i of [2, 3]) {
    assert.equal(out[i * 6 + 2], 255);
  }
});

// ─── PatternMixer: PFL / deck blackout for unselected pixels ──────────

test('renderAll6ch: PFL blackout zeroes unselected pixels in deck output', () => {
  const { mixer } = makeMixerWithRedBase();
  // Force the deck to focus on the overlay (so we see the overlay's
  // mask in the PFL view).
  mixer.deckFocusChannelId = 'ch_overlay';
  mixer.setChannelViewSelection('ch_overlay', { type: 'group', target: 'Wall' });
  mixer.viewFader = 0.0; mixer.targetViewFader = 0.0; // emit deckBuffer
  const out = mixer.renderAll6ch();
  // Wall pixels = blue (overlay full strength).
  for (const i of [0, 1]) {
    assert.equal(out[i * 6 + 2], 255);
  }
  // Non-wall pixels = BLACK in PFL (not red — deck doesn't see the base).
  for (const i of [2, 3]) {
    assert.equal(out[i * 6 + 0], 0);
    assert.equal(out[i * 6 + 1], 0);
    assert.equal(out[i * 6 + 2], 0);
  }
});

test('renderAll6ch: PFL blackout does NOT affect mixerBuffer (background preserved)', () => {
  // Companion to the previous test. Mix output (viewFader=1) must NOT
  // be black in the masked region — it must show the red background.
  const { mixer } = makeMixerWithRedBase();
  mixer.deckFocusChannelId = 'ch_overlay';
  mixer.setChannelViewSelection('ch_overlay', { type: 'group', target: 'Wall' });
  mixer.viewFader = 1.0; mixer.targetViewFader = 1.0;
  const out = mixer.renderAll6ch();
  // Non-wall pixels = red (base preserved by mask logic, NOT black).
  for (const i of [2, 3]) {
    assert.equal(out[i * 6 + 0], 255);
  }
});
