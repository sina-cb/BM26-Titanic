// COLORS-window engine surface — E1 inline palette pairs + the saved colour-pair
// gallery (docs/53 §4 "SAVE PAIR", §5.3 engine slice E1).
//
// Spawns ONE engine on a random HIGH port (never :6968 — the live stack) with
// MARSIN_STATE_DIR / MARSIN_PLAYLISTS_DIR redirected into throwaway temp dirs
// and its sACN output black-holed on TEST-NET-1 (192.0.2.9, RFC 5737), so
// nothing this suite does can reach the operator's running rig or sim bridge.
//
// What it proves:
//   E1  - POST /deck/color-autopilot accepts INLINE {c1,c2} pairs (PALETTE
//         TURNS), round-trips them on GET, and still accepts library ids and a
//         MIXED set; a malformed pair / unknown id is refused LOUDLY with 400
//         and the live config is left untouched.
//   E1  - an ACTIVE inline-pair config actually resolves: the daemon's first
//         switch writes colorPalette1/2 from the pair's hues.
//   PAIRS - GET/POST /color-pairs round-trips through the SCENE state dir
//         (color_pairs_state.yaml — shared by every iPad), rejects malformed
//         input, and survives as a file the next GET reads back.
//
// Run: node --test tests/effects/color_window_engine_api.test.js
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

import { createEngineHarness } from '../helpers/spawn_engine.mjs';

const SCENE = 'test_bench';
// The store's wire/file schema version (_242). Pinned here so a bump has to be
// a deliberate edit on both sides rather than a silently-accepted drift.
const SCHEMA_V = 2;

const h = createEngineHarness({
  scene: SCENE,
  pattern: '01_cylon_sweep',
  prefix: 'marsin-colorwin',
  // Random high port well away from the live :6968.
  portBase: 7400,
  portSpan: 200,
  // Black-hole the spawned engine's sACN output on a TEST-NET-1 (RFC 5737)
  // address. A LOOPBACK destination is NOT isolation: the sim's sACN receiver
  // binds every interface, so 127.0.0.x frames land on the operator's live
  // bridge (.agent/memory/spawning_a_test_engine.md).
  extraArgs: ['--dest', '192.0.2.9'],
});
const { api, stateDir } = h;

before(async () => {
  h.spawnEngine();
  await h.waitForReady();
});
after(async () => { await h.teardown(); });

// ── E1: inline pairs on the colour autopilot ────────────────────────────────

test('POST /deck/color-autopilot accepts five INLINE pairs and GET round-trips them', async () => {
  const palettes = [
    { c1: 0.07, c2: 0.00 },
    { c1: 0.00, c2: 0.62 },
    { c1: 0.62, c2: 0.28 },
    { c1: 0.28, c2: 0.74 },
    { c1: 0.74, c2: 0.07 },
  ];
  const post = await api('POST', '/deck/color-autopilot', {
    active: false, shuffle: false, delay_s: 30, transitionMs: 3000, palettes,
  });
  assert.equal(post.status, 200, JSON.stringify(post.data));
  assert.deepEqual(post.data.palettes, palettes);
  assert.equal(post.data.transitionMs, 3000);

  const get = await api('GET', '/deck/color-autopilot');
  assert.equal(get.status, 200);
  assert.deepEqual(get.data.palettes, palettes);
});

test('library ids still work, and so does a MIXED id + inline set', async () => {
  const lib = await api('GET', '/color-palettes');
  assert.equal(lib.status, 200);
  assert.ok(Array.isArray(lib.data) && lib.data.length > 0, 'rig has a palette library');
  const id = lib.data[0].id;

  const ids = await api('POST', '/deck/color-autopilot', { active: false, palettes: [id], delay_s: 30 });
  assert.equal(ids.status, 200, JSON.stringify(ids.data));
  assert.deepEqual(ids.data.palettes, [id]);

  const mixed = await api('POST', '/deck/color-autopilot', {
    active: false, palettes: [id, { c1: 0.5, c2: 1 }], delay_s: 30,
  });
  assert.equal(mixed.status, 200, JSON.stringify(mixed.data));
  assert.deepEqual(mixed.data.palettes, [id, { c1: 0.5, c2: 1 }]);
});

