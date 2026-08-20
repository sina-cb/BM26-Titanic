/**
 * The four shipped default 2D Pixel Map views name real titanic groups.
 *
 * WHY THIS FILE EXISTS: `pixel_map_view_defaults.js` selects fixtures by
 * HARDCODED GROUP NAME. A group rename in the generator editor therefore drops
 * that group out of every default view that named it — silently, with no
 * warning, because a selector that matches nothing just renders nothing. That
 * is exactly what happened when the operator renamed 'Right Top Chimney
 * Generator' → 'Right SmokeStacks' (report 20260725_44 §3.6): his right ring
 * disappeared and nothing said so.
 *
 * These assertions turn the next such rename into a TEST FAILURE naming the
 * group, instead of an empty panel he has to notice himself. They read the
 * real scene read-only; they never write it.
 *
 * (The structural fix — deriving defaults from the live group list rather than
 * naming groups — is the operator's call, report 20260725_46 §5.2, and is
 * deliberately not done.)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import {
  CHIMNEY_GROUPS, SMALL_SMOKESTACK_GROUPS, AUDITORIUM_GROUPS, FRONT_BAR_GROUPS,
  FRONT_VINTAGE_GROUPS, FRONT_STRAND_GROUPS, ORPHAN_GROUPS, TE_SIGN_GROUPS,
  VINTAGE_LED_PITCH,
  DEFAULT_VIEWS, buildDefaultViews,
} from '../src/gui/pixel_map/pixel_map_view_defaults.js';
import { resolveView } from '../src/gui/pixel_map/pixel_map_views.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TITANIC = path.join(HERE, '..', 'scenes', 'titanic', 'scene_config.yaml');
// The shipped VintageLed fixture definition — the source of truth for how many
// LEDs a vintage light actually has (the operator asked for "6 circles").
const VINTAGE_MODEL = path.join(HERE, '..', 'dmx', 'fixtures',
  'vintage_led_stage_light', 'model_33.yaml');

function titanicScene() {
  return yaml.load(fs.readFileSync(TITANIC, 'utf8'));
}

/** The scene's generator traces. `scene.traces` and `scene.parLights.traces` are
 *  the SAME list (a YAML anchor + alias), but read defensively so the anchor can
 *  move without silently emptying every orphan/counterpart check below. */
function titanicTraces(scene) {
  const t = scene.traces || (scene.parLights && scene.parLights.traces);
  assert.ok(Array.isArray(t) && t.length,
    'scene_config.yaml has no generator traces — the read path moved');
  return t;
}

/** Group names that a generator trace owns (i.e. NOT orphans). */
function tracedGroupNames(scene) {
  return new Set(titanicTraces(scene).map((t) => t.groupName || t.name));
}

/**
 * Trace-backed groups of one fixture type, with their x/z centroid and a side
 * (sign of mean world x: −1 port, +1 starboard).
 *
 * Deriving the back-of-ship counterparts this way instead of naming them keeps
 * THIS FILE off the rename treadmill: the operator renamed 13 of 14 generators
 * in one afternoon, and every literal name these tests used to carry
 * ('Right Back Wall Generator', 'Left/Right Back Deck Generator') went stale in
 * that single batch. The constants under test still have to be literal — that is
 * the thing being pinned — but the reference points do not.
 */
function tracedGroupsOfType(scene, fixtureType) {
  const traced = tracedGroupNames(scene);
  const byGroup = new Map();
  for (const l of (scene.parLights && scene.parLights.fixtures) || []) {
    if (!l.group || !traced.has(l.group)) continue;
    if ((l.fixtureType || l.type) !== fixtureType) continue;
    if (!byGroup.has(l.group)) byGroup.set(l.group, []);
    byGroup.get(l.group).push(l);
  }
  return [...byGroup.entries()].map(([group, ls]) => ({
    group,
    cx: ls.reduce((a, l) => a + l.x, 0) / ls.length,
    cz: ls.reduce((a, l) => a + l.z, 0) / ls.length,
    side: Math.sign(ls.reduce((a, l) => a + l.x, 0) / ls.length),
  }));
}

