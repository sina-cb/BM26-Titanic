// auto_views.test.js — whole-ship Tier-A auto-view derivation.
//
// deriveAutoViews generalizes deriveStrandViews into the full view
// catalog (report 20260619_1 §5). These tests pin: each family registers,
// members[] select the right pixels with ZERO leaks, names don't collide,
// every entry is bit-free (no viewMask bit consumed), and it works on a
// titanic-shaped rig AND a minimal model — model-agnostic.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveAutoViews } from '../lib/auto_views.js';
import { buildMaskRegistry } from '../lib/mask_registry.js';

// A small titanic-shaped fixture: Left/Right + Front/Back tokens, the four
// structural bands, all four fixture types, a vertical Y spread, and an
// asymmetric-but-now-normalized L/R wall pair.
function shipPixels() {
  const px = [];
  let i = 0;
  const add = (group, fixtureType, type, x, y, z) =>
    px.push({ i: i++, type, fixtureType, group, x, y, z, cId: 0 });
  // PORT (x<0) wall bars, fore + aft.
  add('Left Front Wall Generator', 'ShehdsBar', 'dmx', -10, 1, 5);
  add('Left Back Wall Generator', 'ShehdsBar', 'dmx', -10, 1, -5);
  // STARBOARD (x>0) wall bars, fore + aft.
  add('Right Front Wall Generator', 'ShehdsBar', 'dmx', 10, 1, 5);
  add('Right Back Wall Generator', 'ShehdsBar', 'dmx', 10, 1, -5);
  // Decks (PARs), chimneys (vintage), auditorium (PARs) — high Y.
  add('Left Front Deck Generator', 'UkingPar', 'dmx', -8, 5, 4);
  add('Right Front Deck Generator', 'UkingPar', 'dmx', 8, 5, 4);
  add('Left Top Chimney Generator', 'VintageLed', 'dmx', -3, 10, 0);
  add('Right Top Chimney Generator', 'VintageLed', 'dmx', 3, 10, 0);
  add('Left Center Auditorium Generator', 'UkingPar', 'dmx', -2, 9, 8);
  add('Right Center Auditorium Generator', 'UkingPar', 'dmx', 2, 9, 8);
  // LED strands (raw), Left + Right, Front + Back.
  add('Left_Front_Left', '', 'led', -12, 0, 6);
  add('Right_Back_Right', '', 'led', 12, 0, -6);
  return px;
}

// Engine load takes the model's group names as the existing-name set.
function existingFor(px) {
  return new Set(px.map((p) => p.group));
}

// ── family presence ───────────────────────────────────────────────────

test('deriveAutoViews: every view family registers on a ship-shaped rig', () => {
  const px = shipPixels();
  const { families } = deriveAutoViews(px, existingFor(px));
  assert.ok(families.spatial.includes('PORT'));
  assert.ok(families.spatial.includes('STARBOARD'));
  assert.ok(families.spatial.includes('FORE'));
  assert.ok(families.spatial.includes('AFT'));
  assert.ok(families.structural.includes('WALLS'));
  assert.ok(families.structural.includes('DECKS'));
  assert.ok(families.structural.includes('CHIMNEYS'));
  assert.ok(families.structural.includes('AUDITORIUM'));
  assert.deepEqual(families.typed.sort(), ['@BAR', '@PAR', '@RAW', '@VINTAGE']);
  assert.deepEqual(families.band.sort(), ['BAND_HIGH', 'BAND_LOW', 'BAND_MID']);
  assert.ok(families.strand.includes('LEFT'));
  assert.ok(families.strand.includes('RIGHT'));
});

// ── membership: right pixels, zero leaks ──────────────────────────────

test('deriveAutoViews: PORT/STARBOARD partition the whole ship, no overlap', () => {
  const px = shipPixels();
  const reg = buildMaskRegistry({
    pixels: px,
    pixelCount: px.length,
    groupBits: {},
    viewMasks: deriveAutoViews(px, existingFor(px)).entries,
  });
  const port = reg.get('PORT').members;
  const star = reg.get('STARBOARD').members;
  let union = 0;
  let overlap = 0;
  for (let i = 0; i < px.length; i++) {
    if (port[i] || star[i]) union++;
    if (port[i] && star[i]) overlap++;
    // Membership must match the pixel's x sign.
    if (px[i].x < 0) assert.equal(port[i], 1, `pixel ${i} (x<0) should be PORT`);
    if (px[i].x > 0) assert.equal(star[i], 1, `pixel ${i} (x>0) should be STARBOARD`);
  }
  assert.equal(union, px.length, 'PORT ∪ STARBOARD covers all pixels');
  assert.equal(overlap, 0, 'PORT ∩ STARBOARD is empty');
});

