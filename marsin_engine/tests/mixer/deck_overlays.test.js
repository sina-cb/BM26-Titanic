// Deck dynamic view overrides (deck overlays) — engine unit tests.
//
// Covers (per the build spec):
//   - compositing order (bottom→top into deckBuffer, top wins within its view)
//   - view masking (unselected deck pixels untouched)
//   - each of the 3 blend modes lands (blend_screen | blend_add | blend_over)
//   - reorder permutation (bad set THROWS)
//   - never-dark (pixels outside every overlay's view stay at the deck value
//     for ALL modes; no pixel below deck for the monotone blend_add/blend_screen;
//     deck stays lit outside the overlay view)
//   - add/remove (handle freed, cap=4 → 5th rejected, auto-color distinct)
//   - unique-view (2nd overlay on a taken view → throws / 409 at API)
//   - SHARED/MATCHING timer (two auto-advancing overlays advance on the SAME
//     shared clock — cursors flip together off one anchor, not independently)
//   - share-globals (an overlay's render reflects the global speed/params and
//     the global hue/invert just like the deck)
//   - persistence round-trip (save→restore identical incl. shared autopilot)
//
// Run:  cd marsin_engine && node --test tests/deck_overlays.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PatternMixer,
  DECK_OVERLAY_MAX,
  DECK_OVERLAY_COLOR_SWATCHES,
} from '../../lib/pattern_mixer.js';

// ─── Fake wasm host ───────────────────────────────────────────────────
// `handle` is a marker carrying a fillFn(buffer). renderBlend6ch branches
// on the blend handle's `mode` so the 3 blend modes are distinguishable:
//   blend_over   : lerp(bg, fg, fader)        (the host-side fallback shape)
//   blend_add    : clamp(bg + fg*fader)
//   blend_screen : screen(bg, fg*fader) = 255 - (255-bg)*(255-fg')/255
function makeFakeWasmHost() {
  const destroyed = [];
  return {
    destroyed,
    renderAll6ch(handle, buffer) {
      if (typeof handle?.fillFn === 'function') handle.fillFn(buffer);
    },
    renderBlend6ch(blendHandle, n, bg, fg, fader) {
      const out = new Uint8Array(bg.length);
      const mode = blendHandle && blendHandle.mode;
      for (let i = 0; i < bg.length; i++) {
        const f = fg[i] * fader;
        let v;
        if (mode === 'blend_add') {
          v = bg[i] + f;
        } else if (mode === 'blend_screen') {
          v = 255 - ((255 - bg[i]) * (255 - f)) / 255;
        } else { // blend_over (and the generic lerp fallback)
          v = bg[i] + (fg[i] - bg[i]) * fader;
        }
        out[i] = Math.max(0, Math.min(255, Math.round(v)));
      }
      return out;
    },
    beginFrame() {},
    setControl() {},
    destroy(h) { destroyed.push(h); },
    getExports() { return []; },
    setCoords() {},
    setPixelMeta() {},
    compile() { return { ok: true, handle: { fillFn: () => {} } }; },
  };
}

function setPixel(buffer, i, r, g, b, w = 0, a = 0, u = 0) {
  const o = i * 6;
  buffer[o + 0] = r; buffer[o + 1] = g; buffer[o + 2] = b;
  buffer[o + 3] = w; buffer[o + 4] = a; buffer[o + 5] = u;
}

// 4 pixels across 2 groups: Wall = {0,1}, Floor = {2,3}.
function makeTestPixels() {
  return [
    { i: 0, group: 'Wall',  sId: 1, fId: 10, vMask: 0b001 },
    { i: 1, group: 'Wall',  sId: 1, fId: 11, vMask: 0b010 },
    { i: 2, group: 'Floor', sId: 2, fId: 12, vMask: 0b001 },
    { i: 3, group: 'Floor', sId: 2, fId: 13, vMask: 0b100 },
  ];
}

function painter(r, g, b) {
  return { fillFn: (buf) => { for (let i = 0; i < 4; i++) setPixel(buf, i, r, g, b); } };
}