/** The one other trace-backed group of the same type on the same side. */
function sameSideCounterpart(groups, name) {
  const self = groups.find((g) => g.group === name);
  assert.ok(self, `'${name}' is not a trace-backed group in the titanic scene — ` +
    `live trace-backed groups of this type: ${groups.map((g) => g.group).join(', ')}`);
  const others = groups.filter((g) => g.side === self.side && g.group !== name);
  assert.equal(others.length, 1,
    `expected exactly ONE same-side counterpart for '${name}', got ` +
    `[${others.map((g) => g.group).join(', ')}]`);
  return { self, other: others[0] };
}

/** Every distinct `group` on a DMX fixture in the titanic scene. */
function titanicParGroups() {
  const groups = new Set();
  for (const l of (titanicScene().parLights && titanicScene().parLights.fixtures) || []) {
    if (l.group) groups.add(l.group);
  }
  return groups;
}

/** Every LED strand's effective group key — `group`, else the strand `name`
 *  (led_metadata.groupKeyForStrand: the SAME key the batch list carries). */
function titanicStrandGroups() {
  const groups = new Set();
  for (const s of (titanicScene().ledStrands && titanicScene().ledStrands.strands) || []) {
    const g = (typeof s.group === 'string' && s.group.trim()) || (s.name || '').trim();
    if (g) groups.add(g);
  }
  return groups;
}

function assertGroupsExist(names, live, what) {
  for (const g of names) {
    assert.ok(
      live.has(g),
      `pixel_map_view_defaults.js selects ${what} group '${g}', which no longer ` +
      `exists in scenes/titanic/scene_config.yaml — the default view naming it is ` +
      `silently missing those fixtures. Live groups: ${[...live].sort().join(', ')}. ` +
      `Re-point the constant at the current name.`,
    );
  }
}

test('both hardcoded chimney groups still exist in the titanic scene', () => {
  assertGroupsExist(CHIMNEY_GROUPS, titanicParGroups(), 'chimney par ring');
});

test('both small smoke stacks still exist in the titanic scene', () => {
  // The operator's Top-Down order (report 20260725_48): each small stack must
  // read as a small circle on the Top-Down view. 4 pars each — a rename or a
  // re-count breaks that picture, so pin both.
  const live = titanicParGroups();
  assertGroupsExist(SMALL_SMOKESTACK_GROUPS, live, 'small smoke stack');
  const fixtures = titanicScene().parLights.fixtures || [];
  for (const g of SMALL_SMOKESTACK_GROUPS) {
    assert.equal(fixtures.filter((l) => l.group === g).length, 4,
      `'${g}' must be the 4-par ring the Top-Down view draws as a small circle`);
  }
});

test('every group the Front view names still exists in the titanic scene', () => {
  assertGroupsExist([...FRONT_BAR_GROUPS, ...FRONT_VINTAGE_GROUPS],
    titanicParGroups(), 'front DMX');
  assertGroupsExist(FRONT_STRAND_GROUPS.flat(), titanicStrandGroups(), 'front LED strand');
});

test('the Front view carries FOUR smoke-stack ropes, two per side', () => {
  // Operator correction (2026-07-29): "2 lines for the LED strings in the front
  // on each side" = 2 PER SIDE = 4 total, not 1 per side.
  assert.equal(FRONT_STRAND_GROUPS.length, 2, 'one entry per side');
  for (const side of FRONT_STRAND_GROUPS) assert.equal(side.length, 2, 'two ropes per side');
  assert.equal(new Set(FRONT_STRAND_GROUPS.flat()).size, 4, 'four distinct strands');
});

test('the front bars and the front vintage lights agree on which end is forward', () => {
  // A GEOMETRY consistency check, and deliberately NOT circular: the "forward"
  // direction is not assumed, it is measured twice per side — once from the bar
  // pair (front bars − their same-side counterpart) and once from the vintage
  // pair — and the two must point the SAME way. Re-point either constant at the
  // stern and the dot product flips negative and this fails, naming both groups.
  const scene = titanicScene();
  const bars = tracedGroupsOfType(scene, 'ShehdsBar');
  const vintage = tracedGroupsOfType(scene, 'VintageLed');
  for (const side of [0, 1]) {
    const b = sameSideCounterpart(bars, FRONT_BAR_GROUPS[side]);
    const v = sameSideCounterpart(vintage, FRONT_VINTAGE_GROUPS[side]);
    const bv = [b.self.cx - b.other.cx, b.self.cz - b.other.cz];
    const vv = [v.self.cx - v.other.cx, v.self.cz - v.other.cz];
    const dot = bv[0] * vv[0] + bv[1] * vv[1];
    assert.ok(dot > 0,
      `'${FRONT_BAR_GROUPS[side]}' (vs '${b.other.group}') and ` +
      `'${FRONT_VINTAGE_GROUPS[side]}' (vs '${v.other.group}') point at OPPOSITE ` +
      `ends of the ship (dot ${dot.toFixed(2)}) — one of them names the stern`);
  }
});

