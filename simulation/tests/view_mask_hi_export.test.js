/**
 * view_mask_hi_export.test.js — the HIGH view word survives the sim export.
 *
 * The defect (report `_137` §6.1, fixed by `_138`): the model exporter wrote
 * only `vMask` on every pixel, while `buildViewmasksSidecarJS` reads
 * `vMaskHi` for a word-1 view. A custom view with PER-FIXTURE membership —
 * the operator clicks fixtures instead of attaching groups — therefore found
 * ZERO members and was silently skipped from the sidecar. Latent only while
 * custom views defaulted to word 0; `_137` made `addCustomView` allocate word
 * 1 FIRST, so the very next fixture-clicked view an operator creates hits it.
 *
 * The guarantees locked here:
 *   1. a NEW custom view lands in word 1 (the allocator policy that makes this
 *      the default path, not an exotic one),
 *   2. exported pixels carry BOTH words (`vMask` + `vMaskHi`),
 *   3. the sidecar resolves a word-1 per-fixture view to EXACTLY the clicked
 *      fixtures' pixels — zero miss, zero leak (`_134`'s harness shape),
 *   4. word-0 per-fixture membership is byte-identical to the old behaviour,
 *      including the serialized model text (no `vMaskHi` key at all),
 *   5. `setCustomViewSlot` relocates a per-fixture view ACROSS words, moving
 *      the membership with it, and refuses to do so without the fixture list.
 *
 * `generatePixelMap` / `saveModelJS` read browser-ish globals; we mock the
 * minimum (THREE math + plain objects, a fetch stub, a serverConfig) exactly
 * as the sibling exporter tests do.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { params } from '../src/core/state.js';
import { generatePixelMap, saveModelJS } from '../src/dmx/pixelblaze_model_exporter.js';
import {
  createViewRegistry, addCustomView, buildViewmasksSidecarJS, reconcileGroupBits,
  listPixelGroups, setCustomViewSlot, setFixtureInView, fixtureInView, pixelInView,
  fixtureMaskField, viewWord,
} from '../src/dmx/view_registry.js';

function makeGroup() {
  const g = new THREE.Group();
  g.updateMatrixWorld(true);
  return g;
}

function resetWorld() {
  globalThis.window = globalThis.window || {};
  window._isRebuildingFixtures = false;
  window.parFixtures = [];
  window.dmxSceneFixtures = [];
  window.ledStrandFixtures = [];
  window.__controllerRegistry = null;
  window.__viewRegistry = null;
  window.__activeScene = 'unit_scene';
  window._missingFixtureWarnCount = 0;
  window.serverConfig = { save_port: 6970 };
  params.dmxFixtures = [];
  params.parLights = [];
  params.ledStrands = [];
}

/** A multi-pixel DMX bar fixture (config + runtime), mirroring the sim's shape. */
function mkBar(config, nPixels) {
  return {
    config,
    group: makeGroup(),
    fixtureDef: { footprint: 18, channels: { red: 1, green: 2, blue: 3 } },
    pixels: Array.from({ length: nPixels }, (_, k) => ({
      localPos: new THREE.Vector3(k, 0, 0),
      model: { id: `pixel_${k + 1}`, channels: { red: 1, green: 2, blue: 3 }, size: 14 },
    })),
    setPixelColorRGB() {},
  };
}

/**
 * Three bars in two groups: 'Bars' (A 3px, B 2px) and 'Rail' (C 2px).
 * Pixel indices: A → 0,1,2 · B → 3,4 · C → 5,6.
 */
function threeBarScene() {
  resetWorld();
  const a = { name: 'Bar A', type: 'ShehdsBar', group: 'Bars', fixtureId: 1,
    dmxUniverse: 1, dmxAddress: 1 };
  const b = { name: 'Bar B', type: 'ShehdsBar', group: 'Bars', fixtureId: 2,
    dmxUniverse: 1, dmxAddress: 50 };
  const c = { name: 'Bar C', type: 'ShehdsBar', group: 'Rail', fixtureId: 3,
    dmxUniverse: 1, dmxAddress: 100 };
  params.dmxFixtures = [a, b, c];
  window.parFixtures = [mkBar(a, 3), mkBar(b, 2), mkBar(c, 2)];
  return { a, b, c };
}

/** Build the sidecar the way saveModelJS does: reconcile groups, then render. */
function sidecarFor(registry, pixels) {
  reconcileGroupBits(registry, listPixelGroups(pixels));
  return buildViewmasksSidecarJS(registry, pixels, 'unit_scene');
}