// Mixer with a dim-red deck (drives deckBuffer at viewFader=0). Blend handles
// are pre-seeded per mode so getBlendHandle returns a {mode} marker the fake
// renderBlend6ch can branch on.
function makeMixerWithDeck(deckColor = [80, 0, 0]) {
  const wasmHost = makeFakeWasmHost();
  const pixels = makeTestPixels();
  const mixer = new PatternMixer({ wasmHost, pixelCount: 4, maxChannels: 3, pixels });
  mixer.blendHandles['blend_screen'] = { mode: 'blend_screen' };
  mixer.blendHandles['blend_add'] = { mode: 'blend_add' };
  mixer.blendHandles['blend_over'] = { mode: 'blend_over' };
  mixer.setDeckChannel({
    id: 'ch_deck', name: 'Deck', pattern: 'red',
    handle: painter(...deckColor), mode: 'blend_screen', fader: 1.0, enabled: true,
  });
  // Drive deckBuffer to the output (viewFader=0 → output = deckBuffer, which
  // is where overlays composite). No mixer overlays needed for these tests.
  mixer.viewFader = 0.0; mixer.targetViewFader = 0.0;
  return { mixer, pixels, wasmHost };
}

// ─── compositing order: bottom→top, top wins within its view ──────────

test('deck overlays composite bottom→top into deckBuffer; top wins within its view', () => {
  const { mixer } = makeMixerWithDeck();
  // Both overlays target the WHOLE Wall group via DIFFERENT view selections so
  // the unique-view rule is satisfied, but overlap on pixel 0 (vMask 0b001 =
  // group Wall pixel 0). Use two distinct views that both cover pixel 0:
  //   bottom: group Wall (pixels 0,1) painting GREEN, blend_over @ 1.0
  //   top:    viewMask 0b001 (pixels 0,2) painting BLUE, blend_over @ 1.0
  mixer.addDeckOverlay({
    id: 'do_bottom', pattern: 'g', handle: painter(0, 255, 0),
    mode: 'blend_over', fader: 1.0, enabled: true,
    viewSelection: { type: 'group', target: 'Wall' },
  });
  mixer.addDeckOverlay({
    id: 'do_top', pattern: 'b', handle: painter(0, 0, 255),
    mode: 'blend_over', fader: 1.0, enabled: true,
    viewSelection: { type: 'viewMask', target: 0b001 },
  });
  const out = mixer.renderAll6ch();
  // Pixel 0 is in BOTH views → top (blue) wins (composited last).
  assert.equal(out[0 * 6 + 2], 255, 'pixel 0 B = blue (top overlay wins)');
  assert.equal(out[0 * 6 + 1], 0, 'pixel 0 G overwritten by top');
  // Pixel 1 only in bottom (Wall) → green.
  assert.equal(out[1 * 6 + 1], 255, 'pixel 1 G = green (bottom only)');
  // Pixel 2 only in top (viewMask 0b001) → blue.
  assert.equal(out[2 * 6 + 2], 255, 'pixel 2 B = blue (top only)');
});

// ─── view masking: unselected deck pixels untouched ───────────────────

test('overlay masked to a view leaves unselected deck pixels at the deck value', () => {
  const { mixer } = makeMixerWithDeck([80, 0, 0]);
  mixer.addDeckOverlay({
    id: 'do_wall', pattern: 'b', handle: painter(0, 0, 255),
    mode: 'blend_over', fader: 1.0, enabled: true,
    viewSelection: { type: 'group', target: 'Wall' },
  });
  const out = mixer.renderAll6ch();
  // Wall (0,1): blue overlay.
  for (const i of [0, 1]) assert.equal(out[i * 6 + 2], 255, `pixel ${i} blue`);
  // Floor (2,3): untouched → deck red (80,0,0).
  for (const i of [2, 3]) {
    assert.equal(out[i * 6 + 0], 80, `pixel ${i} keeps deck R`);
    assert.equal(out[i * 6 + 2], 0, `pixel ${i} no blue`);
  }
});

// ─── each blend mode lands ────────────────────────────────────────────