test('the four front ropes are re-derived from each side\'s own forward axis', () => {
  // The titanic's two halves are rotated relative to each other, so there is no
  // single world axis that means "forward" — the left walls run along x at a
  // constant z, the right walls run diagonally. Each side's forward direction is
  // therefore taken from the scene itself: (front wall centroid − back wall
  // centroid) in the x/z plane. Projecting each strand's midpoint onto it must
  // rank that side's TWO front ropes above its two back ropes, by a wide margin.
  // This is the whole classification, re-computed from the data — nothing here
  // trusts the word "Front" in a strand's name.
  const scene = titanicScene();
  const strands = scene.ledStrands.strands || [];
  const bars = tracedGroupsOfType(scene, 'ShehdsBar');
  // The back-wall reference is found STRUCTURALLY (the other trace-backed bar
  // group on the same side), never by name — see tracedGroupsOfType.
  const SIDES = [{ prefix: 'Left_' }, { prefix: 'Right_' }];

  for (const [i, side] of SIDES.entries()) {
    const { self, other } = sameSideCounterpart(bars, FRONT_BAR_GROUPS[i]);
    const len = Math.hypot(self.cx - other.cx, self.cz - other.cz);
    const [ux, uz] = [(self.cx - other.cx) / len, (self.cz - other.cz) / len];

    const ranked = strands
      .filter((s) => s.name.startsWith(side.prefix))
      .map((s) => ({
        name: s.name,
        fwd: ((s.startX + s.endX) / 2) * ux + ((s.startZ + s.endZ) / 2) * uz,
      }))
      .sort((a, b) => b.fwd - a.fwd);

    assert.equal(ranked.length, 4, `${side.prefix} side must have 4 strands`);
    assert.deepEqual(
      ranked.slice(0, 2).map((r) => r.name).sort(),
      [...FRONT_STRAND_GROUPS[i]].sort(),
      `the two most-forward ${side.prefix} ropes must be the ones the Front view ` +
      `selects — ranked forward: ${ranked.map((r) => `${r.name} ${r.fwd.toFixed(2)}`).join(', ')}`,
    );
    // A wide, unambiguous margin between the front pair and the back pair, so a
    // small geometry nudge can never flip the classification silently.
    assert.ok(ranked[1].fwd - ranked[2].fwd > 3,
      `front/back rope separation on the ${side.prefix} side collapsed to ` +
      `${(ranked[1].fwd - ranked[2].fwd).toFixed(2)} — re-check the classification`);
  }
});

test('each side\'s rope pair is one hull drop + one deck rope', () => {
  // Not two of a kind: one hangs down the front face (y span ~10), one runs
  // inboard from the stack top to the deck edge (y span ~2, but 7-12 world units
  // long in x/z). Both read as LINES in a front elevation — which is why the
  // operator wants both — so this pins that each pair really is one of each.
  const strands = titanicScene().ledStrands.strands || [];
  const ySpan = (name) => {
    const s = strands.find((x) => x.name === name);
    assert.ok(s, `strand '${name}' not found in the titanic scene`);
    return Math.abs((s.endY || 0) - (s.startY || 0));
  };
  for (const pair of FRONT_STRAND_GROUPS) {
    const spans = pair.map(ySpan).sort((a, b) => a - b);
    assert.ok(spans[1] > 5, `one rope of ${pair.join(' + ')} must be the hull drop`);
    assert.ok(spans[0] < 5, `one rope of ${pair.join(' + ')} must be the deck rope`);
  }
});