test('a malformed inline pair is REFUSED loudly and leaves the live config alone', async () => {
  const before_ = await api('GET', '/deck/color-autopilot');

  const bad = await api('POST', '/deck/color-autopilot', {
    active: false, palettes: [{ c1: 1.5, c2: 0.2 }], delay_s: 30,
  });
  assert.equal(bad.status, 400);
  assert.match(String(bad.data.error), /c1 must be a hue number in \[0,1\]/);

  const junk = await api('POST', '/deck/color-autopilot', {
    active: false, palettes: [{ c1: 0.2 }], delay_s: 30,
  });
  assert.equal(junk.status, 400);
  assert.match(String(junk.data.error), /c2 must be a hue number/);

  const unknown = await api('POST', '/deck/color-autopilot', {
    active: false, palettes: ['definitely_not_a_palette'], delay_s: 30,
  });
  assert.equal(unknown.status, 400);
  assert.match(String(unknown.data.error), /is not a known palette id/);

  const after_ = await api('GET', '/deck/color-autopilot');
  assert.deepEqual(after_.data.palettes, before_.data.palettes);
});

test('an ACTIVE inline-pair rotation actually paints: the first switch writes the pair hues', async () => {
  // delay_s is clamped >0 by the validator; a short one keeps the test quick.
  // transitionMs 0 = hard cut, so the write is the exact target (no ramp race).
  const pair = { c1: 0.33, c2: 0.66 };
  const post = await api('POST', '/deck/color-autopilot', {
    active: true, shuffle: false, delay_s: 0.4, transitionMs: 0, palettes: [pair],
  });
  assert.equal(post.status, 200, JSON.stringify(post.data));

  let seen = null;
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    const pc = await api('GET', '/param-center');
    const c1 = pc.data?.params?.colorPalette1?.value ?? pc.data?.colorPalette1;
    const c2 = pc.data?.params?.colorPalette2?.value ?? pc.data?.colorPalette2;
    if (c1 && c2 && Math.abs(c1.h - pair.c1) < 1e-6 && Math.abs(c2.h - pair.c2) < 1e-6) {
      seen = { c1, c2 };
      break;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  // Park the daemon before asserting so a failure doesn't leave it cycling.
  await api('POST', '/deck/color-autopilot', { active: false });
  assert.ok(seen, 'colorPalette1/2 never took the inline pair hues');
  assert.equal(seen.c1.s, 1);
  assert.equal(seen.c1.v, 1);
  assert.equal(seen.c2.s, 1);
  assert.equal(seen.c2.v, 1);
});

// ── D2 (docs/55 §1): FULL-HSV inline channels on the wire ──────────────────

test('POST accepts {h,s,v} pair channels and GET round-trips them verbatim', async () => {
  // A Live Touch HUE ring: ONE hue at five brightnesses. Inexpressible on the
  // hue-only wire, which is exactly why D2 widened the channel type.
  const MONO = [1.0, 0.78, 0.58, 0.40, 0.25];
  const ring = MONO.map((k, i) => ({
    c1: { h: 0.72, s: 0.95, v: k },
    c2: { h: 0.72, s: 0.95, v: MONO[(i + 1) % MONO.length] },
  }));
  const post = await api('POST', '/deck/color-autopilot', {
    active: false, shuffle: false, delay_s: 30, transitionMs: 1000, palettes: ring,
  });
  assert.equal(post.status, 200, JSON.stringify(post.data));
  const got = await api('GET', '/deck/color-autopilot');
  assert.deepEqual(got.data.palettes, ring, 'full-HSV entries survive the wire byte-for-byte');
  // (Persistence of the same entries through the runtime YAML is pinned in the
  // unit suite — color_autopilot.test.js "config persists across instances" —
  // which owns a scratch config file. This process shares the engine's real
  // runtime file with the operator's stack and must not read it.)
});

test('POST accepts delay_s 0 with a real fade, and REFUSES zero+zero', async () => {
  const cont = await api('POST', '/deck/color-autopilot', {
    active: false, shuffle: false, delay_s: 0, transitionMs: 1500,
    palettes: [{ c1: 0.1, c2: 0.6 }, { c1: 0.6, c2: 0.1 }],
  });
  assert.equal(cont.status, 200, JSON.stringify(cont.data));
  const got = await api('GET', '/deck/color-autopilot');
  assert.equal(got.data.delay_s, 0, 'CONT survives the round trip as a literal 0');

  const spin = await api('POST', '/deck/color-autopilot', { delay_s: 0, transitionMs: 0 });
  assert.equal(spin.status, 400);
  assert.match(String(spin.data.error), /delay_s 0 \(continuous\) requires transitionMs >= 100/);
});

test('a bad {h,s,v} CHANNEL is refused loudly, naming the channel', async () => {
  const before_ = await api('GET', '/deck/color-autopilot');
  const bad = await api('POST', '/deck/color-autopilot', {
    active: false, delay_s: 30, palettes: [{ c1: { h: 0.2, s: 1, v: 4 }, c2: 0.5 }],
  });
  assert.equal(bad.status, 400);
  assert.match(String(bad.data.error), /palettes\[0\]\.c1\.v must be a number in \[0,1\]/);
  const after_ = await api('GET', '/deck/color-autopilot');
  assert.deepEqual(after_.data.palettes, before_.data.palettes);
});

test('a full-HSV pair PAINTS its real s/v onto the CPC (not the s=v=1 pin)', async () => {
  const pair = { c1: { h: 0.33, s: 0.95, v: 0.4 }, c2: { h: 0.66, s: 0.5, v: 0.25 } };
  const post = await api('POST', '/deck/color-autopilot', {
    active: true, shuffle: false, delay_s: 0.4, transitionMs: 0, palettes: [pair],
  });
  assert.equal(post.status, 200, JSON.stringify(post.data));

  let seen = null;
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    const pc = await api('GET', '/param-center');
    const c1 = pc.data?.params?.colorPalette1?.value ?? pc.data?.colorPalette1;
    const c2 = pc.data?.params?.colorPalette2?.value ?? pc.data?.colorPalette2;
    if (c1 && c2 && Math.abs(c1.v - 0.4) < 1e-6 && Math.abs(c2.v - 0.25) < 1e-6) {
      seen = { c1, c2 };
      break;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  await api('POST', '/deck/color-autopilot', { active: false });
  assert.ok(seen, 'colorPalette1/2 never took the full-HSV values');
  assert.ok(Math.abs(seen.c1.h - 0.33) < 1e-6);
  assert.ok(Math.abs(seen.c1.s - 0.95) < 1e-6);
  assert.ok(Math.abs(seen.c2.s - 0.5) < 1e-6);
});

// ── docs/55 §3.2 item 6: REST activation SEEDS the fade start ──────────────

test('activating over REST fades FROM the live palette instead of snapping', async () => {
  // Park a known palette on the rig by hand…
  await api('POST', '/deck/color-autopilot', { active: false });
  const from = { colorPalette1: { h: 0.0, s: 1, v: 1 }, colorPalette2: { h: 0.5, s: 1, v: 1 } };
  const seed = await api('POST', '/param-center', from);
  assert.equal(seed.status, 200, JSON.stringify(seed.data));

  // …then activate a rotation whose first palette is FAR away, with a long
  // fade. Un-seeded, the daemon has no `from` and HARD-CUTS to the target on
  // the first apply; seeded, the first frames sit near the live palette.
  const target = { c1: 0.25, c2: 0.75 };
  const post = await api('POST', '/deck/color-autopilot', {
    active: true, shuffle: false, delay_s: 0.3, transitionMs: 3000, palettes: [target],
  });
  assert.equal(post.status, 200, JSON.stringify(post.data));

  // Sample shortly after the first switch begins: mid-fade, strictly BETWEEN
  // the live palette and the target.
  let mid = null;
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const pc = await api('GET', '/param-center');
    const c1 = pc.data?.params?.colorPalette1?.value ?? pc.data?.colorPalette1;
    if (c1 && c1.h > 1e-6 && c1.h < 0.25 - 1e-6) { mid = c1; break; }
    // A hard cut would land exactly on the target with no intermediate frame.
    if (c1 && Math.abs(c1.h - 0.25) < 1e-9) break;
    await new Promise((r) => setTimeout(r, 40));
  }
  await api('POST', '/deck/color-autopilot', { active: false });
  assert.ok(mid, 'the first REST-activated switch SNAPPED — seedCurrentParams did not run');
});

test('an INACTIVE POST does not seed, and activation does not apply immediately', async () => {
  await api('POST', '/deck/color-autopilot', { active: false });
  const parked = { colorPalette1: { h: 0.12, s: 1, v: 1 }, colorPalette2: { h: 0.62, s: 1, v: 1 } };
  await api('POST', '/param-center', parked);

  // A long hold: the manual REST toggle keeps its WAIT-then-cycle cadence (no
  // triggerNext), so the palette must be untouched right after activation.
  const post = await api('POST', '/deck/color-autopilot', {
    active: true, shuffle: false, delay_s: 30, transitionMs: 0, palettes: [{ c1: 0.9, c2: 0.4 }],
  });
  assert.equal(post.status, 200, JSON.stringify(post.data));
  await new Promise((r) => setTimeout(r, 400));
  const pc = await api('GET', '/param-center');
  const c1 = pc.data?.params?.colorPalette1?.value ?? pc.data?.colorPalette1;
  await api('POST', '/deck/color-autopilot', { active: false });
  assert.ok(Math.abs(c1.h - 0.12) < 1e-6,
    `activation must not apply immediately (cadence unchanged), got h=${c1.h}`);
});

// ── The saved colour-pair gallery (scene-owned, shared by every iPad) ───────

test('GET /color-pairs starts empty and POST round-trips through the scene state dir', async () => {
  const empty = await api('GET', '/color-pairs');
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.data, { schemaVersion: SCHEMA_V, pairs: [] });

  const pairs = [{ c1: 0.7311, c2: 0.5332 }, { c1: 0.0816, c2: 0.2667 }];
  const post = await api('POST', '/color-pairs', { pairs });
  assert.equal(post.status, 200, JSON.stringify(post.data));
  assert.deepEqual(post.data.pairs, pairs);

  const back = await api('GET', '/color-pairs');
  assert.deepEqual(back.data.pairs, pairs);

  // SCENE-OWNED: the list is a file in the scene's state dir, not a per-tablet
  // browser store — that is what makes it shared across iPads.
  const file = path.join(stateDir, 'color_pairs_state.yaml');
  assert.ok(fs.existsSync(file), 'color_pairs_state.yaml written into the scene state dir');
  assert.deepEqual(yaml.load(fs.readFileSync(file, 'utf8')), { schemaVersion: SCHEMA_V, pairs });
});