test('deriveAutoViews: typed views select exactly the pixels of that type', () => {
  const px = shipPixels();
  const reg = buildMaskRegistry({
    pixels: px,
    pixelCount: px.length,
    groupBits: {},
    viewMasks: deriveAutoViews(px, existingFor(px)).entries,
  });
  const check = (view, type) => {
    const m = reg.get(view).members;
    for (let i = 0; i < px.length; i++) {
      const want = px[i].fixtureType === type ? 1 : 0;
      assert.equal(m[i], want, `${view}[${i}] for type '${px[i].fixtureType}'`);
    }
  };
  check('@BAR', 'ShehdsBar');
  check('@PAR', 'UkingPar');
  check('@VINTAGE', 'VintageLed');
  check('@RAW', ''); // empty fixtureType → raw LED strand
});

test('deriveAutoViews: vertical bands partition by world Y, no leak', () => {
  const px = shipPixels();
  const reg = buildMaskRegistry({
    pixels: px,
    pixelCount: px.length,
    groupBits: {},
    viewMasks: deriveAutoViews(px, existingFor(px)).entries,
  });
  const lo = reg.get('BAND_LOW').members;
  const mid = reg.get('BAND_MID').members;
  const hi = reg.get('BAND_HIGH').members;
  for (let i = 0; i < px.length; i++) {
    assert.equal(lo[i] + mid[i] + hi[i], 1, `pixel ${i} in exactly one band`);
  }
});

// ── bit-free guarantee ────────────────────────────────────────────────

test('deriveAutoViews: every entry is Tier-A (bit:0 — zero viewMask bit cost)', () => {
  const px = shipPixels();
  const { entries } = deriveAutoViews(px, existingFor(px));
  assert.ok(entries.length > 0);
  assert.ok(entries.every((e) => e.bit === 0), 'all auto-views are bit-free');
});

// ── name-collision discipline ─────────────────────────────────────────

test('deriveAutoViews: skips a family name already owned by a group/preset', () => {
  const px = shipPixels();
  const existing = existingFor(px);
  existing.add('PORT'); // pretend an author already named a mask PORT
  const { families, entries } = deriveAutoViews(px, existing);
  assert.ok(!families.spatial.includes('PORT'), 'PORT not re-registered');
  assert.equal(entries.filter((e) => e.name === 'PORT').length, 0);
});

test('deriveAutoViews: no two entries share a name', () => {
  const px = shipPixels();
  const { entries } = deriveAutoViews(px, existingFor(px));
  const names = entries.map((e) => e.name);
  assert.equal(new Set(names).size, names.length, 'all entry names are unique');
});

// ── symmetric _BOTH composites ────────────────────────────────────────

test('deriveAutoViews: _BOTH composite unions a Left/Right pair (post-normalization)', () => {
  const px = shipPixels();
  const reg = buildMaskRegistry({
    pixels: px,
    pixelCount: px.length,
    groupBits: {},
    viewMasks: deriveAutoViews(px, existingFor(px)).entries,
  });
  // 'Left Front Wall Generator' + 'Right Front Wall Generator' → base
  // 'Front Wall Generator' → composite 'Front Wall Generator_BOTH'.
  const both = reg.get('Front Wall Generator_BOTH');
  assert.ok(both, 'Front Wall Generator_BOTH registered');
  let n = 0;
  for (let i = 0; i < px.length; i++) {
    if (both.members[i]) {
      n++;
      assert.match(px[i].group, /(Left|Right) Front Wall Generator/);
    }
  }
  assert.equal(n, 2);
});

// ── per-controller views (only when patched) ──────────────────────────

test('deriveAutoViews: registers NO controller view when every cId is 0', () => {
  const px = shipPixels(); // all cId:0 (unpatched)
  const { families } = deriveAutoViews(px, existingFor(px));
  assert.equal(families.controller.length, 0, 'no CTRL_0 on an unpatched model');
});