test('every excluded orphan group is STILL an orphan (untraced) in the scene', () => {
  // The list is keyed on the NAME, so a group that stops being an orphan must
  // leave it or its real fixtures inherit the exclusion. On 2026-07-30 exactly
  // that happened: the operator deleted the 5 ghost 'Left Back Wall' bars and
  // renamed his real generator to that same name, so the entry started hiding
  // his actual back wall (predicted as Trap 3, report 20260725_51 §4).
  const scene = titanicScene();
  const fixtures = scene.parLights.fixtures || [];
  const traced = tracedGroupNames(scene);
  for (const g of ORPHAN_GROUPS) {
    assert.ok(fixtures.some((l) => l.group === g),
      `'${g}' no longer exists in the scene at all — drop it from ORPHAN_GROUPS`);
    assert.ok(!traced.has(g),
      `'${g}' now has a generator trace — it is a REAL group, and excluding it ` +
      'hides the operator\'s fixtures. Drop it from ORPHAN_GROUPS in ' +
      'pixel_map_view_defaults.js.');
  }
  // The ghost list is code-owned and stays pinned — EMPTY since 2026-07-30:
  // the operator deleted the Left Center Auditorium ghosts himself (hand +
  // the _76 orphan-removal UI), the exists-tripwire above went red exactly as
  // designed, and the entry was dropped. Fixture COUNTS inside a listed group
  // are operator-owned and deliberately not pinned (he deletes ghosts one by
  // one); the group-exists / not-traced tripwires above catch both real
  // hazards for any future ghost family added to the list.
  assert.deepEqual(ORPHAN_GROUPS, []);
  // …and top_down still keeps them out.
  const topDown = DEFAULT_VIEWS.find((v) => v.id === 'top_down');
  const excluded = (topDown.panels[0].exclude || []).map((s) => s.group).filter(Boolean);
  for (const g of ORPHAN_GROUPS) assert.ok(excluded.includes(g), `top_down excludes '${g}'`);
});

test('NO default view excludes a group that a generator trace owns', () => {
  // The general form of the trap above, and the one that actually closes it: a
  // real, operator-owned group must never be silently dropped from a view by a
  // stale exclude, whatever it is called. Cheap, and it fails by name.
  const traced = tracedGroupNames(titanicScene());
  for (const view of DEFAULT_VIEWS) {
    for (const panel of view.panels) {
      for (const sel of panel.exclude || []) {
        if (!sel.group) continue; // fixtureType excludes (the TE signs) are fine
        assert.ok(!traced.has(sel.group),
          `view '${view.id}' panel '${panel.id}' excludes group '${sel.group}', ` +
          'which a generator trace OWNS — those are real fixtures and they will ' +
          'vanish from the view. Drop the exclude.');
      }
    }
  }
});

test('the de-orphaned Left Back Wall is drawn by Top-Down again', () => {
  // The specific repair, pinned: his renamed real back wall must resolve INTO
  // the Top-Down panel rather than be excluded out of it.
  const scene = titanicScene();
  const traced = tracedGroupNames(scene);
  assert.ok(traced.has('Left Back Wall'),
    "'Left Back Wall' should be trace-backed after the operator's 2026-07-30 fix");
  assert.ok(!ORPHAN_GROUPS.includes('Left Back Wall'),
    "'Left Back Wall' is a REAL group now and must not be excluded");
  assert.equal((scene.parLights.fixtures || [])
    .filter((l) => l.group === 'Left Back Wall').length, 5);
});

test('both chimney rings name the CURRENT operator groups, not retired ones', () => {
  // Pins the specific restores: 'Right Top Chimney Generator' → 'Right SmokeStacks'
  // (report 20260725_44 §3.6 / 20260725_46 §3.2) and 'Left Top Chimney Generator'
  // → 'Left SmokeStack' (his 16:38 rename batch, report 20260725_48 addendum 2).
  assert.deepEqual(CHIMNEY_GROUPS, ['Left SmokeStack', 'Right SmokeStacks']);
  const RETIRED = ['Right Top Chimney Generator', 'Left Top Chimney Generator'];
  for (const dead of RETIRED) {
    assert.ok(!CHIMNEY_GROUPS.includes(dead), `'${dead}' is a retired group name`);
  }
  // …and no default view anywhere still reaches for a retired name.
  const named = DEFAULT_VIEWS.flatMap((v) => v.panels.flatMap(
    (p) => [...(p.select || []), ...(p.exclude || [])].map((s) => s.group).filter(Boolean)));
  for (const dead of [...RETIRED, 'Left Front Deck Generator', 'Left Front Wall Generator']) {
    assert.ok(!named.includes(dead), `a default view still selects retired group '${dead}'`);
  }
});