// ── _242: an entry grew into a PRESET PALETTE ──────────────────────────────
// `c1`/`c2` stay required and unchanged (that IS the migration); name, ring+sel
// and scheme+base are optional and are validated as GROUPS.

const DEMO_RING = [
  { h: 0.10, s: 0.95, v: 1 }, { h: 0.30, s: 0.95, v: 1 }, { h: 0.50, s: 0.95, v: 0.55 },
  { h: 0.70, s: 0.95, v: 1 }, { h: 0.90, s: 0.95, v: 0.25 },
];

test('POST /color-pairs round-trips a NAMED palette with its ring, selection and latch', async () => {
  const pairs = [
    { c1: 0.1, c2: 0.3, name: 'Reef', ring: DEMO_RING, sel: [0, 1], scheme: 'analogous', base: 0.1 },
    { c1: 0.4, c2: 0.9 },
  ];
  const post = await api('POST', '/color-pairs', { pairs });
  assert.equal(post.status, 200, JSON.stringify(post.data));
  assert.deepEqual(post.data.pairs, pairs);

  const back = await api('GET', '/color-pairs');
  assert.equal(back.data.schemaVersion, SCHEMA_V);
  assert.deepEqual(back.data.pairs, pairs);

  // The file carries the version, so a future build knows what it is reading.
  const file = path.join(stateDir, 'color_pairs_state.yaml');
  assert.deepEqual(yaml.load(fs.readFileSync(file, 'utf8')), { schemaVersion: SCHEMA_V, pairs });
});