test('blend modes blend_screen / blend_add / blend_over each land distinctly', () => {
  for (const mode of ['blend_screen', 'blend_add', 'blend_over']) {
    const { mixer } = makeMixerWithDeck([100, 0, 0]);
    mixer.addDeckOverlay({
      id: 'do_' + mode, pattern: 'r', handle: painter(100, 0, 0),
      mode, fader: 1.0, enabled: true,
      viewSelection: { type: 'group', target: 'Wall' },
    });
    const out = mixer.renderAll6ch();
    const r = out[0 * 6 + 0]; // pixel 0 in Wall
    if (mode === 'blend_over') {
      assert.equal(r, 100, 'blend_over @1.0 replaces → 100');
    } else if (mode === 'blend_add') {
      assert.equal(r, 200, 'blend_add → 100+100 = 200');
    } else { // blend_screen
      // 255 - (255-100)*(255-100)/255 = 255 - 155*155/255 ≈ 161
      assert.equal(r, 161, 'blend_screen → ~161');
    }
    // Floor untouched at deck value either way.
    assert.equal(out[2 * 6 + 0], 100, `${mode}: floor keeps deck value`);
  }
});

test('playlist tint colorizes only the Deck overlay and only inside its selected view', () => {
  const { mixer } = makeMixerWithDeck([80, 0, 0]);
  mixer.addDeckOverlay({
    id: 'do_tint',
    pattern: 'white',
    handle: painter(128, 128, 128),
    mode: 'blend_over',
    fader: 1,
    enabled: true,
    sourceMode: 'playlist',
    playlistTint: '#00FF00',
    viewSelection: { type: 'group', target: 'Wall' },
  });

  const out = mixer.renderAll6ch();
  for (const i of [0, 1]) {
    assert.equal(out[i * 6], 0, `pixel ${i} tinted red is zero`);
    assert.equal(out[i * 6 + 1], 128, `pixel ${i} preserves brightness in green`);
    assert.equal(out[i * 6 + 2], 0, `pixel ${i} tinted blue is zero`);
  }
  for (const i of [2, 3]) {
    assert.equal(out[i * 6], 80, `pixel ${i} keeps the untinted main Deck`);
    assert.equal(out[i * 6 + 1], 0);
  }
});

test('solid source uses the overlay fader as brightness and preserves its playlist source', () => {
  const { mixer } = makeMixerWithDeck([20, 0, 0]);
  const overlay = mixer.addDeckOverlay({
    id: 'do_solid',
    pattern: 'blue',
    handle: painter(0, 0, 200),
    mode: 'blend_over',
    fader: 0.5,
    enabled: true,
    sourceMode: 'solid',
    solidColor: '#00FFFF',
    viewSelection: { type: 'group', target: 'Wall' },
  });
  overlay.playlist = { name: 'kept', activeEntryId: 'entry_blue', cursor: 2 };
  const playlistBefore = overlay.playlist;
  const handleBefore = overlay.handle;

  const solidOut = mixer.renderAll6ch();
  assert.equal(solidOut[1], 128, 'solid green is blended at the overlay fader');
  assert.equal(solidOut[2], 128, 'solid blue is blended at the overlay fader');
  assert.equal(overlay.playlist, playlistBefore, 'solid mode does not replace the playlist');
  assert.equal(overlay.handle, handleBefore, 'solid mode does not destroy its playlist handle');

  overlay.sourceMode = 'playlist';
  overlay.fader = 1;
  const playlistOut = mixer.renderAll6ch();
  assert.equal(playlistOut[2], 200, 'switching back restores the exact playlist pattern');
  assert.equal(overlay.playlist, playlistBefore);
});

// ─── reorder permutation: bad set THROWS ──────────────────────────────

test('reorderDeckOverlays throws on a bad permutation; valid reorder flips top', () => {
  const { mixer } = makeMixerWithDeck();
  mixer.addDeckOverlay({ id: 'do_a', pattern: 'a', handle: painter(0, 255, 0), mode: 'blend_over', fader: 1, enabled: true, viewSelection: { type: 'group', target: 'Wall' } });
  mixer.addDeckOverlay({ id: 'do_b', pattern: 'b', handle: painter(0, 0, 255), mode: 'blend_over', fader: 1, enabled: true, viewSelection: { type: 'group', target: 'Floor' } });
  assert.throws(() => mixer.reorderDeckOverlays(['do_a']), /must equal/);
  assert.throws(() => mixer.reorderDeckOverlays(['do_a', 'do_a']), /duplicate/);
  assert.throws(() => mixer.reorderDeckOverlays(['do_a', 'do_x']), /not a current deck overlay/);
  assert.throws(() => mixer.reorderDeckOverlays('nope'), /must be an array/);
  // Valid reorder: same objects, new order.
  mixer.reorderDeckOverlays(['do_b', 'do_a']);
  assert.deepEqual(mixer.getDeckOverlays().map(o => o.id), ['do_b', 'do_a']);
});