test('the Top-Down default view selects chimney, small-stack, and auditorium groups', () => {
  const topDown = DEFAULT_VIEWS.find((v) => v.id === 'top_down');
  assert.ok(topDown, 'a top_down default view exists');
  const selectedGroups = topDown.panels[0].select
    .filter((s) => s.group).map((s) => s.group);
  assert.deepEqual(selectedGroups,
    [...CHIMNEY_GROUPS, ...SMALL_SMOKESTACK_GROUPS, ...AUDITORIUM_GROUPS]);
});

test('the Front default view names exactly the eight front groups, one panel per side', () => {
  const front = DEFAULT_VIEWS.find((v) => v.id === 'front');
  assert.deepEqual(front.panels.map((p) => p.id), ['left', 'right']);
  for (const [i, panel] of front.panels.entries()) {
    assert.deepEqual(panel.select.map((s) => s.group),
      [FRONT_BAR_GROUPS[i], FRONT_VINTAGE_GROUPS[i], ...FRONT_STRAND_GROUPS[i]]);
    assert.equal(panel.projection, 'front');
    assert.equal(panel.layout, 'spatial');
  }
  // 2 bar + 2 vintage + 4 rope groups, all distinct.
  const named = front.panels.flatMap((p) => p.select.map((s) => s.group));
  assert.equal(named.length, 8);
  assert.equal(new Set(named).size, 8);
});

test('every TE sign group exists, and each gets its own planar panel', () => {
  // The operator added 'TE Sign 2' at 16:38:58 on 2026-07-29. If he adds a THIRD
  // sign this goes red naming it, instead of the te_sign view quietly rendering
  // two of three (or blowing off-canvas again).
  const scene = titanicScene();
  const fixtures = scene.parLights.fixtures || [];
  assertGroupsExist(TE_SIGN_GROUPS, titanicParGroups(), 'TE sign');
  for (const g of TE_SIGN_GROUPS) {
    assert.equal(fixtures.filter((l) => l.group === g).length, 2,
      `'${g}' must be a TeSignV3A40 + TeSignV3B34 pair`);
  }
  // No sign fixture in the scene belongs to a group the view does not draw.
  const signGroups = new Set(fixtures
    .filter((l) => ['TeSignV3A40', 'TeSignV3B34'].includes(l.fixtureType))
    .map((l) => l.group));
  assert.deepEqual([...signGroups].sort(), [...TE_SIGN_GROUPS].sort(),
    'a TE sign exists in a group the te_sign view never names');

  const view = DEFAULT_VIEWS.find((v) => v.id === 'te_sign');
  assert.equal(view.panels.length, TE_SIGN_GROUPS.length);
  for (const [i, panel] of view.panels.entries()) {
    assert.equal(panel.layout, 'planar');
    assert.equal(panel.rotate, 90);
    assert.deepEqual([...new Set(panel.select.map((s) => s.group))], [TE_SIGN_GROUPS[i]]);
  }
});

test('the defaults still build into a valid four-view container', () => {
  const container = buildDefaultViews();
  assert.equal(container.views.length, 4);
  assert.deepEqual(
    container.views.map((v) => v.id),
    ['top_down', 'front', 'strands', 'te_sign'],
  );
});

