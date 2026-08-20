/**
 * views_bulletproofing.test.js — corner-case regressions from the
 * views-bulletproofing sweep (report 20260725_141).
 *
 * Three confirmed defects pinned green here:
 *
 *   1. MIXED membership (groups attached AND fixtures clicked): the sidecar
 *      emitted the groups form and SILENTLY DROPPED every clicked fixture —
 *      while the Views panel's member count and both 3D isolation paths show
 *      the union. It now exports the union as pixelIndices; a redundant click
 *      (fixture already inside an attached group) keeps the byte-stable
 *      groups form.
 *   2. `setCustomViewSlot` ACCEPTED a `fixtures` list on a same-word move and
 *      silently ignored it, stranding every member on the old bit — an
 *      orphan bit that reads as "not a member" and collides with the bit's
 *      next owner. Membership now follows the view whenever the list is
 *      passed, same-word or cross-word.
 *   3. The rename snapshot recorded only NON-ZERO masks, so a stale non-zero
 *      patch-tree copy outlived a live unassign (config back to 0) and the
 *      rename RESURRECTED the removed membership. `snapshotViewMasks` makes
 *      the live config authoritative — zeros included.
 *
 * Plus the exhaustion / churn / fuzz battery: every refusal loud, no
 * wraparound into bit 31, no cross-word bit collision ever, per-fixture bits
 * always in their view's own word.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createViewRegistry, addCustomView, removeCustomView, setCustomViewSlot,
  nextFreeSlot, usedBitsMask, reconcileGroupBits, buildViewmasksSidecarJS,
  setFixtureInView, viewWord, MAX_BIT, MAX_VIEW_SLOTS,
} from '../src/dmx/view_registry.js';
import { snapshotViewMasks, carryViewMasks } from '../src/dmx/rename_invalidation.js';

function sidecarLine(text, viewName) {
  return text.split('\n').find((l) => l.includes(`name: '${viewName}'`)) || null;
}

// ── 1. Mixed groups + clicked fixtures: the union exports ──────────────────

test('a view with groups AND a clicked fixture OUTSIDE them exports the UNION as pixelIndices', () => {
  const reg = createViewRegistry({});
  reconcileGroupBits(reg, ['Bars', 'Rail']);
  const view = addCustomView(reg, 'Mixed'); // word 1
  view.groups = ['Bars'];
  const pixels = [
    { name: 'Bar 1-1', group: 'Bars', vMask: 0, vMaskHi: 0 },
    { name: 'Bar 1-2', group: 'Bars', vMask: 0, vMaskHi: 0 },
    { name: 'Rail 1-1', group: 'Rail', vMask: 0, vMaskHi: view.bit }, // the click
    { name: 'Rail 1-2', group: 'Rail', vMask: 0, vMaskHi: 0 },
  ];
  const warns = [];
  const realWarn = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  let text;
  try {
    text = buildViewmasksSidecarJS(reg, pixels, 't');
  } finally {
    console.warn = realWarn;
  }
  const line = sidecarLine(text, 'Mixed');
  assert.match(line, /pixelIndices: \[0, 1, 2\]/,
    'group members (0,1) UNION clicked fixture (2) — nothing dropped');
  assert.ok(!line.includes('groups:'), 'the union form replaces the groups form');
  assert.match(line, /word: 1/, 'the word rides along');
  assert.ok(warns.some((w) => w.includes("'Mixed'") && w.includes('UNION')),
    'the mixed emission is announced loudly');
});

test('a redundant click INSIDE an attached group keeps the byte-stable groups form', () => {
  const reg = createViewRegistry({});
  reconcileGroupBits(reg, ['Bars']);
  const view = addCustomView(reg, 'Redundant');
  view.groups = ['Bars'];
  const pixels = [
    { name: 'Bar 1-1', group: 'Bars', vMask: 0, vMaskHi: view.bit }, // click ⊂ group
    { name: 'Bar 1-2', group: 'Bars', vMask: 0, vMaskHi: 0 },
  ];
  const line = sidecarLine(buildViewmasksSidecarJS(reg, pixels, 't'), 'Redundant');
  assert.match(line, /groups: \['Bars'\]/, 'membership identical ⇒ stable emission');
  assert.ok(!line.includes('pixelIndices'));
});

test('mixed emission still validates group existence (unknown group throws, not union)', () => {
  const reg = createViewRegistry({});
  reconcileGroupBits(reg, ['Alive']);
  const view = addCustomView(reg, 'Bad Mix');
  view.groups = ['Dead'];
  const pixels = [{ name: 'p', group: 'Alive', vMask: 0, vMaskHi: view.bit }];
  assert.throws(() => buildViewmasksSidecarJS(reg, pixels, 't'),
    /references group 'Dead'/);
});

test('mixed union works in word 0 too (both words, same rule)', () => {
  const reg = createViewRegistry({ custom: [{ name: 'Lo Mixed', bit: 0x100, groups: ['Bars'] }] });
  reconcileGroupBits(reg, ['Bars', 'Rail']);
  const view = reg.custom[0];
  const pixels = [
    { name: 'Bar 1-1', group: 'Bars', vMask: 0, vMaskHi: 0 },
    { name: 'Rail 1-1', group: 'Rail', vMask: 0x100, vMaskHi: 0 },
  ];
  const line = sidecarLine(buildViewmasksSidecarJS(reg, pixels, 't'), 'Lo Mixed');
  assert.match(line, /pixelIndices: \[0, 1\]/);
  assert.ok(!line.includes('word:'), 'word-0 emission keeps the legacy shape');
});

// ── 2. setCustomViewSlot: membership follows the view when fixtures are passed

test('a SAME-WORD move with the fixtures list migrates the bit (it was silently ignored)', () => {
  const reg = createViewRegistry({});
  const view = addCustomView(reg, 'Movable'); // word 1, bit 0x1
  const member = { name: 'M' };
  const outsider = { name: 'O' };
  setFixtureInView(member, view, true);
  const old = setCustomViewSlot(reg, view, 1, 0x40, [member, outsider, null]);
  assert.deepEqual(old, { word: 1, bit: 0x1 });
  assert.equal(member.viewMaskHi, 0x40, 'membership moved to the new bit');
  assert.equal((member.viewMaskHi || 0) & 0x1, 0, 'nothing stranded on the old bit');
  assert.equal(outsider.viewMaskHi || 0, 0, 'a non-member gained nothing');
});

test('a same-word move WITHOUT the list keeps the legacy caller-migrates contract', () => {
  const reg = createViewRegistry({});
  const view = addCustomView(reg, 'Manual');
  const member = { name: 'M' };
  setFixtureInView(member, view, true);
  const old = setCustomViewSlot(reg, view, 1, 0x20);
  assert.equal(member.viewMaskHi, old.bit, 'untouched — the caller migrates from the returned bit');
});

test('the panel-style manual migration after an internal one is a harmless no-op', () => {
  // A caller that BOTH passes fixtures AND then migrates manually (the
  // setCustomViewBit pattern) must not corrupt anything.
  const reg = createViewRegistry({});
  const view = addCustomView(reg, 'Both');
  const member = { name: 'M' };
  setFixtureInView(member, view, true);
  const old = setCustomViewSlot(reg, view, 1, 0x10, [member]);
  // Manual pass, exactly as the Views panel does with the returned old bit:
  if ((member.viewMaskHi || 0) & old.bit) {
    member.viewMaskHi = ((member.viewMaskHi || 0) & ~old.bit) | view.bit;
  }
  assert.equal(member.viewMaskHi, 0x10);
});

test('a refused move (destination collision) never half-applies, with or without fixtures', () => {
  const reg = createViewRegistry({ custom: [{ name: 'Blocker', bit: 0x4 }] });
  const view = addCustomView(reg, 'Mover'); // w1 bit 1
  const member = { name: 'M' };
  setFixtureInView(member, view, true);
  assert.throws(() => setCustomViewSlot(reg, view, 0, 0x4, [member]),
    /already taken by another group or view in word 0/);
  assert.equal(member.viewMaskHi, 0x1, 'fixture untouched');
  assert.equal((member.viewMask || 0), 0);
  assert.equal(view.word, 1);
  assert.equal(view.bit, 0x1);
});

// ── 3. Rename snapshot: the live config is authoritative, zeros included ────

test('snapshotViewMasks: a live UNASSIGN (zeros) beats a stale non-zero patch-tree row', () => {
  // The playa sequence: assign → (projection copies masks into the patch
  // tree) → unassign in the Views panel → rename BEFORE the next projection.
  const patchTree = {
    'Ring 1': { controllerIp: '', viewMask: 0, viewMaskHi: 0x400 }, // STALE
  };
  const live = [{ name: 'Ring 1', viewMask: 0, viewMaskHi: 0 }]; // operator unassigned
  const snap = snapshotViewMasks(patchTree, live, ['Ring 1']);
  assert.equal(snap.has('Ring 1'), false,
    'the removed membership must NOT survive into the rename carry');
  // And therefore carryViewMasks stamps nothing onto the new name.
  const configs = new Map([['Ring 1 New', { name: 'Ring 1 New', viewMask: 0, viewMaskHi: 0 }]]);
  const carried = carryViewMasks(snap, configs, [{ from: 'Ring 1', to: 'Ring 1 New' }]);
  assert.equal(carried.length, 0);
  assert.equal(configs.get('Ring 1 New').viewMaskHi, 0);
});

test('snapshotViewMasks: patch-tree row still counts when no live config exists (post-prune carry)', () => {
  const patchTree = { 'Ghost 1': { viewMask: 0x8, viewMaskHi: 0x2 } };
  const snap = snapshotViewMasks(patchTree, [], ['Ghost 1']);
  assert.deepEqual(snap.get('Ghost 1'), { viewMask: 0x8, viewMaskHi: 0x2 });
});

test('snapshotViewMasks: a live non-zero mask overrides a DIFFERENT stale value', () => {
  const patchTree = { 'F 1': { viewMask: 0x8, viewMaskHi: 0 } };
  const live = [{ name: 'F 1', viewMask: 0, viewMaskHi: 0x1000 }];
  const snap = snapshotViewMasks(patchTree, live, ['F 1']);
  assert.deepEqual(snap.get('F 1'), { viewMask: 0, viewMaskHi: 0x1000 },
    'both words come from the live config, not merged with the stale row');
});

test('snapshotViewMasks: names outside the rename are ignored', () => {
  const patchTree = { A: { viewMask: 1 }, B: { viewMask: 2 } };
  const snap = snapshotViewMasks(patchTree, [], ['A']);
  assert.equal(snap.size, 1);
});

// ── 4. Exhaustion: loud refusals, never wraparound ──────────────────────────

test('62 custom slots allocate; the 63rd throws; no bit ever exceeds 0x40000000', () => {
  const reg = createViewRegistry({});
  const seen = new Set();
  for (let i = 0; i < MAX_VIEW_SLOTS; i++) {
    const v = addCustomView(reg, `V${i}`);
    assert.ok(v.bit > 0 && v.bit <= MAX_BIT && (v.bit & (v.bit - 1)) === 0);
    const key = `${v.word}:${v.bit}`;
    assert.ok(!seen.has(key), `slot ${key} handed out twice`);
    seen.add(key);
  }
  assert.equal(nextFreeSlot(reg), null);
  assert.throws(() => addCustomView(reg, 'One Too Many'), /Out of view-mask slots/);
});

test('the 32nd fixture group refuses loudly and names the word-0-only constraint', () => {
  const reg = createViewRegistry({});
  assert.throws(
    () => reconcileGroupBits(reg, Array.from({ length: 32 }, (_, i) => `G${i}`)),
    /base group bits live in word 0 only/);
});

// ── 5. Fuzz: random lifecycle churn preserves the invariants ────────────────

test('fuzz: 1500 random create/assign/move/regroup/delete ops — no orphan bit, no collision', () => {
  let seed = 0xBADC0DE;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const reg = createViewRegistry({});
  const fixtures = Array.from({ length: 12 }, (_, i) => ({ name: `F${i}`, group: `G${i % 4}` }));
  const realLog = console.log;
  const realWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};
  try {
    reconcileGroupBits(reg, ['G0', 'G1', 'G2', 'G3']);
    let created = 0;
    for (let step = 0; step < 1500; step++) {
      const op = Math.floor(rnd() * 6);
      try {
        if (op === 0 && reg.custom.length < 40) {
          addCustomView(reg, `Fz${created++}`);
        } else if (op === 1 && reg.custom.length) {
          const v = reg.custom[Math.floor(rnd() * reg.custom.length)];
          setFixtureInView(fixtures[Math.floor(rnd() * fixtures.length)], v, rnd() > 0.4);
        } else if (op === 2 && reg.custom.length) {
          const v = reg.custom[Math.floor(rnd() * reg.custom.length)];
          const slot = nextFreeSlot(reg, [Math.floor(rnd() * 2)]);
          if (slot) setCustomViewSlot(reg, v, slot.word, slot.bit, fixtures);
        } else if (op === 3 && reg.custom.length) {
          const v = reg.custom[Math.floor(rnd() * reg.custom.length)];
          for (const f of fixtures) setFixtureInView(f, v, false);
          removeCustomView(reg, v);
        } else if (op === 4 && reg.custom.length) {
          const v = reg.custom[Math.floor(rnd() * reg.custom.length)];
          v.groups = rnd() > 0.5 ? ['G0'] : [];
        } else if (op === 5) {
          const gs = ['G0', 'G1', 'G2', 'G3'].filter(() => rnd() > 0.2);
          if (gs.length) {
            reconcileGroupBits(reg, gs);
            for (const f of fixtures) if (!gs.includes(f.group)) f.group = gs[0];
          }
        }
      } catch (e) {
        // Loud refusals are legal outcomes of hostile sequences; anything
        // that is not a [Views] refusal is a real failure.
        if (!/\[Views\]/.test(e.message)) throw e;
      }
      // Invariants after EVERY op:
      const perWord = [new Set(), new Set()];
      for (const bit of Object.values(reg.groupBits)) {
        assert.ok(!perWord[0].has(bit), 'group bit collision in word 0');
        perWord[0].add(bit);
      }
      for (const v of reg.custom) {
        const w = viewWord(v);
        assert.ok(v.bit > 0 && v.bit <= MAX_BIT && (v.bit & (v.bit - 1)) === 0);
        assert.ok(!perWord[w].has(v.bit), `bit collision in word ${w}`);
        perWord[w].add(v.bit);
      }
      const w1bits = reg.custom.filter((v) => viewWord(v) === 1)
        .reduce((m, v) => m | v.bit, 0);
      const w0bits = usedBitsMask(reg, 0);
      for (const f of fixtures) {
        assert.equal((f.viewMaskHi || 0) & ~w1bits, 0,
          `orphan word-1 bit on ${f.name}`);
        assert.equal((f.viewMask || 0) & ~w0bits, 0,
          `orphan word-0 bit on ${f.name}`);
      }
    }
  } finally {
    console.log = realLog;
    console.warn = realWarn;
  }
});