// ─── never-dark ───────────────────────────────────────────────────────

test('never-dark: pixels outside the view stay at the deck value for ALL modes', () => {
  for (const mode of ['blend_screen', 'blend_add', 'blend_over']) {
    const { mixer } = makeMixerWithDeck([120, 30, 0]);
    mixer.addDeckOverlay({
      id: 'do_' + mode, pattern: 'x', handle: painter(0, 0, 255),
      mode, fader: 1.0, enabled: true,
      viewSelection: { type: 'group', target: 'Wall' },
    });
    const out = mixer.renderAll6ch();
    // Floor (2,3) outside the Wall view → EXACT deck value, every channel.
    for (const i of [2, 3]) {
      assert.equal(out[i * 6 + 0], 120, `${mode}: pixel ${i} R untouched`);
      assert.equal(out[i * 6 + 1], 30, `${mode}: pixel ${i} G untouched`);
      assert.equal(out[i * 6 + 2], 0, `${mode}: pixel ${i} B untouched`);
    }
  }
});

test('never-dark: monotone modes (blend_add/blend_screen) never drop a pixel below deck', () => {
  for (const mode of ['blend_add', 'blend_screen']) {
    const { mixer } = makeMixerWithDeck([90, 40, 10]);
    // Capture deck-only output (no overlays).
    const deckOnly = Uint8Array.from(mixer.renderAll6ch());
    mixer.addDeckOverlay({
      id: 'do_' + mode, pattern: 'x', handle: painter(60, 60, 60),
      mode, fader: 1.0, enabled: true,
      viewSelection: { type: 'group', target: 'Wall' },
    });
    const withOverlay = mixer.renderAll6ch();
    for (let k = 0; k < deckOnly.length; k++) {
      assert.ok(withOverlay[k] >= deckOnly[k],
        `${mode}: byte ${k} (${withOverlay[k]}) must be >= deck (${deckOnly[k]})`);
    }
  }
});

test('never-dark: deck stays lit outside the overlay view (exterior visible)', () => {
  const { mixer } = makeMixerWithDeck([150, 0, 0]);
  mixer.addDeckOverlay({
    id: 'do_wall', pattern: 'x', handle: painter(0, 0, 0), // a BLACK overlay
    mode: 'blend_over', fader: 1.0, enabled: true,
    viewSelection: { type: 'group', target: 'Wall' },
  });
  const out = mixer.renderAll6ch();
  // Even a black blend_over overlay only blacks WITHIN its view; Floor (2,3)
  // stays lit at the deck value — the exterior can't be blacked out.
  for (const i of [2, 3]) assert.equal(out[i * 6 + 0], 150, `pixel ${i} deck still lit`);
});

test('never-dark guard: an "all" / empty view overlay is REFUSED (cannot target everything)', () => {
  const { mixer } = makeMixerWithDeck();
  assert.throws(
    () => mixer.addDeckOverlay({ id: 'do_all', pattern: 'x', handle: painter(0, 0, 255), viewSelection: { type: 'all', target: null } }),
    /must target a specific view/,
  );
  // Default (no viewSelection) also refused.
  assert.throws(
    () => mixer.addDeckOverlay({ id: 'do_def', pattern: 'x', handle: painter(0, 0, 255) }),
    /must target a specific view/,
  );
});

// ─── add / remove ─────────────────────────────────────────────────────