/** The `pixelIndices: [...]` a named view emitted, or null when it was skipped. */
function sidecarPixelIndices(text, viewName) {
  const line = text.split('\n').find((l) => l.includes(`name: '${viewName}'`));
  if (!line) return null;
  const m = line.match(/pixelIndices: \[([^\]]*)\]/);
  if (!m) return null;
  const body = m[1].trim();
  return body.length === 0 ? [] : body.split(',').map((s) => Number(s.trim()));
}

function captureModelBody(fn) {
  const bodies = [];
  const realFetch = global.fetch;
  global.fetch = (url, opts) => {
    bodies.push({ url: String(url), body: opts && opts.body });
    return Promise.resolve({ ok: true });
  };
  try {
    fn();
  } finally {
    global.fetch = realFetch;
  }
  const model = bodies.find((b) => b.url.includes('/save-model') && !b.url.includes('type='));
  assert.ok(model, 'saveModelJS should POST the model body');
  return model.body;
}

// ── 1. The allocator makes word 1 the DEFAULT for a new custom view ────────

test('a brand-new custom view is allocated into word 1 (this is the common path)', () => {
  const reg = createViewRegistry({});
  const view = addCustomView(reg, 'Chimneys');
  assert.equal(view.word, 1, 'word 1 first — word 0 is reserved for base group bits');
  assert.equal(view.bit, 1);
  assert.equal(fixtureMaskField(view), 'viewMaskHi');
});

// ── 2. Exported pixels carry BOTH view words ──────────────────────────────

test('every exported pixel carries vMask AND vMaskHi, mirrored from its config', () => {
  const { a, b } = threeBarScene();
  a.viewMask = 0x8;
  a.viewMaskHi = 0x400;
  b.viewMaskHi = 0x400;

  const { pixels } = generatePixelMap();
  assert.equal(pixels.length, 7);
  // Field present on EVERY pixel (the engine's `px.vMaskHi ?? 0` default is a
  // floor, not an excuse for the exporter to omit it in memory).
  assert.ok(pixels.every((p) => typeof p.vMaskHi === 'number'), 'vMaskHi on every pixel');
  assert.deepEqual(pixels.map((p) => p.vMask), [0x8, 0x8, 0x8, 0, 0, 0, 0]);
  assert.deepEqual(pixels.map((p) => p.vMaskHi),
    [0x400, 0x400, 0x400, 0x400, 0x400, 0, 0]);
});

test('LED strand pixels carry the high word too', () => {
  resetWorld();
  const strand = { name: 'Left_Hull', ledCount: 3, startX: -5, startY: 0, startZ: 0,
    endX: -5, endY: 0, endZ: 3, viewMaskHi: 0x2 };
  params.ledStrands = [strand];
  window.ledStrandFixtures = [{ setLedColorRGB() {} }];

  const { pixels } = generatePixelMap();
  assert.equal(pixels.length, 3);
  assert.ok(pixels.every((p) => p.vMaskHi === 0x2 && p.vMask === 0));
});

// ── 3. Zero-miss / zero-leak: a WORD-1 per-fixture view resolves exactly ───

test('word-1 per-fixture view: sidecar membership is EXACTLY the clicked fixtures', () => {
  const { a, b, c } = threeBarScene();
  const reg = createViewRegistry({});
  const view = addCustomView(reg, 'Hand Picked');
  assert.equal(view.word, 1);

  // The operator clicks Bar A and Bar C (NOT Bar B) and hits "Assign sel.".
  setFixtureInView(a, view, true);
  setFixtureInView(c, view, true);
  // The panel wrote the bit into the view's own word, never into viewMask.
  assert.equal(a.viewMaskHi, view.bit);
  assert.equal(a.viewMask, undefined);
  assert.ok(fixtureInView(a, view) && fixtureInView(c, view) && !fixtureInView(b, view));

  const { pixels } = generatePixelMap();
  const text = sidecarFor(reg, pixels);

  // The view is EMITTED (before the fix it was skipped with a console.warn).
  assert.ok(text.includes("name: 'Hand Picked'"), 'the view reached the sidecar');
  assert.match(text, /name: 'Hand Picked', bit: 0x0001, word: 1, pixelIndices:/);

  // Zero miss, zero leak: the resolved set equals Bar A's + Bar C's pixels.
  const expected = pixels
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.name.startsWith('Bar A') || p.name.startsWith('Bar C'))
    .map(({ i }) => i);
  assert.deepEqual(expected, [0, 1, 2, 5, 6]);
  assert.deepEqual(sidecarPixelIndices(text, 'Hand Picked'), expected);

  // And the same set falls out of the shared membership predicate.
  const viaPredicate = pixels.map((p, i) => (pixelInView(p, view) ? i : -1)).filter((i) => i >= 0);
  assert.deepEqual(viaPredicate, expected);
});