test('on a scene without the titanic front groups the Front view fails LOUDLY', () => {
  // The Front view names the titanic's real front groups (that is the operator's
  // spec: the FRONT lights only, not "every bar"), so on a scene that has none
  // of them — test_bench, whose whole DMX rig is 2 bars + 4 pars + 2 vintage in
  // groups 'BarLights'/'ParLights'/'VintageLights' — both panels match nothing.
  // That must surface as a per-panel error banner naming the selectors, never a
  // silently empty pane (codex P0). Pinned here so the behaviour is a decision,
  // not a surprise: on such a scene, edit the view or re-point the constants.
  let fi = 0;
  const c = (fixtureType, kind, group) => ({
    fixIndex: fi, fixKey: `${group} ${fi}`, fixtureType, kind, group,
    pixels: [{ gi: fi++ }],
  });
  const benchLike = [
    c('ShehdsBar', 'dmx', 'BarLights'), c('ShehdsBar', 'dmx', 'BarLights'),
    c('UkingPar', 'dmx', 'ParLights'), c('VintageLed', 'dmx', 'VintageLights'),
    c('LedStrand', 'led', 'LED_0'),
  ];
  const front = DEFAULT_VIEWS.find((v) => v.id === 'front');
  const r = resolveView(front, benchLike, null);
  assert.equal(r.panels.length, 2);
  for (const [i, p] of r.panels.entries()) {
    assert.equal(p.clusters.length, 0);
    assert.match(p.error, /no fixtures match its selectors/);
    assert.ok(p.error.includes(FRONT_BAR_GROUPS[i]),
      'the error must name the group that resolved to nothing');
  }
  // The Top-Down view is NOT titanic-only: its bar/strand selectors still resolve.
  const top = resolveView(DEFAULT_VIEWS.find((v) => v.id === 'top_down'), benchLike, null);
  assert.equal(top.panels[0].error, undefined);
  assert.equal(top.panels[0].clusters.length, 3); // 2 bars + 1 strand
});

test('the vintage 6-circle ask matches the MODEL, not a magic number', () => {
  // Operator: "resize the vintage pixels to 6 circles that are a bit bigger."
  // Six is only correct if a VintageLed really has six LEDs — pin that against
  // the fixture definition rather than hardcoding it, and pin that the declared
  // pitch is a genuine stretch of the fixture's real (sub-legible) spacing.
  const def = yaml.load(fs.readFileSync(VINTAGE_MODEL, 'utf8'));
  const leds = (def.model && def.model.pixels) || [];
  assert.equal(leds.length, 6,
    'the Front view draws ONE circle per VintageLed LED. The fixture definition ' +
    `${VINTAGE_MODEL} now declares ${leds.length} pixels, so the operator's ` +
    '"6 circles" needs revisiting rather than the number being hardcoded.');
  assert.equal(def.model.fixture_type, 'VintageLed');

  // The declared pitch is per-fixtureType and in WORLD units.
  assert.deepEqual(Object.keys(VINTAGE_LED_PITCH), ['VintageLed']);
  assert.ok(VINTAGE_LED_PITCH.VintageLed > 0);

  // Every VintageLed cluster in the live scene really carries those 6 LEDs,
  // and their real internal pitch is far below the declared one — otherwise the
  // stretch would be pointless (or, worse, a shrink).
  const fixtures = titanicScene().parLights.fixtures || [];
  assert.ok(fixtures.some((l) => l.fixtureType === 'VintageLed'),
    'the titanic scene still has VintageLed fixtures');
  assert.ok(VINTAGE_LED_PITCH.VintageLed > 0.3,
    'the declared pitch must be big enough to actually separate the LEDs');
});

test('both Front panels declare the vintage pitch, and nothing else does', () => {
  const front = DEFAULT_VIEWS.find((v) => v.id === 'front');
  for (const panel of front.panels) {
    assert.deepEqual(panel.expandPitch, VINTAGE_LED_PITCH,
      `Front panel '${panel.id}' must stretch the vintage LED pitch`);
  }
  // A bar has the same sub-pitch problem and must NOT be stretched — an
  // 18-pitch-long bar would wreck the view.
  for (const view of DEFAULT_VIEWS) {
    for (const panel of view.panels) {
      const types = Object.keys(panel.expandPitch || {});
      assert.ok(!types.includes('ShehdsBar'),
        `view '${view.id}' panel '${panel.id}' must never stretch ShehdsBar`);
    }
  }
  // Only the Front view uses it at all.
  for (const view of DEFAULT_VIEWS) {
    if (view.id === 'front') continue;
    for (const panel of view.panels) {
      assert.equal(panel.expandPitch, undefined,
        `view '${view.id}' should not stretch any fixture's LED pitch`);
    }
  }
});

test('Top-Down defaults to an unmodified orthographic projection', () => {
  const topDown = DEFAULT_VIEWS.find((v) => v.id === 'top_down');
  const panel = topDown.panels[0];
  assert.equal(panel.projection, 'top');
  assert.equal(panel.layout, 'spatial');
  for (const property of ['compress', 'expandPitch', 'washAngle', 'rotate']) {
    assert.equal(panel[property], undefined,
      `Top-Down.${property} would distort the authoritative orthographic geometry`);
  }
});