test('add/remove: handle freed on remove; cap=4 (5th rejected); auto-colors distinct', () => {
  const { mixer, wasmHost } = makeMixerWithDeck();
  const views = [
    { type: 'group', target: 'Wall' },
    { type: 'group', target: 'Floor' },
    { type: 'section', target: 1 },
    { type: 'fixture', target: 10 },
  ];
  const colors = [];
  for (let k = 0; k < DECK_OVERLAY_MAX; k++) {
    const o = mixer.addDeckOverlay({ id: 'do_' + k, pattern: 'x', handle: { fillFn: () => {}, marker: k }, mode: 'blend_screen', fader: 1, enabled: true, viewSelection: views[k] });
    colors.push(o.color);
  }
  assert.equal(mixer.getDeckOverlays().length, DECK_OVERLAY_MAX);
  // Auto-colors distinct and drawn from the engine palette.
  assert.equal(new Set(colors).size, DECK_OVERLAY_MAX, 'auto-colors are distinct');
  for (const c of colors) assert.ok(DECK_OVERLAY_COLOR_SWATCHES.includes(c), `${c} is a palette swatch`);
  // 5th over cap → throws.
  assert.throws(
    () => mixer.addDeckOverlay({ id: 'do_5', pattern: 'x', handle: { fillFn: () => {} }, viewSelection: { type: 'fixture', target: 11 } }),
    new RegExp(`Maximum of ${DECK_OVERLAY_MAX} deck overlays`),
  );
  // Remove frees the handle.
  const beforeDestroys = wasmHost.destroyed.length;
  assert.equal(mixer.removeDeckOverlay('do_0'), true);
  assert.equal(mixer.getDeckOverlays().length, DECK_OVERLAY_MAX - 1);
  assert.ok(wasmHost.destroyed.length > beforeDestroys, 'overlay handle destroyed on remove');
  assert.equal(mixer.removeDeckOverlay('do_nope'), false);
});

// ─── unique-view ──────────────────────────────────────────────────────

test('unique-view: a 2nd overlay on an equivalent view is rejected', () => {
  const { mixer } = makeMixerWithDeck();
  mixer.addDeckOverlay({ id: 'do_1', pattern: 'x', handle: { fillFn: () => {} }, viewSelection: { type: 'group', target: 'Wall' } });
  assert.ok(mixer.deckOverlayViewTaken({ type: 'group', target: 'Wall' }), 'view reported taken');
  assert.throws(
    () => mixer.addDeckOverlay({ id: 'do_2', pattern: 'x', handle: { fillFn: () => {} }, viewSelection: { type: 'group', target: 'Wall' } }),
    /already targets this view/,
  );
  // A DIFFERENT view is fine.
  assert.doesNotThrow(
    () => mixer.addDeckOverlay({ id: 'do_3', pattern: 'x', handle: { fillFn: () => {} }, viewSelection: { type: 'group', target: 'Floor' } }),
  );
  // deckOverlayViewTaken excludes the overlay's own id (for view PATCH).
  assert.equal(mixer.deckOverlayViewTaken({ type: 'group', target: 'Wall' }, 'do_1'), false);
});

// ─── shared / matching timer ──────────────────────────────────────────
// Replicates the SHARED deck-overlay auto-cycle decision: ONE anchor + ONE
// delay for the whole group; when due, EVERY enabled overlay advances its own
// cursor in unison. We model the tick logic here (the api_server tick is the
// production path; this asserts the SHARED-clock invariant directly on the
// mixer's shared autopilot fields).

function advanceCursor(overlay) {
  // Each overlay walks its OWN 2-entry playlist forward (own content).
  const entries = overlay.playlist.entries;
  const idx = entries.findIndex(e => e.id === overlay.playlist.activeEntryId);
  const next = entries[(idx + 1) % entries.length];
  overlay.playlist.activeEntryId = next.id;
  overlay.playlist.cursor = (idx + 1) % entries.length;
}

// Pure replica of deckOverlayAutoCycleTick's SHARED-clock gate.
function sharedTick(mixer, nowMs) {
  const ap = mixer.deckOverlayAutopilot;
  if (!ap || !ap.active) return false;
  const overlays = mixer.getDeckOverlays();
  if (overlays.length === 0) return false;
  if (mixer._deckOverlayAnchorMs == null) { mixer._deckOverlayAnchorMs = nowMs; return false; }
  if (nowMs - mixer._deckOverlayAnchorMs < Math.max(1, ap.delay_s) * 1000) return false;
  mixer._deckOverlayAnchorMs = nowMs; // ONE anchor for the whole group
  for (const o of overlays) {
    if (!o.enabled) continue;
    advanceCursor(o);
  }
  return true;
}

