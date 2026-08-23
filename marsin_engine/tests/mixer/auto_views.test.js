// auto_views.test.js — whole-ship Tier-A auto-view derivation.
//
// deriveAutoViews generalizes deriveStrandViews into the full view
// catalog (report 20260619_1 §5), trimmed to the operator's catalog by
// report 20260804_145: exhaustive whole-ship LEFT/RIGHT halves, FRONT/BACK
// ends, structural bands, typed views, per-controller views. These tests
// pin: each family registers, members[] select the right pixels with ZERO
// leaks, names don't collide, every entry is bit-free (no viewMask bit
// consumed), the retired families are GONE, and it works on a
// titanic-shaped rig AND a minimal model — model-agnostic.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveAutoViews } from '../../lib/auto_views.js';
import { buildMaskRegistry } from '../../lib/mask_registry.js';

// A small titanic-shaped fixture: Left/Right + Front/Back tokens, the four
// structural bands, all four fixture types, a vertical Y spread, and an
// asymmetric-but-now-normalized L/R wall pair.
function shipPixels() {
  const px = [];
  let i = 0;
  const add = (group, fixtureType, type, x, y, z) =>
    px.push({ i: i++, type, fixtureType, group, x, y, z, cId: 0 });
  // LEFT (x<0) wall bars, front + back.
  add('Left Front Wall Generator', 'ShehdsBar', 'dmx', -10, 1, 5);
  add('Left Back Wall Generator', 'ShehdsBar', 'dmx', -10, 1, -5);
  // RIGHT (x>0) wall bars, front + back.
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

function registryFor(px, existing = existingFor(px)) {
  return buildMaskRegistry({
    pixels: px,
    pixelCount: px.length,
    groupBits: {},
    viewMasks: deriveAutoViews(px, existing).entries,
  });
}

// ── family presence ───────────────────────────────────────────────────

test('deriveAutoViews: every view family registers on a ship-shaped rig', () => {
  const px = shipPixels();
  const { families } = deriveAutoViews(px, existingFor(px));
  assert.deepEqual(families.spatial, ['LEFT', 'RIGHT', 'FRONT', 'BACK']);
  assert.ok(families.structural.includes('WALLS'));
  assert.ok(families.structural.includes('DECKS'));
  assert.ok(families.structural.includes('CHIMNEYS'));
  assert.ok(families.structural.includes('AUDITORIUM'));
  assert.deepEqual(families.typed.sort(), ['@BAR', '@PAR', '@VINTAGE', 'Strands']);
});

test('deriveAutoViews: the retired families are GONE (no PORT/STARBOARD/FORE/AFT/BAND_*/_BOTH)', () => {
  const px = shipPixels();
  const { entries, families } = deriveAutoViews(px, existingFor(px));
  const names = entries.map((e) => e.name);
  for (const gone of ['PORT', 'STARBOARD', 'FORE', 'AFT', 'BAND_LOW', 'BAND_MID', 'BAND_HIGH', '@RAW']) {
    assert.ok(!names.includes(gone), `'${gone}' must not be generated any more`);
  }
  assert.equal(names.filter((n) => /_BOTH$/.test(n)).length, 0, 'no `<base>_BOTH` composites');
  assert.equal(families.band, undefined, 'the band family is removed, not emptied');
  assert.equal(families.paired, undefined, 'the paired family is removed, not emptied');
});

// ── membership: right pixels, zero leaks ──────────────────────────────

test('deriveAutoViews: LEFT/RIGHT are EXHAUSTIVE whole-ship halves, no overlap', () => {
  const px = shipPixels();
  const reg = registryFor(px);
  const left = reg.get('LEFT').members;
  const right = reg.get('RIGHT').members;
  let union = 0;
  let overlap = 0;
  for (let i = 0; i < px.length; i++) {
    if (left[i] || right[i]) union++;
    if (left[i] && right[i]) overlap++;
    // Membership must match the pixel's x sign — DMX fixtures included,
    // not just LED strands (the pre-_145 LEFT/RIGHT were strand-scoped).
    if (px[i].x < 0) assert.equal(left[i], 1, `pixel ${i} (x<0) should be LEFT`);
    if (px[i].x > 0) assert.equal(right[i], 1, `pixel ${i} (x>0) should be RIGHT`);
  }
  assert.equal(union, px.length, 'LEFT ∪ RIGHT covers all pixels');
  assert.equal(overlap, 0, 'LEFT ∩ RIGHT is empty');
});

test('deriveAutoViews: FRONT/BACK split by the group-name token', () => {
  const px = shipPixels();
  const reg = registryFor(px);
  const front = reg.get('FRONT').members;
  const back = reg.get('BACK').members;
  for (let i = 0; i < px.length; i++) {
    const g = px[i].group;
    if (/(^|[ _])Front([ _]|$)/.test(g)) assert.equal(front[i], 1, `pixel ${i} should be FRONT`);
    if (/(^|[ _])Back([ _]|$)/.test(g)) assert.equal(back[i], 1, `pixel ${i} should be BACK`);
    assert.equal(front[i] && back[i], 0, `pixel ${i} cannot be both ends`);
  }
});

test('deriveAutoViews: typed views select exactly the pixels of that type', () => {
  const px = shipPixels();
  const reg = registryFor(px);
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
  check('Strands', ''); // empty fixtureType → raw LED strand (was '@RAW')
});

test('deriveAutoViews: AUDITORIUM is exactly auditorium PARs plus every TE sign', () => {
  const px = shipPixels();
  px.push(
    { i: px.length, type: 'led', fixtureType: 'TeSignV3A40', group: 'TE Sign',
      x: -15, y: 8, z: 8, cId: 0 },
    { i: px.length + 1, type: 'led', fixtureType: 'TeSignV3B34', group: 'TE Sign 2',
      x: 15, y: 8, z: 8, cId: 0 },
  );
  const auditorium = registryFor(px).get('AUDITORIUM').members;
  const expected = new Set([8, 9, 12, 13]);
  for (let i = 0; i < px.length; i++) {
    assert.equal(auditorium[i], expected.has(i) ? 1 : 0,
      `AUDITORIUM[${i}] must include only auditorium PARs and TE signs`);
  }
  assert.equal(auditorium[4], 0, 'non-auditorium left deck PAR stays excluded');
  assert.equal(auditorium[5], 0, 'non-auditorium right deck PAR stays excluded');
});

test('deriveAutoViews: an Auditorium-named non-PAR fixture fails loudly', () => {
  const px = shipPixels();
  px[8] = { ...px[8], fixtureType: 'ShehdsBar' };
  assert.throws(() => deriveAutoViews(px, existingFor(px)),
    /marked Auditorium.*not FIX_PAR.*fixture identity is ambiguous/);
});

test('deriveAutoViews: the TE signs are their own typed view, disjoint from Strands', () => {
  const px = shipPixels();
  px.push({ i: px.length, type: 'led', fixtureType: 'TeSignV3A40', group: 'TE Sign', x: -15, y: 8, z: 8, cId: 0 });
  px.push({ i: px.length, type: 'led', fixtureType: 'TeSignV3B34', group: 'TE Sign 2', x: 15, y: 8, z: 8, cId: 0 });
  const reg = registryFor(px);
  const signs = reg.get('TE Signs');
  const strands = reg.get('Strands');
  assert.ok(signs, 'TE Signs registered');
  let nSigns = 0;
  for (let i = 0; i < px.length; i++) {
    nSigns += signs.members[i];
    assert.equal(signs.members[i] && strands.members[i], 0, 'Strands ∩ TE Signs is empty');
  }
  assert.equal(nSigns, 2, 'both sign panel variants are one role');
});

test('deriveAutoViews: an operator-named typed view REFUSES to collide (never silently skipped)', () => {
  const px = shipPixels();
  const existing = existingFor(px);
  existing.add('Strands'); // an authored view / group already owns the name
  assert.throws(() => deriveAutoViews(px, existing), /collides with an existing group or preset/);
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
  existing.add('LEFT'); // pretend an author already named a mask LEFT
  const { families, entries } = deriveAutoViews(px, existing);
  assert.ok(!families.spatial.includes('LEFT'), 'LEFT not re-registered');
  assert.equal(entries.filter((e) => e.name === 'LEFT').length, 0);
});

test('deriveAutoViews: no two entries share a name', () => {
  const px = shipPixels();
  const { entries } = deriveAutoViews(px, existingFor(px));
  const names = entries.map((e) => e.name);
  assert.equal(new Set(names).size, names.length, 'all entry names are unique');
});

// ── per-controller views (only when patched) ──────────────────────────

test('deriveAutoViews: registers NO controller view when every cId is 0', () => {
  const px = shipPixels(); // all cId:0 (unpatched)
  const { families } = deriveAutoViews(px, existingFor(px));
  assert.equal(families.controller.length, 0, 'no CTRL_0 on an unpatched model');
});

test('deriveAutoViews: one CTRL_<cId> view per controller once patched', () => {
  const px = shipPixels().map((p, k) => ({ ...p, cId: k < 6 ? 1 : 2 }));
  const reg = registryFor(px);
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

test('deriveAutoViews: a controller straddling the centreline is reported, not hidden', () => {
  const px = [
    { i: 0, type: 'dmx', fixtureType: 'UkingPar', group: 'Pars', x: -1, y: 0, z: 0, cId: 3 },
    { i: 1, type: 'dmx', fixtureType: 'UkingPar', group: 'Pars', x: 1, y: 0, z: 0, cId: 3 },
  ];
  const { warnings } = deriveAutoViews(px, new Set(['Pars']));
  assert.ok(warnings.some((w) => /controller 3 has pixels on BOTH halves/.test(w)));
});

// ── loud failure on a contradictory model (codex P0) ──────────────────

test('deriveAutoViews: THROWS when a group side disagrees with world-x sign', () => {
  const px = [
    // Group says Left but x is positive (right) — broken model.
    { i: 0, type: 'dmx', fixtureType: 'ShehdsBar', group: 'Left Front Wall Generator', x: 7, y: 1, z: 5, cId: 0 },
  ];
  assert.throws(() => deriveAutoViews(px, new Set()),
    /side\/geometry disagree|implies left but world x/);
});

test('deriveAutoViews: a centreline pixel with no side token joins NEITHER half, loudly', () => {
  const px = [
    { i: 0, type: 'dmx', fixtureType: 'UkingPar', group: 'Mast', x: 0, y: 1, z: 0, cId: 0 },
    { i: 1, type: 'dmx', fixtureType: 'UkingPar', group: 'Mast', x: -4, y: 1, z: 0, cId: 0 },
  ];
  const { entries, warnings } = deriveAutoViews(px, new Set(['Mast']));
  const left = entries.find((e) => e.name === 'LEFT');
  assert.deepEqual(left.pixelIndices, [1], 'only the off-centre pixel is in a half');
  assert.ok(!entries.some((e) => e.name === 'RIGHT'), 'no empty RIGHT mask');
  assert.ok(warnings.some((w) => /centreline/.test(w) && /NEITHER half/.test(w)),
    'the un-halved pixel is reported, never silently dropped');
});

test('deriveAutoViews: a centreline pixel WITH a side token takes the token', () => {
  const px = [{ i: 0, type: 'dmx', fixtureType: 'UkingPar', group: 'Left Mast', x: 0, y: 1, z: 0, cId: 0 }];
  const { entries, warnings } = deriveAutoViews(px, new Set(['Left Mast']));
  assert.deepEqual(entries.find((e) => e.name === 'LEFT').pixelIndices, [0]);
  assert.equal(warnings.length, 0);
});

// ── model-agnostic: minimal rig with no L/R or front/back tokens ───────

test('deriveAutoViews: a generic PAR rig does not invent auditorium membership', () => {
  const px = [
    { i: 0, type: 'dmx', fixtureType: 'UkingPar', group: 'ParLights', x: 1, y: 0, z: 0, cId: 1 },
    { i: 1, type: 'dmx', fixtureType: 'ShehdsBar', group: 'BarLights', x: 1, y: 5, z: 0, cId: 1 },
  ];
  const { families } = deriveAutoViews(px, existingFor(px));
  assert.deepEqual(families.spatial, ['RIGHT'], 'both pixels are x>0 — no empty LEFT mask');
  assert.deepEqual(families.structural, [],
    'a generic PAR role is not evidence of physical auditorium membership');
  assert.deepEqual(families.typed.sort(), ['@BAR', '@PAR']);
  assert.deepEqual(families.controller, ['CTRL_1']);
});

// ── back-compat: per-strand behavior preserved ────────────────────────

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
  // exactly like titanic — per-strand is skipped.
  const { families } = deriveAutoViews(px, existingFor(px));
  assert.ok(!families.strand.includes('Left_Front_Left'), 'base group owns it; not re-registered');
});

test('deriveAutoViews: LEFT/RIGHT are whole-ship, NOT the old LED-strand-scoped pair', () => {
  const px = shipPixels();
  const reg = registryFor(px);
  let nDmx = 0;
  for (let i = 0; i < px.length; i++) {
    if (px[i].type === 'dmx' && (reg.get('LEFT').members[i] || reg.get('RIGHT').members[i])) nDmx++;
  }
  assert.equal(nDmx, px.filter((p) => p.type === 'dmx').length,
    'every DMX fixture is in a half (pre-_145 LEFT/RIGHT held LED strands only)');
});