test('deriveAutoViews: one CTRL_<cId> view per controller once patched', () => {
  const px = shipPixels().map((p, k) => ({ ...p, cId: k < 6 ? 1 : 2 }));
  const reg = buildMaskRegistry({
    pixels: px,
    pixelCount: px.length,
    groupBits: {},
    viewMasks: deriveAutoViews(px, existingFor(px)).entries,
  });
  const c1 = reg.get('CTRL_1');
  const c2 = reg.get('CTRL_2');
  assert.ok(c1 && c2, 'CTRL_1 and CTRL_2 both registered');
  let n1 = 0;
  let n2 = 0;
  for (let i = 0; i < px.length; i++) {
    n1 += c1.members[i];
    n2 += c2.members[i];
    assert.equal(c1.members[i] && c2.members[i], 0, 'controllers are disjoint');
  }
  assert.equal(n1, 6);
  assert.equal(n2, px.length - 6);
});

// ── loud failure on a contradictory model (codex P0) ──────────────────

test('deriveAutoViews: THROWS when a group side disagrees with world-x sign', () => {
  const px = [
    // Group says Left (port) but x is positive (starboard) — broken model.
    { i: 0, type: 'dmx', fixtureType: 'ShehdsBar', group: 'Left Front Wall Generator', x: 7, y: 1, z: 5, cId: 0 },
  ];
  assert.throws(() => deriveAutoViews(px, new Set()),
    /side\/geometry disagree|implies port but world x/);
});

// ── model-agnostic: minimal rig with no L/R or fore/aft tokens ─────────

test('deriveAutoViews: minimal rig — typed + bands + controller, no spatial/structural', () => {
  const px = [
    { i: 0, type: 'dmx', fixtureType: 'UkingPar', group: 'ParLights', x: 1, y: 0, z: 0, cId: 1 },
    { i: 1, type: 'dmx', fixtureType: 'ShehdsBar', group: 'BarLights', x: 1, y: 5, z: 0, cId: 1 },
  ];
  const { families } = deriveAutoViews(px, existingFor(px));
  assert.equal(families.spatial.length, 0, 'no PORT/STARBOARD/FORE/AFT without tokens');
  assert.equal(families.structural.length, 0, 'no structural bands without tokens');
  assert.deepEqual(families.typed.sort(), ['@BAR', '@PAR']);
  assert.deepEqual(families.band.sort(), ['BAND_HIGH', 'BAND_LOW']); // 2 pixels, 2 bands
  assert.deepEqual(families.controller, ['CTRL_1']);
});

// ── back-compat: strand behavior preserved ────────────────────────────

test('deriveAutoViews: per-strand view registers when the strand owns no base bit', () => {
  const px = shipPixels();
  // Strand groups WITHOUT a base-group bit (not in `existing`) → per-strand
  // views register. Use only the DMX group names as existing so the LED
  // strand names are free, mirroring a model whose strands lack base bits.
  const existing = new Set(px.filter((p) => p.type === 'dmx').map((p) => p.group));
  const { families } = deriveAutoViews(px, existing);
  assert.ok(families.strand.includes('Left_Front_Left'), 'per-strand view registered');
});

test('deriveAutoViews: per-strand view SKIPPED when a base group owns the name', () => {
  const px = shipPixels();
  // existingFor includes the strand group names (base groups own them),
  // exactly like titanic — per-strand is skipped, LEFT/RIGHT still emit.
  const { families } = deriveAutoViews(px, existingFor(px));
  assert.ok(!families.strand.includes('Left_Front_Left'), 'base group owns it; not re-registered');
  assert.ok(families.strand.includes('LEFT'));
  assert.ok(families.strand.includes('RIGHT'));
});

test('deriveAutoViews: LED LEFT/RIGHT stay LED-strand-scoped (not whole ship)', () => {
  const px = shipPixels();
  const reg = buildMaskRegistry({
    pixels: px,
    pixelCount: px.length,
    groupBits: {},
    viewMasks: deriveAutoViews(px, existingFor(px)).entries,
  });
  // LED LEFT/RIGHT are LED-strand-scoped (not the whole ship — that is
  // PORT/STARBOARD). Only the 2 LED strands here.
  const left = reg.get('LEFT').members;
  const right = reg.get('RIGHT').members;
  let nLeft = 0;
  let nRight = 0;
  for (let i = 0; i < px.length; i++) {
    nLeft += left[i];
    nRight += right[i];
    if (left[i] || right[i]) assert.equal(px[i].type, 'led', 'LEFT/RIGHT are LED-only');
  }
  assert.equal(nLeft, 1);
  assert.equal(nRight, 1);
});