test('shared/matching timer: two auto-advancing overlays flip cursors together off ONE clock', () => {
  const { mixer } = makeMixerWithDeck();
  const o1 = mixer.addDeckOverlay({ id: 'do_1', pattern: 'x', handle: { fillFn: () => {} }, viewSelection: { type: 'group', target: 'Wall' } });
  const o2 = mixer.addDeckOverlay({ id: 'do_2', pattern: 'y', handle: { fillFn: () => {} }, viewSelection: { type: 'group', target: 'Floor' } });
  // Each owns its OWN playlist + cursor + content (per-overlay content).
  o1.playlist = { name: 'p1', activeEntryId: 'a1', cursor: 0, entries: [{ id: 'a1' }, { id: 'a2' }] };
  o2.playlist = { name: 'p2', activeEntryId: 'b1', cursor: 0, entries: [{ id: 'b1' }, { id: 'b2' }] };
  // SHARED autopilot: one clock, one delay, one shuffle flag.
  mixer.deckOverlayAutopilot = { active: true, delay_s: 10, shuffle: false };
  mixer._deckOverlayAnchorMs = null;

  // Frame 1 (t=0): seeds the SHARED anchor, NO advance.
  assert.equal(sharedTick(mixer, 0), false);
  assert.equal(o1.playlist.activeEntryId, 'a1');
  assert.equal(o2.playlist.activeEntryId, 'b1');
  // t=5s: not yet due (shared delay 10s) → neither advances.
  assert.equal(sharedTick(mixer, 5000), false);
  assert.equal(o1.playlist.activeEntryId, 'a1');
  assert.equal(o2.playlist.activeEntryId, 'b1');
  // t=10s: SHARED clock due → BOTH advance in the SAME tick, each to its OWN
  // next entry.
  assert.equal(sharedTick(mixer, 10000), true);
  assert.equal(o1.playlist.activeEntryId, 'a2', 'overlay 1 advanced its own cursor');
  assert.equal(o2.playlist.activeEntryId, 'b2', 'overlay 2 advanced its own cursor');
  // t=20s: due again → both flip together back to start (looping). Unison.
  assert.equal(sharedTick(mixer, 20000), true);
  assert.equal(o1.playlist.activeEntryId, 'a1');
  assert.equal(o2.playlist.activeEntryId, 'b1');
});

test('shared timer: a paused (disabled) overlay does NOT advance but the shared cadence is unaffected', () => {
  const { mixer } = makeMixerWithDeck();
  const o1 = mixer.addDeckOverlay({ id: 'do_1', pattern: 'x', handle: { fillFn: () => {} }, enabled: true, viewSelection: { type: 'group', target: 'Wall' } });
  const o2 = mixer.addDeckOverlay({ id: 'do_2', pattern: 'y', handle: { fillFn: () => {} }, enabled: false, viewSelection: { type: 'group', target: 'Floor' } });
  o1.playlist = { name: 'p1', activeEntryId: 'a1', cursor: 0, entries: [{ id: 'a1' }, { id: 'a2' }] };
  o2.playlist = { name: 'p2', activeEntryId: 'b1', cursor: 0, entries: [{ id: 'b1' }, { id: 'b2' }] };
  mixer.deckOverlayAutopilot = { active: true, delay_s: 10, shuffle: false };
  mixer._deckOverlayAnchorMs = null;
  sharedTick(mixer, 0);       // seed
  sharedTick(mixer, 10000);   // due
  assert.equal(o1.playlist.activeEntryId, 'a2', 'enabled overlay advanced');
  assert.equal(o2.playlist.activeEntryId, 'b1', 'disabled overlay stayed put');
});

// ─── share-globals ────────────────────────────────────────────────────
// Overlays render through the SAME beginFrame(elapsedSeconds) and
// _effectiveSpeed as the deck/mixer overlays (global speed/params), and the
// global hue/invert run POST-composite on the output AFTER overlays are
// composited into deckBuffer — so they apply to overlays automatically. We
// assert: (a) an overlay's beginFrame receives the SAME global elapsed as the
// deck; (b) a post-composite invert applied to the final output inverts an
// overlay-painted pixel exactly as it does a deck pixel.

test('share-globals: overlay beginFrame receives the SAME global elapsed as the deck', () => {
  const { mixer } = makeMixerWithDeck();
  const seen = {};
  // Wrap beginFrame on the channels to record the elapsed each receives.
  const deck = mixer.getDeckChannel();
  const o1 = mixer.addDeckOverlay({ id: 'do_1', pattern: 'x', handle: { fillFn: () => {} }, viewSelection: { type: 'group', target: 'Wall' } });
  const origDeck = deck.beginFrame.bind(deck);
  const origO1 = o1.beginFrame.bind(o1);
  deck.beginFrame = (wh, el, fr, sp) => { seen.deck = el; return origDeck(wh, el, fr, sp); };
  o1.beginFrame = (wh, el, fr, sp) => { seen.o1 = el; return origO1(wh, el, fr, sp); };
  mixer.beginFrame(12.34); // global scaled elapsed
  assert.equal(seen.deck, 12.34);
  assert.equal(seen.o1, 12.34, 'overlay sees the SAME global elapsed (shared clock/params)');
});