test('a v1 file (bare pairs, no schemaVersion) is read as-is — the migration is free', async () => {
  // Write the OLD shape straight to the state dir and prove the route serves it
  // unchanged: the pair field never moved, so there is nothing to convert.
  const file = path.join(stateDir, 'color_pairs_state.yaml');
  const v1 = [{ c1: 0.11, c2: 0.22 }, { c1: 0.33, c2: 0.44 }];
  fs.writeFileSync(file, yaml.dump({ pairs: v1 }), 'utf8');
  const back = await api('GET', '/color-pairs');
  assert.equal(back.status, 200);
  assert.deepEqual(back.data.pairs, v1);
});

test('a schemaVersion from the FUTURE is refused loudly, not served as a half-read list', async () => {
  const file = path.join(stateDir, 'color_pairs_state.yaml');
  fs.writeFileSync(file, yaml.dump({ schemaVersion: SCHEMA_V + 7, pairs: [{ c1: 0.1, c2: 0.2 }] }), 'utf8');
  const res = await api('GET', '/color-pairs');
  assert.equal(res.status, 500);
  assert.match(String(res.data.error), /schemaVersion/);
  // Put the file back so the ordering of later tests does not depend on this one.
  await api('POST', '/color-pairs', { pairs: [] });
});

test('a malformed ROW in the file is dropped with a warn, not the whole gallery', async () => {
  const file = path.join(stateDir, 'color_pairs_state.yaml');
  fs.writeFileSync(file, yaml.dump({
    schemaVersion: SCHEMA_V,
    pairs: [{ c1: 0.1, c2: 0.2 }, { c1: 0.3, c2: 0.4, sel: [0, 1] }, { c1: 0.5, c2: 0.6 }],
  }), 'utf8');
  const back = await api('GET', '/color-pairs');
  assert.equal(back.status, 200);
  assert.deepEqual(back.data.pairs, [{ c1: 0.1, c2: 0.2 }, { c1: 0.5, c2: 0.6 }]);
});