test('a word-1 view does NOT leak members through the word-0 field', () => {
  const { a, b } = threeBarScene();
  const reg = createViewRegistry({});
  const view = addCustomView(reg, 'Hi Only'); // word 1, bit 0x1
  setFixtureInView(a, view, true);
  // Bar B carries the SAME BIT VALUE in the LOW word — a legitimate base group
  // bit. A word-blind reader would sweep it into the view; a word-aware one
  // must not see it at all.
  b.viewMask = view.bit;

  const { pixels } = generatePixelMap();
  const text = sidecarFor(reg, pixels);
  assert.deepEqual(sidecarPixelIndices(text, 'Hi Only'), [0, 1, 2], 'Bar B must NOT leak in');
  assert.equal(fixtureInView(b, view), false);
});

// ── 4. Word-0 control case — byte-identical old behaviour ─────────────────

test('word-0 per-fixture view: unchanged resolution, and no vMaskHi in the model text', () => {
  const { a, c } = threeBarScene();
  // A views.yaml that PINS the view in word 0 (the pre-_137 shape: no `word`
  // key at all). Existing scenes look exactly like this.
  const reg = createViewRegistry({ custom: [{ name: 'Legacy View', bit: 0x100 }] });
  const view = reg.custom[0];
  assert.equal(viewWord(view), 0);
  assert.equal(fixtureMaskField(view), 'viewMask');

  setFixtureInView(a, view, true);
  setFixtureInView(c, view, true);
  assert.equal(a.viewMask, 0x100);
  assert.equal(a.viewMaskHi, undefined, 'a word-0 assign never touches the high word');

  const { pixels } = generatePixelMap();
  assert.ok(pixels.every((p) => p.vMaskHi === 0), 'no pixel gained a high word');
  const text = sidecarFor(reg, pixels);
  // Legacy emission shape: NO `word:` key (pre-Tier-C sidecars stay identical).
  assert.match(text, /name: 'Legacy View', bit: 0x0100, pixelIndices: \[0, 1, 2, 5, 6\]/);
  assert.ok(!text.includes("name: 'Legacy View', bit: 0x0100, word:"));

  // The serialized MODEL is byte-identical to the pre-change format: `vMaskHi`
  // is emitted only when non-zero, so a scene without word-1 membership has no
  // trace of it anywhere in the file.
  const body = captureModelBody(() => saveModelJS());
  assert.ok(!body.includes('vMaskHi'), 'zero high word ⇒ the key is absent entirely');
  assert.ok(body.includes('vMask: 256, patch:'), 'vMask still serializes exactly as before');
});

test('the model text carries vMaskHi on exactly the word-1 members', () => {
  const { a, c } = threeBarScene();
  const reg = createViewRegistry({});
  const view = addCustomView(reg, 'Picked'); // word 1, bit 0x1
  window.__viewRegistry = reg;
  setFixtureInView(a, view, true);
  setFixtureInView(c, view, true);

  const body = captureModelBody(() => saveModelJS());
  const pixelLines = body.split('\n').filter((l) => l.trim().startsWith('{ i: '));
  assert.equal(pixelLines.length, 7);
  const withHi = pixelLines
    .map((l, i) => (l.includes('vMaskHi: 1,') ? i : -1))
    .filter((i) => i >= 0);
  assert.deepEqual(withHi, [0, 1, 2, 5, 6]);
  // Placement: immediately after vMask, before patch — one canonical field order.
  assert.match(pixelLines[0], /vMask: 0, vMaskHi: 1, patch:/);
  assert.match(pixelLines[3], /vMask: 0, patch:/, 'a non-member omits the key');
});

// ── 5. Cross-word relocation of a PER-FIXTURE view (refusal lifted) ────────