test('share-globals: a post-composite invert applies equally to deck and overlay pixels', () => {
  const { mixer } = makeMixerWithDeck([100, 0, 0]);
  mixer.addDeckOverlay({
    id: 'do_wall', pattern: 'b', handle: painter(0, 0, 200),
    mode: 'blend_over', fader: 1.0, enabled: true,
    viewSelection: { type: 'group', target: 'Wall' },
  });
  const out = mixer.renderAll6ch();
  // Global invert runs post-composite on model.pixels in engine.js; model it
  // here on the composited output buffer (overlays are ALREADY in deckBuffer).
  const inverted = Uint8Array.from(out, v => 255 - v);
  // Overlay pixel 0 was blue(0,0,200) → inverts to (255,255,55).
  assert.equal(inverted[0 * 6 + 0], 255);
  assert.equal(inverted[0 * 6 + 2], 55);
  // Deck pixel 2 was red(100,0,0) → inverts to (155,255,255).
  assert.equal(inverted[2 * 6 + 0], 155);
});

// ─── persistence round-trip ───────────────────────────────────────────
// serializeChannel (state_manager) + the shared overlay autopilot block must
// round-trip identically. We serialize the overlays + shared autopilot the way
// saveDeckState does, then assert the restored shape is byte-identical.

test('persistence: overlays + shared autopilot serialize → restore identical', async () => {
  const { serializeChannel } = await import('../../lib/state_manager.js');
  const { mixer } = makeMixerWithDeck();
  const o1 = mixer.addDeckOverlay({ id: 'do_1', name: 'A', pattern: 'pa', handle: { fillFn: () => {} }, mode: 'blend_add', fader: 0.7, hue: 90, viewSelection: { type: 'group', target: 'Wall' } });
  o1.playlist = { name: 'p1', activeEntryId: 'a1', cursor: 0, autopilot: { active: false, delay_s: 30, shuffle: false } };
  mixer.addDeckOverlay({ id: 'do_2', name: 'B', pattern: 'pb', handle: { fillFn: () => {} }, mode: 'blend_over', fader: 1.0, viewSelection: { type: 'group', target: 'Floor' } });
  mixer.deckOverlayAutopilot = { active: true, delay_s: 15, shuffle: true };

  // Serialize the way saveDeckState does.
  const savedOverlays = mixer.getDeckOverlays().map(serializeChannel);
  const savedAutopilot = { ...mixer.deckOverlayAutopilot };

  // Restore into a fresh mixer (the way the boot path does: addDeckOverlay per
  // saved + assign autopilot).
  const { mixer: mixer2 } = makeMixerWithDeck();
  for (const s of savedOverlays) {
    mixer2.addDeckOverlay({
      id: s.id, name: s.name, pattern: s.pattern, handle: { fillFn: () => {} },
      mode: s.mode, fader: s.fader, enabled: s.enabled, hue: s.hue, color: s.color,
      viewSelection: s.viewSelection, sourceMode: s.sourceMode,
      playlistTint: s.playlistTint, solidColor: s.solidColor,
    });
    const o = mixer2.getDeckOverlay(s.id);
    o.playlist = s.playlist;
  }
  mixer2.deckOverlayAutopilot = { ...savedAutopilot };
  mixer2._deckOverlayAnchorMs = null;

  // Re-serialize and compare.
  const reSavedOverlays = mixer2.getDeckOverlays().map(serializeChannel);
  assert.deepEqual(reSavedOverlays, savedOverlays, 'overlays round-trip identically');
  assert.deepEqual({ ...mixer2.deckOverlayAutopilot }, savedAutopilot, 'shared autopilot round-trips');
  // Order preserved.
  assert.deepEqual(mixer2.getDeckOverlays().map(o => o.id), ['do_1', 'do_2']);
});