test('POST /color-pairs refuses every broken v2 GROUPING', async () => {
  const good = [{ c1: 0.1, c2: 0.2 }];
  await api('POST', '/color-pairs', { pairs: good });

  for (const [what, entry] of [
    ['a ring with no selection', { c1: 0, c2: 0.5, ring: DEMO_RING }],
    ['a selection with no ring', { c1: 0, c2: 0.5, sel: [0, 1] }],
    ['a non-colour in the ring', { c1: 0, c2: 0.5, ring: [{ h: 0.1 }, DEMO_RING[1]], sel: [0, 1] }],
    ['an out-of-range selection', { c1: 0, c2: 0.5, ring: DEMO_RING, sel: [0, 9] }],
    ['both channels on one slot', { c1: 0, c2: 0.5, ring: DEMO_RING, sel: [2, 2] }],
    ['a ring longer than the five staged slots', { c1: 0, c2: 0.5, ring: [...DEMO_RING, DEMO_RING[0]], sel: [0, 1] }],
    ['a scheme with no base', { c1: 0, c2: 0.5, ring: DEMO_RING, sel: [0, 1], scheme: 'golden' }],
    ['a scheme with no ring', { c1: 0, c2: 0.5, scheme: 'golden', base: 0.2 }],
    ['an unknown scheme', { c1: 0, c2: 0.5, ring: DEMO_RING, sel: [0, 1], scheme: 'kaleidoscope', base: 0.2 }],
    ['a non-string name', { c1: 0, c2: 0.5, name: 7 }],
  ]) {
    const res = await api('POST', '/color-pairs', { pairs: [entry] });
    assert.equal(res.status, 400, `expected 400 for ${what}`);
    assert.ok(res.data.error, 'a refusal carries a message');
  }

  const back = await api('GET', '/color-pairs');
  assert.deepEqual(back.data.pairs, good);
});

test('an EMPTY name is stored as NO name — one encoding of "unnamed"', async () => {
  const res = await api('POST', '/color-pairs', { pairs: [{ c1: 0.1, c2: 0.2, name: '   ' }] });
  assert.equal(res.status, 200);
  assert.deepEqual(res.data.pairs, [{ c1: 0.1, c2: 0.2 }]);
});

test('POST /color-pairs refuses malformed input and keeps the stored list', async () => {
  const good = [{ c1: 0.1, c2: 0.2 }];
  await api('POST', '/color-pairs', { pairs: good });

  for (const body of [
    { pairs: 'nope' },
    { pairs: [{ c1: 0.1 }] },
    { pairs: [{ c1: 2, c2: 0.2 }] },
    { pairs: [[0.1, 0.2]] },
    {},
  ]) {
    const res = await api('POST', '/color-pairs', body);
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(body)}`);
    assert.ok(res.data.error, 'a refusal carries a message');
  }

  const back = await api('GET', '/color-pairs');
  assert.deepEqual(back.data.pairs, good);
});

test('POST /color-pairs refuses more than the 24-pair cap', async () => {
  const tooMany = Array.from({ length: 25 }, (_, i) => ({ c1: i / 100, c2: (i + 1) / 100 }));
  const res = await api('POST', '/color-pairs', { pairs: tooMany });
  assert.equal(res.status, 400);
  assert.match(String(res.data.error), /at most 24 palettes/);
});

test('an EMPTY list is a legitimate save (deleting the last pair)', async () => {
  const res = await api('POST', '/color-pairs', { pairs: [] });
  assert.equal(res.status, 200);
  const back = await api('GET', '/color-pairs');
  assert.deepEqual(back.data.pairs, []);
});