test('setCustomViewSlot moves a per-fixture view across words, carrying membership', () => {
  const { a, b, c } = threeBarScene();
  const fixtures = [a, b, c];
  const reg = createViewRegistry({});
  const view = addCustomView(reg, 'Movable'); // word 1, bit 0x1
  setFixtureInView(a, view, true);
  setFixtureInView(c, view, true);

  // Word 1 → word 0. `_137` refused this outright because fixtures had nowhere
  // to keep a high-word bit; they do now, so the move is legal AND atomic.
  const old = setCustomViewSlot(reg, view, 0, 0x40, fixtures);
  assert.deepEqual(old, { word: 1, bit: 0x1 });
  assert.equal(view.word, 0);
  assert.equal(view.bit, 0x40);

  // The bit moved fields — nothing stayed behind in the old word, which would
  // alias whatever group/view owns that value there.
  assert.equal(a.viewMaskHi, 0);
  assert.equal(a.viewMask, 0x40);
  assert.equal(c.viewMaskHi, 0);
  assert.equal(c.viewMask, 0x40);
  assert.equal(b.viewMask || 0, 0, 'a non-member gained nothing');
  assert.equal(b.viewMaskHi || 0, 0);

  // Still zero-miss / zero-leak after the move.
  const { pixels } = generatePixelMap();
  const text = sidecarFor(reg, pixels);
  assert.deepEqual(sidecarPixelIndices(text, 'Movable'), [0, 1, 2, 5, 6]);
});

test('setCustomViewSlot round-trips word 0 → word 1 with the same membership', () => {
  const { a, c } = threeBarScene();
  const fixtures = [a, c];
  const reg = createViewRegistry({ custom: [{ name: 'Round Trip', bit: 0x100 }] });
  const view = reg.custom[0];
  setFixtureInView(a, view, true);

  setCustomViewSlot(reg, view, 1, 0x8, fixtures);
  assert.equal(a.viewMask, 0);
  assert.equal(a.viewMaskHi, 0x8);

  const { pixels } = generatePixelMap();
  const text = sidecarFor(reg, pixels);
  assert.match(text, /name: 'Round Trip', bit: 0x0008, word: 1, pixelIndices: \[0, 1, 2\]/);
});

test('a cross-word move WITHOUT the fixture list is refused, loudly', () => {
  const reg = createViewRegistry({});
  const view = addCustomView(reg, 'Stranded');
  assert.throws(
    () => setCustomViewSlot(reg, view, 0, 0x40),
    /must migrate its per-fixture membership between the 'viewMaskHi' and 'viewMask' fields/);
  // Nothing moved — the refusal is not a partial application.
  assert.equal(view.word, 1);
  assert.equal(view.bit, 0x1);
});

test('a same-word move still needs no fixture list (contract unchanged)', () => {
  const reg = createViewRegistry({});
  const view = addCustomView(reg, 'Same Word');
  const old = setCustomViewSlot(reg, view, 1, 0x20);
  assert.deepEqual(old, { word: 1, bit: 0x1 });
  assert.equal(view.bit, 0x20);
});

test('cross-word collisions are still checked in the DESTINATION word', () => {
  const { a } = threeBarScene();
  const reg = createViewRegistry({ custom: [{ name: 'Parked', bit: 0x40 }] });
  const mover = addCustomView(reg, 'Mover'); // word 1, bit 0x1
  assert.throws(
    () => setCustomViewSlot(reg, mover, 0, 0x40, [a]),
    /already taken by another group or view in word 0/);
  assert.equal(mover.word, 1);
});

// ── 6. Group-based views are untouched by any of this ─────────────────────

test('group-based views still resolve by group name, in EITHER word', () => {
  threeBarScene();
  const reg = createViewRegistry({});
  const hi = addCustomView(reg, 'Group Hi'); // word 1
  hi.groups = ['Bars'];
  const lo = createViewRegistry({ custom: [{ name: 'Group Lo', bit: 0x200, groups: ['Rail'] }] })
    .custom[0];
  reg.custom.push(lo);

  const { pixels } = generatePixelMap();
  const text = sidecarFor(reg, pixels);
  // Both emit `groups: [...]` — no pixelIndices, so no fixture mask is read at
  // all and the word only decides which lane the engine merges the bit into.
  assert.match(text, /name: 'Group Hi', bit: 0x0001, word: 1, groups: \['Bars'\]/);
  assert.match(text, /name: 'Group Lo', bit: 0x0200, groups: \['Rail'\]/);
  assert.equal(sidecarPixelIndices(text, 'Group Hi'), null);
  assert.equal(sidecarPixelIndices(text, 'Group Lo'), null);
});
